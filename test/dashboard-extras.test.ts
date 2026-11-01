import { beforeAll, describe, expect, it } from "vitest";
import { CLIENT_LOGIC } from "../src/dashboard/client-logic.js";
import { type DashboardData, type DashboardInput, renderDashboardHtml, toDashboardData } from "../src/dashboard/html.js";
import { topReferrers } from "../src/reporter/referrers.js";
import { loadDemoInput } from "./dashboard-demo.js";

type Repo = DashboardData["repos"][string];
type Range = { start: string; end: string } | null;
interface ReleaseRow { id: string; tag: string; total: number; inPeriod: number; since: string | null }
interface Downloads { latest: string | null; total: number; inPeriod: number; since: string | null; rows: ReleaseRow[] }
interface DailyPoint { date: string; downloads: number | null; from: string | null; days: number; clamped: boolean; covered: boolean }
interface Entry { referrer?: string; path?: string; title?: string; count: number; uniques: number | null }
interface Logic {
  periodStart(period: string, end: string): string | null;
  growthAdded(repos: Partial<Repo>[], kind: "stars" | "forks", start: string | null, end: string): number | null;
  starRange(period: string, end: string | null, repos: Partial<Repo>[]): Range;
  starSeries(repos: Partial<Repo>[], range: Range): { date: string; total: number; added: number }[];
  latestReferrers(repos: Partial<Repo>[]): { date: string; repos: number; referrers: Entry[]; paths: Entry[] } | null;
  releaseEnd(repos: Partial<Repo>[]): string | null;
  releaseDownloads(rel: NonNullable<Repo["releases"]>, period: string, relEnd: string): Downloads;
  releaseDaily(rel: NonNullable<Repo["releases"]>, range: Range): DailyPoint[];
  releaseCoverage(latest: string, start: string | null, relEnd: string): "current" | "stale" | "missing";
}

const logic = new Function(
  `${CLIENT_LOGIC}\nreturn { periodStart, growthAdded, starRange, starSeries, latestReferrers, releaseEnd, releaseDownloads, releaseDaily, releaseCoverage };`,
)() as Logic;

const end = "2026-10-25";
let demo: DashboardInput;
let data: DashboardData;
let repos: Repo[];
let cli: Repo;

beforeAll(async () => {
  demo = await loadDemoInput();
  data = toDashboardData(demo);
  repos = Object.values(data.repos);
  cli = data.repos["100001"]!;
});

const growth = (stars: Record<string, number>, forks: Record<string, number> = {}) => ({ growth: { stars, forks } });

describe("embedded extras", () => {
  it("embeds growth, the latest referrer snapshot and release snapshots per repo", () => {
    expect(cli.growth!.stars).toEqual(demo.growth["100001"]!.stars);
    expect(Object.keys(cli.growth!.stars)).toEqual(Object.keys(cli.growth!.stars).sort());
    expect(cli.referrers!.date).toBe("2026-10-27");
    expect(cli.referrers!.paths[0]).toEqual(["/octo-sample/sample-cli", "octo-sample/sample-cli", 46, 32]);
    expect(data.repos["100003"]!.referrers!.date).toBe("2026-10-06");
    expect(cli.releases!.info["9000002"]).toEqual(["v2.0.0", "Sample CLI 2.0", "2026-08-03"]);
    expect(Object.keys(cli.releases!.snapshots)).toEqual([
      "2026-09-22", "2026-09-29", "2026-10-06", "2026-10-13", "2026-10-20", "2026-10-27",
    ]);
    expect(data.repos["100002"]!.releases).toBeNull();
  });

  it("uses null for repos without extras files", () => {
    const bare = toDashboardData({ ...demo, growth: {}, referrers: {}, releases: {} }).repos["100001"]!;
    expect(bare).toMatchObject({ growth: null, referrers: null, releases: null });
  });

  it("is byte-identical regardless of the files' key order", () => {
    const shuffled = structuredClone(demo);
    const g = shuffled.growth["100001"]!;
    g.stars = Object.fromEntries(Object.entries(g.stars).reverse());
    const rel = shuffled.releases["100001"]!;
    rel.snapshots = Object.fromEntries(Object.entries(rel.snapshots).reverse());
    expect(renderDashboardHtml(shuffled)).toBe(renderDashboardHtml(demo));
  });

  it("keeps a hostile referrer name and page title inside the JSON block", () => {
    const payload = "</script><img src=x onerror=alert(1)><!--";
    const input = structuredClone(demo);
    const month = input.referrers["100001"]!;
    const snap = month.snapshots["2026-10-27"]!;
    snap.referrers[0]!.referrer = payload;
    snap.paths[0]!.title = payload;
    snap.paths[0]!.path = `/x/${payload}`;
    const html = renderDashboardHtml(input);
    expect(html.split("</script>").length - 1).toBe(2);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<!--");
    const open = '<script type="application/json" id="data">';
    const start = html.indexOf(open) + open.length;
    const parsed = JSON.parse(html.slice(start, html.indexOf("</script>", start))) as DashboardData;
    expect(parsed.repos["100001"]!.referrers!.referrers[0]![0]).toBe(payload);
    expect(parsed.repos["100001"]!.referrers!.paths[0]!.slice(0, 2)).toEqual([`/x/${payload}`, payload]);
  });
});

describe("stars and forks", () => {
  it("counts stars and forks dated in the period", () => {
    expect(logic.growthAdded([cli], "stars", logic.periodStart("7d", end), end)).toBe(3);
    expect(logic.growthAdded([cli], "stars", null, end)).toBe(cli.stars);
    expect(logic.growthAdded(repos, "stars", null, end)).toBe(42 + 17 + 8);
    expect(logic.growthAdded([cli], "forks", logic.periodStart("90d", end), end)).toBe(1);
    expect(logic.periodStart("30d", end)).toBe("2026-09-26");
  });

  it("is null without history and 0 when nothing was added", () => {
    expect(logic.growthAdded([{ growth: null }], "stars", null, end)).toBeNull();
    expect(logic.growthAdded([growth({ "2026-10-30": 2 })], "stars", null, end)).toBe(0);
    expect(logic.growthAdded([growth({}), { growth: null }], "stars", "2026-10-01", end)).toBe(0);
  });

  it("starts 'all' at the earliest star, even before the traffic history", () => {
    const earliest = repos.flatMap((r) => Object.keys(r.growth!.stars)).sort()[0]!;
    expect(logic.starRange("all", end, repos)).toEqual({ start: earliest, end });
    expect(earliest < Object.keys(cli.days).sort()[0]!).toBe(true);
    expect(logic.starRange("7d", end, repos)).toEqual({ start: "2026-10-19", end });
    expect(logic.starRange("all", end, [growth({})])).toBeNull();
    expect(logic.starRange("all", null, repos)).toBeNull();
  });

  it("builds a cumulative series that carries stars from before the range", () => {
    const series = logic.starSeries([cli], { start: "2026-10-19", end });
    expect(series).toHaveLength(7);
    expect(series[0]).toEqual({ date: "2026-10-19", total: 39, added: 0 });
    expect(series.at(-1)).toEqual({ date: end, total: 42, added: 1 });
    expect(logic.starSeries(repos, logic.starRange("all", end, repos)).at(-1)!.total).toBe(67);
  });

  it("stays at 0 for a period before the first star", () => {
    const series = logic.starSeries([growth({ "2026-10-20": 2 })], { start: "2026-10-01", end: "2026-10-03" });
    expect(series.map((p) => p.total)).toEqual([0, 0, 0]);
    expect(logic.starSeries(repos, null)).toEqual([]);
  });
});

describe("latest referrers", () => {
  it("matches the README aggregation (newest run date, counts summed)", () => {
    const readme = topReferrers(Object.values(demo.referrers))!;
    const ours = logic.latestReferrers(repos)!;
    // Sample-Docs' latest snapshot (10-06) is stale and drops out.
    expect(ours).toMatchObject({ date: "2026-10-27", repos: 2 });
    expect(ours.date).toBe(readme.date);
    expect(ours.referrers.slice(0, readme.referrers.length).map((r) => ({ referrer: r.referrer, count: r.count })))
      .toEqual(readme.referrers);
  });

  it("drops uniques across repos and keeps them for one repo", () => {
    const all = logic.latestReferrers(repos)!;
    expect(all.referrers.every((r) => r.uniques === null)).toBe(true);
    expect(all.paths.every((p) => p.uniques === null)).toBe(true);
    const one = logic.latestReferrers([cli])!;
    expect(one.referrers[0]).toMatchObject({ referrer: "github.com", count: 31, uniques: 13 });
    expect(one.paths[0]).toMatchObject({ path: "/octo-sample/sample-cli", title: "octo-sample/sample-cli", count: 46, uniques: 32 });
  });

  it("ignores repos whose latest snapshot is older, and repos without files", () => {
    const fresh = { referrers: { date: "2026-10-20", referrers: [["a.com", 3, 2]], paths: [] } } as Partial<Repo>;
    const stale = { referrers: { date: "2026-10-13", referrers: [["a.com", 50, 9]], paths: [] } } as Partial<Repo>;
    const same = { referrers: { date: "2026-10-20", referrers: [["a.com", 4, 4], ["b.com", 7, 1]], paths: [] } } as Partial<Repo>;
    const top = logic.latestReferrers([fresh, stale, same, { referrers: null }])!;
    expect(top).toMatchObject({ date: "2026-10-20", repos: 2 });
    expect(top.referrers.map((r) => [r.referrer, r.count])).toEqual([["a.com", 7], ["b.com", 7]]);
    expect(logic.latestReferrers([{ referrers: null }])).toBeNull();
  });

  it("keeps the top 10 of the summed entries", () => {
    const many = Array.from({ length: 12 }, (_, i) => [`r${String(i).padStart(2, "0")}`, i + 1, 1]);
    const top = logic.latestReferrers([{ referrers: { date: "2026-10-20", referrers: many, paths: [] } } as Partial<Repo>, { referrers: null }])!;
    expect(top.referrers).toHaveLength(10);
    expect(top.referrers[0]!.referrer).toBe("r11");
  });
});

describe("release downloads", () => {
  const relEnd = "2026-10-27";

  it("ends release periods at the newest snapshot date", () => {
    expect(logic.releaseEnd(repos)).toBe(relEnd);
    expect(logic.releaseEnd([{ releases: null }])).toBeNull();
  });

  it("subtracts the snapshot at/before the period start", () => {
    const d = logic.releaseDownloads(cli.releases!, "7d", relEnd);
    // Start 10-21, base 10-20: v1 220-218, v2 161-147, beta (published 10-20, before the start) 15-4.
    expect(d).toMatchObject({ latest: relEnd, total: 396, inPeriod: 27, since: null });
    expect(d.rows.map((r) => [r.tag, r.total, r.inPeriod])).toEqual([
      ["v2.1.0-beta.1", 15, 11],
      ["v2.0.0", 161, 14],
      ["v1.0.0", 220, 2],
    ]);
  });

  it("counts releases published inside the period from 0", () => {
    // Start 09-28, base 09-22; beta was published 10-20.
    const d = logic.releaseDownloads(cli.releases!, "30d", relEnd);
    expect(d.rows.map((r) => r.inPeriod)).toEqual([15, 53, 7]);
    expect(d.since).toBeNull();
  });

  it("falls back to the first snapshot when none is from before the period", () => {
    const d = logic.releaseDownloads(cli.releases!, "90d", relEnd);
    expect(d.rows.map((r) => [r.tag, r.inPeriod, r.since])).toEqual([
      ["v2.1.0-beta.1", 15, null],
      ["v2.0.0", 161, null],
      ["v1.0.0", 7, "2026-09-22"],
    ]);
    expect(d).toMatchObject({ inPeriod: 183, since: "2026-09-22" });

    const single = { info: { "1": ["v1", "", "2024-01-01"] as [string, string, string | null] }, snapshots: { "2026-10-29": { "1": 40 } } };
    expect(logic.releaseDownloads(single, "7d", "2026-10-29")).toMatchObject({ total: 40, inPeriod: 0, since: "2026-10-29" });
  });

  it("uses the total for 'all' and skips releases missing from the latest snapshot", () => {
    expect(logic.releaseDownloads(cli.releases!, "all", relEnd)).toMatchObject({ total: 396, inPeriod: 396, since: null });
    const deleted = {
      info: { "1": ["a", "", "2026-01-01"], "2": ["b", "", "2026-01-01"] } as Record<string, [string, string, string | null]>,
      snapshots: { "2026-10-01": { "1": 5, "2": 9 }, "2026-10-08": { "1": 3 } },
    };
    const d = logic.releaseDownloads(deleted, "7d", "2026-10-08");
    expect(d.rows.map((r) => r.id)).toEqual(["1"]);
    expect(d.inPeriod).toBe(0);
  });

  it("includes the first day of the period when snapshots are daily", () => {
    const snapshots: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 40; i++) snapshots[new Date(Date.UTC(2026, 8, 20 + i)).toISOString().slice(0, 10)] = { "1": 10 * (i + 1) };
    const rel = { info: { "1": ["v1", "", "2026-01-01"] as [string, string, string | null] }, snapshots };
    const lastDay = "2026-10-29";
    const d = logic.releaseDownloads(rel, "7d", lastDay);
    const chart = logic
      .releaseDaily(rel, { start: logic.periodStart("7d", lastDay)!, end: lastDay })
      .reduce((sum, p) => sum + (p.downloads ?? 0), 0);
    expect(d.inPeriod).toBe(70);
    expect(chart).toBe(70);
    expect(logic.releaseDownloads(rel, "30d", lastDay).inPeriod).toBe(300);
  });

  it("counts downloads after a drop (deleted asset) in the period total", () => {
    const rel = {
      info: { "1": ["v1", "", "2026-01-01"] as [string, string, string | null] },
      snapshots: { "2026-10-01": { "1": 100 }, "2026-10-02": { "1": 90 }, "2026-10-03": { "1": 95 } },
    };
    expect(logic.releaseDownloads(rel, "7d", "2026-10-03").inPeriod).toBe(5);
  });

  it("counts period downloads of a release deleted before the latest snapshot", () => {
    const rel = {
      info: { "1": ["v1", "", "2026-01-01"], "2": ["v2", "", "2026-01-01"] } as Record<string, [string, string, string | null]>,
      snapshots: { "2026-10-01": { "1": 100, "2": 5 }, "2026-10-02": { "1": 110, "2": 5 }, "2026-10-03": { "2": 5 } },
    };
    const d = logic.releaseDownloads(rel, "7d", "2026-10-03");
    const chart = logic.releaseDaily(rel, { start: "2026-09-27", end: "2026-10-03" }).reduce((n, p) => n + (p.downloads ?? 0), 0);
    expect(d.inPeriod).toBe(10);
    expect(chart).toBe(10);
    expect(d.rows.map((r) => r.id)).toEqual(["2"]);
  });

  it("flags a repository whose newest snapshot predates the overview end", () => {
    expect(logic.releaseCoverage("2026-10-29", "2026-10-23", "2026-10-29")).toBe("current");
    expect(logic.releaseCoverage("2026-10-26", "2026-10-23", "2026-10-29")).toBe("stale");
    expect(logic.releaseCoverage("2026-10-02", "2026-10-23", "2026-10-29")).toBe("missing");
    expect(logic.releaseCoverage("2026-10-02", null, "2026-10-29")).toBe("stale");
  });

  it("attributes a multi-day interval to its later date without splitting it", () => {
    const series = logic.releaseDaily(cli.releases!, { start: "2026-10-19", end: relEnd });
    expect(series).toHaveLength(9);
    expect(series[1]).toEqual({ date: "2026-10-20", downloads: 14, from: "2026-10-13", days: 7, clamped: false, covered: true });
    expect(series.at(-1)).toEqual({ date: relEnd, downloads: 27, from: "2026-10-20", days: 7, clamped: false, covered: true });
    expect(series[2]).toMatchObject({ date: "2026-10-21", downloads: null, covered: true });
  });

  it("marks days before the first snapshot as not covered", () => {
    const series = logic.releaseDaily(cli.releases!, { start: "2026-09-20", end: "2026-09-29" });
    expect(series.filter((p) => !p.covered).map((p) => p.date)).toEqual(["2026-09-20", "2026-09-21", "2026-09-22"]);
    expect(series.at(-1)).toMatchObject({ downloads: 16, days: 7 });
  });

  it("clamps a drop (deleted asset) to 0 and flags it", () => {
    const rel = {
      info: {},
      snapshots: { "2026-10-01": { "1": 10, "2": 4 }, "2026-10-02": { "1": 5, "3": 3 } },
    };
    const series = logic.releaseDaily(rel, { start: "2026-10-01", end: "2026-10-02" });
    expect(series[0]).toMatchObject({ downloads: null, covered: false });
    expect(series[1]).toMatchObject({ downloads: 3, days: 1, clamped: true });
    expect(logic.releaseDaily(rel, null)).toEqual([]);
  });
});
