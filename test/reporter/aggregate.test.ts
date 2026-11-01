import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildDashboardModel,
  dailySeries,
  daysFromMonthFiles,
  periodTotals,
  sumPeriod,
  type DashboardModel,
  type DayMap,
} from "../../src/reporter/aggregate.js";
import { createStore } from "../../src/storage/store.js";
import type {
  DayMetrics,
  IndexFile,
  MonthFile,
  StatusFile,
} from "../../src/types.js";

const demoRoot = fileURLToPath(new URL("../../fixtures/demo", import.meta.url));
const GAP = ["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];

const m = (views: number, clones: number): DayMetrics => ({
  views,
  uniqueViews: 0,
  clones,
  uniqueCloners: 0,
});
const dayMap = (entries: Record<string, DayMetrics>): DayMap =>
  new Map(Object.entries(entries));

let index: IndexFile;
let status: StatusFile;
let files: Record<string, MonthFile[]>;
let model: DashboardModel;

beforeAll(async () => {
  const store = createStore(demoRoot);
  index = (await store.readIndex())!;
  status = (await store.readStatus())!;
  files = {};
  for (const id of Object.keys(index.repositories))
    files[id] = await store.readMonthFiles(id);
  model = buildDashboardModel(index, status, files);
});

describe("daysFromMonthFiles", () => {
  it("merges every month's keys", () => {
    const days = daysFromMonthFiles(files["100001"]!);
    expect(days.size).toBe(32);
    expect(days.get("2026-09-20")).toBeDefined();
    expect(days.get("2026-10-25")).toBeDefined();
    for (const d of GAP) expect(days.has(d)).toBe(false);
  });
});

describe("sumPeriod", () => {
  it("counts zero days as present and absent keys as missing, without changing sums", () => {
    const withZero = dayMap({
      "2026-01-01": m(3, 1),
      "2026-01-02": m(0, 0),
      "2026-01-03": m(4, 2),
    });
    const withGap = dayMap({ "2026-01-01": m(3, 1), "2026-01-03": m(4, 2) });
    expect(sumPeriod(withZero, "2026-01-03", 3)).toEqual({
      views: 7,
      clones: 3,
      presentDays: 3,
      missingDays: 0,
      partialDays: 0,
    });
    expect(sumPeriod(withGap, "2026-01-03", 3)).toEqual({
      views: 7,
      clones: 3,
      presentDays: 2,
      missingDays: 1,
      partialDays: 0,
    });
  });

  it("returns null sums when no key is in range", () => {
    const days = dayMap({ "2026-01-01": m(3, 1) });
    expect(sumPeriod(days, "2026-01-10", 7)).toEqual({
      views: null,
      clones: null,
      presentDays: 0,
      missingDays: 7,
      partialDays: 0,
    });
    expect(sumPeriod(new Map(), "2026-01-10", "all")).toEqual({
      views: null,
      clones: null,
      presentDays: 0,
      missingDays: 0,
      partialDays: 0,
    });
  });

  it("'all' runs from the repo's own earliest key to endDate", () => {
    const days = dayMap({ "2026-01-05": m(1, 1), "2026-01-08": m(2, 0) });
    expect(sumPeriod(days, "2026-01-10", "all")).toEqual({
      views: 3,
      clones: 1,
      presentDays: 2,
      missingDays: 4,
      partialDays: 0,
    });
  });

  it("ignores keys after endDate", () => {
    const days = dayMap({ "2026-01-01": m(1, 1), "2026-01-02": m(5, 5) });
    expect(sumPeriod(days, "2026-01-01", 7).views).toBe(1);
  });
});

describe("periodTotals / dailySeries", () => {
  it("'all' starts at the earliest key across repos", () => {
    const a = dayMap({ "2026-01-01": m(1, 0) });
    const b = dayMap({ "2026-01-03": m(2, 1) });
    // 01-01: only a is tracked yet (complete); 01-02: missing; 01-03: a lacks it (partial).
    expect(periodTotals([a, b], "2026-01-03").all).toEqual({
      views: 3,
      clones: 1,
      presentDays: 2,
      missingDays: 1,
      partialDays: 1,
    });
  });

  it("days before tracking began are neither missing nor partial", () => {
    const old = dayMap({ "2026-01-01": m(1, 1), "2026-01-02": m(1, 1), "2026-01-03": m(1, 1) });
    const fresh = dayMap({ "2026-01-03": m(2, 2) });
    // A 7-day window over a repo first collected 01-03 covers only 01-03.
    expect(sumPeriod(fresh, "2026-01-03", 7)).toEqual({
      views: 2,
      clones: 2,
      presentDays: 1,
      missingDays: 0,
      partialDays: 0,
    });
    expect(periodTotals([old, fresh], "2026-01-03").d7).toEqual({
      views: 5,
      clones: 5,
      presentDays: 3,
      missingDays: 0,
      partialDays: 0,
    });
    expect(dailySeries([old, fresh], "2026-01-03", 4)).toEqual([
      { date: "2025-12-31", views: null, clones: null, partial: false },
      { date: "2026-01-01", views: 1, clones: 1, partial: false },
      { date: "2026-01-02", views: 1, clones: 1, partial: false },
      { date: "2026-01-03", views: 3, clones: 3, partial: false },
    ]);
  });

  it("a repo with no keys at all (first collection failed) still marks days partial", () => {
    const ok = dayMap({ "2026-01-01": m(1, 1), "2026-01-02": m(1, 1) });
    expect(periodTotals([ok, new Map()], "2026-01-02").d7).toEqual({
      views: 2,
      clones: 2,
      presentDays: 2,
      missingDays: 0,
      partialDays: 2,
    });
  });

  it("marks dates partial when some repos have the key, null when none do", () => {
    const a = dayMap({ "2026-01-01": m(1, 1), "2026-01-02": m(0, 0) });
    const b = dayMap({ "2026-01-01": m(2, 2) });
    expect(dailySeries([a, b], "2026-01-03", 3)).toEqual([
      { date: "2026-01-01", views: 3, clones: 3, partial: false },
      { date: "2026-01-02", views: 0, clones: 0, partial: true },
      { date: "2026-01-03", views: null, clones: null, partial: false },
    ]);
  });
});

describe("buildDashboardModel on the demo store", () => {
  it("anchors windows at dataThroughDate, not today", () => {
    expect(model.dataThroughDate).toBe("2026-10-25");
    expect(model.series).toHaveLength(30);
    expect(model.series[0]!.date).toBe("2026-09-26");
    expect(model.series.at(-1)!.date).toBe("2026-10-25");
    // 2026-10-19..25: every day has a tracked key, but the forbidden repo lacks all of them.
    expect(model.totals!.d7).toEqual({
      views: 380,
      clones: 118,
      presentDays: 7,
      missingDays: 0,
      partialDays: 7,
    });
  });

  it("the shared gap is null in the series and raises missingDays without changing sums", () => {
    for (const d of GAP) {
      expect(model.series.find((p) => p.date === d)).toEqual({
        date: d,
        views: null,
        clones: null,
        partial: false,
      });
    }
    const d30 = model.totals!.d30;
    expect(d30).toEqual({
      views: 1592,
      clones: 475,
      presentDays: 26,
      missingDays: 4,
      partialDays: 16,
    });
    const seriesViews = model.series.reduce((s, p) => s + (p.views ?? 0), 0);
    const seriesClones = model.series.reduce((s, p) => s + (p.clones ?? 0), 0);
    expect([seriesViews, seriesClones]).toEqual([d30.views, d30.clones]);
    expect(model.totals!.all).toEqual({
      views: 2086,
      clones: 610,
      presentDays: 32,
      missingDays: 4,
      partialDays: 16,
    });
  });

  it("zero days count as present", () => {
    const cli = model.rows.find((r) => r.id === "100001")!;
    // sample-cli has 2026-10-14 = 0/0 and 2026-10-25 = 0 views; both are present.
    expect(cli.d7).toEqual({
      views: 231,
      clones: 75,
      presentDays: 7,
      missingDays: 0,
      partialDays: 0,
    });
    expect(cli.d30).toEqual({
      views: 878,
      clones: 250,
      presentDays: 26,
      missingDays: 4,
      partialDays: 0,
    });
  });

  it("the forbidden repo stops contributing after 2026-10-09 and makes later days partial", () => {
    const docs = model.rows.find((r) => r.id === "100003")!;
    expect(docs.lastError).toEqual({ kind: "forbidden", date: "2026-10-10" });
    expect(docs.d7).toEqual({
      views: null,
      clones: null,
      presentDays: 0,
      missingDays: 7,
      partialDays: 0,
    });
    expect(docs.d30).toEqual({
      views: 135,
      clones: 49,
      presentDays: 10,
      missingDays: 20,
      partialDays: 0,
    });
    expect(model.failedCount).toBe(1);

    for (const p of model.series) {
      if (GAP.includes(p.date)) continue;
      expect(p.partial, p.date).toBe(p.date > "2026-10-09");
      expect(p.views, p.date).not.toBeNull();
    }
    // After 2026-10-09 the totals equal the two healthy repos alone.
    const healthy = ["100001", "100002"].map((id) =>
      daysFromMonthFiles(files[id]!),
    );
    expect(model.totals!.d7).toEqual({
      ...periodTotals(healthy, "2026-10-25").d7,
      partialDays: 7,
    });
  });

  it("orders rows by fullName case-insensitively and carries metadata", () => {
    expect(model.rows.map((r) => r.fullName)).toEqual([
      "octo-sample/sample-cli",
      "octo-sample/Sample-Docs",
      "octo-sample/sample-web",
    ]);
    expect(model.rows[0]).toMatchObject({
      id: "100001",
      name: "sample-cli",
      visibility: "public",
      stars: 42,
      forks: 5,
      tracking: "tracked",
      lastError: null,
    });
  });

  it("gives each row its own 30-day series ending at dataThroughDate", () => {
    for (const row of model.rows) {
      expect(row.series).toEqual(
        dailySeries([daysFromMonthFiles(files[row.id]!)], "2026-10-25", 30),
      );
    }
    const docs = model.rows.find((r) => r.id === "100003")!;
    expect(docs.series).toHaveLength(30);
    expect(docs.series.at(-1)).toEqual({
      date: "2026-10-25",
      views: null,
      clones: null,
      partial: false,
    });
    expect(model.rows.every((r) => r.series.every((p) => !p.partial))).toBe(true);
  });

  it("keeps non-tracked repos as rows but out of totals, series and failedCount", () => {
    const idx: IndexFile = structuredClone(index);
    idx.repositories["100003"]!.tracking = "missing";
    idx.repositories["100002"]!.tracking = "excluded:archived";
    const got = buildDashboardModel(idx, status, files);

    expect(got.rows.map((r) => [r.id, r.tracking])).toEqual([
      ["100001", "tracked"],
      ["100003", "missing"],
      ["100002", "excluded:archived"],
    ]);
    expect(got.rows.find((r) => r.id === "100002")!.d7).toEqual(
      model.rows.find((r) => r.id === "100002")!.d7,
    );
    expect(got.failedCount).toBe(0);
    expect(got.series.some((p) => p.partial)).toBe(false);
    expect(got.totals!.d7).toEqual(model.rows[0]!.d7);
  });
});

describe("buildDashboardModel without data", () => {
  it("an index with repos but no month files yields the no-data model", () => {
    const empty: StatusFile = {
      schemaVersion: 1,
      dataThroughDate: null,
      repositories: {},
    };
    const got = buildDashboardModel(index, empty, {});
    expect(got.dataThroughDate).toBeNull();
    expect(got.totals).toBeNull();
    expect(got.series).toEqual([]);
    expect(got.failedCount).toBe(0);
    expect(got.rows).toHaveLength(3);
    for (const row of got.rows) {
      expect(row.series).toEqual([]);
      for (const cell of [row.d7, row.d30]) {
        expect(cell).toEqual({
          views: null,
          clones: null,
          presentDays: 0,
          missingDays: 0,
          partialDays: 0,
        });
      }
    }
  });
});
