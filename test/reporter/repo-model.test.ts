import { beforeAll, describe, expect, it } from "vitest";
import { CLIENT_LOGIC } from "../../src/dashboard/client-logic.js";
import type { ExtrasFiles } from "../../src/collect-extras.js";
import {
  buildDashboardModel,
  daysFromMonthFiles,
  REPO_SERIES_DAYS,
  shiftDate,
  sumPeriod,
  type DashboardRow,
  type DayMap,
} from "../../src/reporter/aggregate.js";
import { buildRepoPageModel, loadRepoExtras, type RepoExtras } from "../../src/reporter/repo-model.js";
import { createStore } from "../../src/storage/store.js";
import type { GrowthFile, ReleasesFile } from "../../src/types.js";
import { demoRoot } from "../dashboard-demo.js";

type Range = { start: string; end: string } | null;
interface Logic {
  growthAdded(repos: unknown[], kind: "stars" | "forks", start: string | null, end: string): number | null;
  starSeries(repos: unknown[], range: Range): { date: string; total: number; added: number }[];
}
const logic = new Function(`${CLIENT_LOGIC}\nreturn { growthAdded, starSeries };`)() as Logic;

const end = "2026-10-25";
const store = createStore(demoRoot);
const PERIODS = { d7: 7, d30: 30, d90: 90, all: "all" } as const;

let rows: Record<string, DashboardRow>;
let days: Record<string, DayMap>;
let extras: Record<string, RepoExtras>;

beforeAll(async () => {
  const index = (await store.readIndex())!;
  const status = (await store.readStatus())!;
  const files: Record<string, Awaited<ReturnType<typeof store.readMonthFiles>>> = {};
  rows = {};
  days = {};
  extras = {};
  for (const id of Object.keys(index.repositories)) {
    files[id] = await store.readMonthFiles(id);
    days[id] = daysFromMonthFiles(files[id]!);
    extras[id] = await loadRepoExtras(store, id, { growth: [], referrers: [], releases: [] });
  }
  for (const row of buildDashboardModel(index, status, files).rows) rows[row.id] = row;
});

const build = (id: string) => buildRepoPageModel(rows[id]!, days[id]!, end, extras[id]!);

describe("buildRepoPageModel", () => {
  it("totals equal sumPeriod for every period", () => {
    for (const id of Object.keys(rows)) {
      const model = build(id);
      for (const [key, length] of Object.entries(PERIODS)) {
        expect(model.totals[key as keyof typeof PERIODS]).toEqual(sumPeriod(days[id]!, end, length));
      }
      expect(model.series).toHaveLength(REPO_SERIES_DAYS);
      expect(model.dataThroughDate).toBe(end);
    }
  });

  it("matches the dashboard's growthAdded and starSeries", () => {
    for (const id of Object.keys(rows)) {
      const growth = build(id).growth!;
      const repo = [{ growth: extras[id]!.growth }];
      for (const [key, length] of Object.entries(PERIODS)) {
        const start = length === "all" ? null : shiftDate(end, 1 - length);
        expect(growth.newStars[key as keyof typeof PERIODS]).toBe(logic.growthAdded(repo, "stars", start, end));
        expect(growth.newForks[key as keyof typeof PERIODS]).toBe(logic.growthAdded(repo, "forks", start, end));
      }
      const range = { start: shiftDate(end, 1 - REPO_SERIES_DAYS), end };
      expect(growth.stars).toEqual(logic.starSeries(repo, range).map(({ date, total }) => ({ date, total })));
    }
  });

  it("takes the newest referrer snapshot", () => {
    expect(build("100001").referrers!.date).toBe("2026-10-27");
    expect(build("100003").referrers!.date).toBe("2026-10-06");
  });

  it("measures release change from the newest snapshot at least 30 days older", () => {
    const releases = build("100001").releases!;
    expect(releases.asOf).toBe("2026-10-27");
    expect(releases.baseDate).toBe("2026-09-22");
    expect(releases.rows.map((r) => [r.tag, r.change])).toEqual([
      ["v2.1.0-beta.1", 15],
      ["v2.0.0", 53],
      ["v1.0.0", 7],
    ]);
    expect(build("100002").releases).toBeNull();
  });

  it("has no base for release snapshots spanning less than 30 days", () => {
    const short: ReleasesFile = {
      schemaVersion: 1,
      repositoryId: 100001,
      releases: { "1": { tag: "v1", name: "", publishedDate: null } },
      snapshots: { "2026-10-20": { "1": 5 }, "2026-10-27": { "1": 9 } },
    };
    const releases = buildRepoPageModel(rows["100001"]!, days["100001"]!, end, { releases: short }).releases!;
    expect(releases.baseDate).toBeNull();
    expect(releases.rows).toEqual([{ tag: "v1", name: "", publishedDate: null, total: 9, change: null }]);
  });

  it("is empty without a data-through date", () => {
    const model = buildRepoPageModel(rows["100001"]!, days["100001"]!, null, extras["100001"]!);
    expect(model.series).toEqual([]);
    expect(model.growth).toBeNull();
    for (const total of Object.values(model.totals)) {
      expect(total).toEqual({ views: null, clones: null, presentDays: 0, missingDays: 0, partialDays: 0 });
    }
  });
});

describe("loadRepoExtras", () => {
  it("prefers this run's files over the stored ones", async () => {
    const fresh: GrowthFile = { schemaVersion: 1, repositoryId: 100001, stars: { "2026-10-25": 99 }, forks: {} };
    const computed: ExtrasFiles = { growth: [fresh], referrers: [], releases: [] };
    expect((await loadRepoExtras(store, "100001", computed)).growth).toBe(fresh);
    expect((await loadRepoExtras(store, "100002", computed)).growth).toEqual((await store.readGrowth("100002"))!);
  });
});
