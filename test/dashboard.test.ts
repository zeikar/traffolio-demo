import { createHash } from "node:crypto";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CLIENT_CHART } from "../src/dashboard/client-chart.js";
import { CLIENT_SCRIPT, CLIENT_UI } from "../src/dashboard/client.js";
import { CLIENT_LOGIC } from "../src/dashboard/client-logic.js";
import {
  type DashboardData,
  type DashboardInput,
  renderDashboardHtml,
  toDashboardData,
} from "../src/dashboard/html.js";
import { runDashboard } from "../src/dashboard/run.js";
import { periodTotals, sumPeriod } from "../src/reporter/aggregate.js";
import { demoRoot, loadDemoInput } from "./dashboard-demo.js";

let demo: DashboardInput;

beforeAll(async () => {
  demo = await loadDemoInput();
});

const DATA_OPEN = '<script type="application/json" id="data">';

function embeddedJson(html: string): string {
  const start = html.indexOf(DATA_OPEN) + DATA_OPEN.length;
  return html.slice(start, html.indexOf("</script>", start));
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("renderDashboardHtml", () => {
  it("is byte-identical for the same input", () => {
    expect(renderDashboardHtml(demo)).toBe(renderDashboardHtml(demo));
  });

  it("embeds the data as JSON that round-trips", () => {
    const html = renderDashboardHtml(demo);
    const parsed = JSON.parse(embeddedJson(html)) as DashboardData;
    expect(parsed).toEqual(toDashboardData(demo));
    expect(parsed.dataThroughDate).toBe("2026-10-25");
    expect(Object.values(parsed.repos).map((r) => r.fullName)).toEqual([
      "octo-sample/sample-cli",
      "octo-sample/sample-web",
      "octo-sample/Sample-Docs",
    ]);
    const cli = parsed.repos["100001"]!;
    const m = demo.days["100001"]!.get("2026-10-01")!;
    expect(cli.days["2026-10-01"]).toEqual([m.views, m.uniqueViews, m.clones, m.uniqueCloners]);
    expect(parsed.repos["100003"]!.lastError).toEqual({ kind: "forbidden", date: "2026-10-10" });
  });

  it("keeps a hostile repo name inside the JSON block", () => {
    const payload = "</script><img src=x onerror=alert(1)>&\u2028\u2029";
    const index = structuredClone(demo.index);
    index.repositories["100001"]!.name = payload;
    index.repositories["100001"]!.fullName = `octo/${payload}`;
    const html = renderDashboardHtml({ ...demo, index, source: `/tmp/${payload}` });

    // Only the two real closing tags: the data block and the client script.
    expect(count(html, "</script>")).toBe(2);
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/[\u2028\u2029]/);
    expect(embeddedJson(html)).toContain("\\u003c/script\\u003e\\u003cimg");

    const parsed = JSON.parse(embeddedJson(html)) as DashboardData;
    expect(parsed.repos["100001"]!.name).toBe(payload);
    expect(parsed.source).toBe(`/tmp/${payload}`);
  });

  it("loads nothing external and pins the inline script and style by hash", () => {
    const html = renderDashboardHtml(demo);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<(img|iframe|object|embed)\b/i);
    expect(html).not.toMatch(/@import|url\(/i);

    const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
    const style = html.slice(html.indexOf("<style>") + 7, html.indexOf("</style>"));
    expect(html).toContain(`script-src 'sha256-${sha(CLIENT_SCRIPT)}'`);
    expect(html).toContain(`style-src 'sha256-${sha(style)}'`);
    expect(html).toContain(`<script>${CLIENT_SCRIPT}</script>`);
  });

  it("leaves out the local path and the private-data note on a published page", () => {
    const published = renderDashboardHtml({ ...demo, source: null });
    for (const text of ["Generated locally", "don&rsquo;t commit or publish", "/somewhere/data", 'id="source"']) {
      expect(published).not.toContain(text);
    }
    expect(published).toContain("Published by Traffolio in public mode");
    const parsed = JSON.parse(embeddedJson(published)) as DashboardData;
    expect(parsed.source).toBeNull();
    expect(Object.keys(parsed.repos)).toEqual(Object.keys(toDashboardData(demo).repos));
    expect(renderDashboardHtml({ ...demo, source: null })).toBe(published);

    const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("base64");
    expect(published).toContain(`script-src 'sha256-${sha(CLIENT_SCRIPT)}'`);
    expect(published).toContain(`<script>${CLIENT_SCRIPT}</script>`);

    expect(renderDashboardHtml(demo)).toContain("Generated locally");
  });

  it("client script avoids sequences that would end the script element", () => {
    expect(CLIENT_SCRIPT.toLowerCase()).not.toContain("</script");
    expect(CLIENT_SCRIPT).not.toContain("<!--");
  });

  it("shows separate views and clones charts, with unique lines in the UI code", () => {
    const html = renderDashboardHtml(demo);
    for (const id of ["views-chart", "clones-chart", "views-legend", "clones-legend"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toContain('id="chart"');
    expect(CLIENT_UI).toContain('"-chart"');
    expect(CLIENT_UI).toContain('"unique"');
  });

  it("includes the chart drawing code, which is safe to inline", () => {
    expect(CLIENT_SCRIPT).toContain(CLIENT_CHART);
    expect(CLIENT_CHART.toLowerCase()).not.toContain("</script");
    expect(CLIENT_CHART).not.toContain("<!--");
  });
});

describe("client logic (DOM-free) mirrors aggregate.ts", () => {
  type Sum = { views: number | null; clones: number | null; presentDays: number; missingDays: number; partialDays: number };
  type Repo = { days: Record<string, number[]> };
  interface Logic {
    periodRange(period: string, end: string | null, repos: Repo[]): { start: string; end: string } | null;
    buildSeries(repos: Repo[], range: { start: string; end: string } | null): { date: string; views: number | null; partial: boolean; present: number; total: number }[];
    sumSeries(series: unknown[]): Sum;
  }
  let logic: Logic;
  let repos: Repo[];
  const end = "2026-10-25";

  beforeAll(() => {
    logic = new Function(`${CLIENT_LOGIC}\nreturn { periodRange, buildSeries, sumSeries };`)() as Logic;
    repos = Object.values(toDashboardData(demo).repos);
  });

  const clientSum = (period: string, scope: Repo[]) =>
    logic.sumSeries(logic.buildSeries(scope, logic.periodRange(period, end, scope)));

  it("matches periodTotals for the tracked-repo totals", () => {
    const totals = periodTotals(Object.values(demo.days), end);
    expect(clientSum("7d", repos)).toEqual(totals.d7);
    expect(clientSum("30d", repos)).toEqual(totals.d30);
    expect(clientSum("all", repos)).toEqual(totals.all);
  });

  it("matches sumPeriod for each repo", () => {
    const ids = Object.keys(demo.days);
    ids.forEach((id, i) => {
      for (const [period, len] of [["7d", 7], ["30d", 30], ["90d", 90], ["all", "all"]] as const) {
        expect(clientSum(period, [repos[i]!])).toEqual(sumPeriod(demo.days[id]!, end, len));
      }
    });
  });

  it("treats days before a repo's first key as not tracked yet, like aggregate.ts", () => {
    const one = [1, 0, 1, 0];
    const old: Repo = { days: { "2026-10-20": one, "2026-10-21": one, "2026-10-25": one } };
    const fresh: Repo = { days: { "2026-10-24": one, "2026-10-25": one } };
    const keyless: Repo = { days: {} };
    const toMap = (r: Repo) =>
      new Map(Object.entries(r.days).map(([d, v]) => [d, { views: v[0]!, uniqueViews: v[1]!, clones: v[2]!, uniqueCloners: v[3]! }]));
    for (const scope of [[old, fresh], [fresh], [old, keyless]]) {
      const totals = periodTotals(scope.map(toMap), end);
      expect(clientSum("7d", scope)).toEqual(totals.d7);
      expect(clientSum("30d", scope)).toEqual(totals.d30);
      expect(clientSum("all", scope)).toEqual(totals.all);
    }
    expect(logic.periodRange("30d", end, [fresh])).toEqual({ start: "2026-10-24", end });
    const series = logic.buildSeries([old, fresh], logic.periodRange("7d", end, [old, fresh]));
    // Only 10-24 (fresh has it, old lacks it); 10-20/21 precede fresh's start, so they are complete.
    expect(series.filter((p) => p.partial).map((p) => p.date)).toEqual(["2026-10-24"]);
    expect(logic.buildSeries([old, keyless], { start: end, end })[0]).toMatchObject({ partial: true, present: 1, total: 2 });
  });

  it("marks partial days and keeps gaps as null", () => {
    const series = logic.buildSeries(repos, { start: "2026-10-03", end: "2026-10-12" });
    expect(series.slice(0, 4).every((p) => p.views === null)).toBe(true);
    const partial = series.find((p) => p.partial)!;
    expect(partial).toMatchObject({ present: 2, total: 3 });
    expect(logic.periodRange("all", null, repos)).toBeNull();
  });
});

describe("runDashboard", () => {
  let tmp: string;
  let logs: string[];
  let errors: string[];
  const io = (cwd: string) => ({
    cwd,
    log: (line: string) => logs.push(line),
    error: (line: string) => errors.push(line),
  });

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "traffolio-dashboard-"));
    logs = [];
    errors = [];
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("writes the dashboard for --data/--out and prints its file:// URL", async () => {
    const out = join(tmp, "nested", "out.html");
    expect(await runDashboard(["--data", demoRoot, "--out", out], io(tmp))).toBe(0);
    const html = await readFile(out, "utf8");
    for (const name of ["octo-sample/sample-cli", "octo-sample/sample-web", "octo-sample/Sample-Docs"]) {
      expect(html).toContain(name);
    }
    expect(logs).toContain(pathToFileURL(out).href);
    expect(errors).toEqual([]);
  });

  it("defaults to the working directory and <root>/dashboard.html", async () => {
    await cp(demoRoot, tmp, { recursive: true });
    expect(await runDashboard([], io(tmp))).toBe(0);
    expect(await readFile(join(tmp, "dashboard.html"), "utf8")).toContain("octo-sample/sample-cli");
  });

  it("--public writes a page without the local path", async () => {
    const out = join(tmp, "pages", "index.html");
    expect(await runDashboard(["--public", "--data", demoRoot, "--out", out], io(tmp))).toBe(0);
    const html = await readFile(out, "utf8");
    expect(html).toContain("octo-sample/sample-cli");
    expect(html).not.toContain("Generated locally");
    expect(html).not.toContain(demoRoot);
  });

  it("--public refuses data that lists a private repository, without naming it", async () => {
    const root = join(tmp, "data-root");
    await cp(demoRoot, root, { recursive: true });
    const indexPath = join(root, "data", "index.json");
    const index = JSON.parse(await readFile(indexPath, "utf8")) as { repositories: Record<string, { private: boolean; fullName: string }> };
    index.repositories["100002"]!.private = true;
    await writeFile(indexPath, JSON.stringify(index));
    const out = join(tmp, "pages", "index.html");

    expect(await runDashboard(["--public", "--data", root, "--out", out], io(tmp))).toBe(1);
    expect(errors.join("\n")).toContain("private repository");
    expect(errors.join("\n")).not.toContain(index.repositories["100002"]!.fullName);
    await expect(access(out)).rejects.toThrow();

    expect(await runDashboard(["--data", root, "--out", out], io(tmp))).toBe(0);
  });

  it("exits 1 with a clear message when there is no data", async () => {
    expect(await runDashboard(["--data", tmp], io(tmp))).toBe(1);
    expect(errors.join("\n")).toContain("no data yet — run a collection first");
    expect(logs).toEqual([]);
  });

  it("exits 1 on unknown or incomplete arguments", async () => {
    expect(await runDashboard(["--bogus"], io(tmp))).toBe(1);
    expect(await runDashboard(["--out"], io(tmp))).toBe(1);
    expect(errors.join("\n")).toContain("usage:");
  });
});
