import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildDashboardModel,
  type RepoSeriesPoint,
  type SeriesPoint,
} from "../../src/reporter/aggregate.js";
import {
  clonesChart,
  renderChartSvg,
  repoClonesChart,
  repoStarsChart,
  repoViewsChart,
  viewsChart,
  type ChartSpec,
} from "../../src/reporter/svg.js";
import { createStore } from "../../src/storage/store.js";
import type { MonthFile } from "../../src/types.js";

const demoRoot = fileURLToPath(new URL("../../fixtures/demo", import.meta.url));

let series: SeriesPoint[];

beforeAll(async () => {
  const store = createStore(demoRoot);
  const index = (await store.readIndex())!;
  const status = (await store.readStatus())!;
  const files: Record<string, MonthFile[]> = {};
  for (const id of Object.keys(index.repositories))
    files[id] = await store.readMonthFiles(id);
  series = buildDashboardModel(index, status, files).series;
});

function pathData(svg: string, key: string): string {
  const match = svg.match(new RegExp(`<path class="line ${key}" d="([^"]*)"`));
  expect(match).not.toBeNull();
  return match![1]!;
}

const count = (text: string, pattern: RegExp): number =>
  text.match(pattern)?.length ?? 0;

/** Number of contiguous `null` runs. */
function gapCount(points: SeriesPoint[]): number {
  return points.filter(
    (p, i) => p.views === null && points[i - 1]?.views !== null,
  ).length;
}

const point = (
  date: string,
  value: number | null,
  partial = false,
): SeriesPoint => ({
  date,
  views: value,
  clones: value,
  partial,
});

const PARTIAL_TEXT = "partial day";

const headline = (svg: string): string | undefined =>
  svg.match(/<text [^>]*class="headline">([^<]*)</)?.[1];

describe("README charts", () => {
  it("are byte-stable across calls", () => {
    expect(viewsChart(series, false, true)).toBe(viewsChart(series, false, true));
    expect(clonesChart(series, false, true)).toBe(clonesChart(series, false, true));
  });

  it("draw exactly one line per chart, broken at missing days", () => {
    expect(gapCount(series)).toBe(1);
    for (const [chart, key] of [
      [viewsChart(series, false, false), "views"],
      [clonesChart(series, false, false), "clones"],
    ] as const) {
      expect(count(chart, /<path class="line/g)).toBe(1);
      expect(count(pathData(chart, key), /M/g)).toBe(gapCount(series) + 1);
    }
  });

  it("mark each partial day once per chart", () => {
    const partialDays = series.filter((p) => p.partial).length;
    expect(partialDays).toBeGreaterThan(0);
    for (const chart of [viewsChart(series, false, false), clonesChart(series, false, false)]) {
      expect(count(chart, /<circle class="partial"/g)).toBe(partialDays);
      expect(chart).toContain(PARTIAL_TEXT);
    }
  });

  it("draw no partial markers when no day is partial", () => {
    const full = [
      point("2026-01-01", 3),
      point("2026-01-02", 0),
      point("2026-01-03", 5),
    ];
    expect(count(viewsChart(full, false, false), /<circle class="partial"/g)).toBe(0);
  });

  it("keep an isolated day visible as its own subpath", () => {
    const svg = viewsChart(
      [
        point("2026-01-01", null),
        point("2026-01-02", 4),
        point("2026-01-03", null),
      ], false,
      false,
    );
    expect(count(pathData(svg, "views"), /M/g)).toBe(1);
    expect(count(svg, /<circle class="solo"/g)).toBe(1);
  });

  it("show the sample banner only when requested", () => {
    expect(viewsChart(series, false, true)).toContain("SAMPLE DATA");
    expect(clonesChart(series, false, true)).toContain("SAMPLE DATA");
    expect(viewsChart(series, false, false)).not.toContain("SAMPLE DATA");
  });

  it("have titles, state the data date in UTC and carry no script", () => {
    const views = viewsChart(series, false, true);
    expect(views).toContain("Views · last 30 days");
    expect(clonesChart(series, false, true)).toContain("Clones · last 30 days");
    expect(views).toContain("Data through 2026-10-25 (UTC)");
    expect(views).toContain("Daily totals across tracked repos");
    expect(views).not.toMatch(/<script/i);
  });

  it("headline the 30-day total, skipping missing days", () => {
    const total = series.reduce((sum, p) => sum + (p.views ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(headline(viewsChart(series, false, false))).toBe(total.toLocaleString("en-US"));
    expect(
      headline(viewsChart([point("2026-01-01", 1200), point("2026-01-02", null), point("2026-01-03", 34)], false, false)),
    ).toBe("1,234");
  });

  it("follow the light and dark theme with no hard-coded colors besides the card fallback", () => {
    const svg = viewsChart(series, false, true);
    expect(svg).toMatch(/@media \(prefers-color-scheme:dark\)\{svg\{[^}]*--views:#4493f8/);
    expect(svg).toMatch(/<rect class="card" [^>]*fill="#ffffff"/);
    expect(svg.replace(/<rect class="card"[^>]*>/, "")).not.toMatch(/(?:fill|stroke|stop-color)="#/);
    // Every currentColor sits inside a themed k-* group or carries the class itself.
    const repo = repoViewsChart(
      series.map((p) => ({ date: p.date, views: p.views, uniqueViews: p.views, clones: p.clones, uniqueCloners: p.clones })),
      false,
      false,
    );
    for (const chart of [svg, repo]) {
      const outside = chart.replace(/<g class="k-\w+">[\s\S]*?<\/g>/g, "").replace(/<line class="k-\w+"[^>]*>/g, "");
      expect(outside).not.toContain("currentColor");
      for (const [, id] of chart.matchAll(/url\(#([\w-]+)\)/g)) expect(chart).toContain(`id="${id}"`);
    }
    expect(repo).toMatch(/<line class="k-uniqueViews"/);
  });

  it("mark an incomplete headline total with * and explain it", () => {
    const svg = viewsChart(series, true, false);
    expect(headline(svg)).toMatch(/^[\d,]+\*$/);
    expect(svg).toContain("* total has missing or partial days");
    expect(viewsChart(series, false, false)).not.toContain("* total");
    expect(headline(viewsChart([], true, false))).toBeUndefined();
  });

  it("headline clones with the clones total", () => {
    const total = series.reduce((sum, p) => sum + (p.clones ?? 0), 0);
    expect(headline(clonesChart(series, false, false))).toBe(total.toLocaleString("en-US"));
  });

  it("fill the area under the line once per run of days", () => {
    const svg = viewsChart(series, false, false);
    expect(count(svg, /<path class="area"/g)).toBe(1);
    expect(svg.match(/<path class="area" d="([^"]*)"/)![1]!.match(/Z/g)).toHaveLength(gapCount(series) + 1);
  });

  it("render a no-data placeholder for an empty series", () => {
    const svg = viewsChart([], false, false);
    expect(svg).toContain("No traffic data stored yet");
    expect(svg).toContain("UTC");
    expect(svg).not.toContain("<path");
    expect(headline(svg)).toBeUndefined();
    expect(svg).not.toMatch(/<script/i);
  });

  it("escape text taken from the series", () => {
    const svg = viewsChart([point("<x&y>", 1)], false, false);
    expect(svg).toContain("&lt;x&amp;y&gt;");
    expect(svg).not.toContain("<x&y>");
  });

  it("use integer coordinates only", () => {
    for (const chart of [viewsChart(series, false, false), clonesChart(series, false, false)]) {
      for (const match of chart.matchAll(/ d="([^"]*)"/g)) {
        expect(match[1]).not.toContain(".");
      }
    }
  });
});

describe("renderChartSvg", () => {
  const spec: ChartSpec = {
    title: "T",
    dates: ["2026-01-01", "2026-01-02", "2026-01-03"],
    lines: [
      { key: "views", label: "A", values: [1, 2, 3] },
      { key: "uniqueViews", label: "B", values: [1, null, 2], dashed: true },
    ],
    headline: 6,
    asOf: "F",
    emptyText: "Nothing",
    sampleLabel: false,
  };

  it("emits stroke-dasharray only for dashed lines", () => {
    const svg = renderChartSvg(spec);
    expect(count(svg, /<path class="line/g)).toBe(2);
    expect(svg.match(/<path class="line views"[^>]*>/)![0]).not.toContain("stroke-dasharray");
    expect(svg.match(/<path class="line uniqueViews"[^>]*>/)![0]).toContain("stroke-dasharray");
  });

  it("keys each line only when there is more than one", () => {
    expect(renderChartSvg(spec)).toMatch(/<text [^>]*>B<\/text>/);
    expect(renderChartSvg({ ...spec, lines: [spec.lines[0]!] })).not.toMatch(/<text [^>]*>A<\/text>/);
  });

  it("shows the partial legend item only when a partial day is drawn", () => {
    expect(renderChartSvg(spec)).not.toContain(PARTIAL_TEXT);
    expect(renderChartSvg({ ...spec, partial: [false, false, false] })).not.toContain(PARTIAL_TEXT);
    expect(renderChartSvg({ ...spec, partial: [false, false, true] })).toContain(PARTIAL_TEXT);
  });

  it("renders the placeholder when every value is null", () => {
    const svg = renderChartSvg({
      ...spec,
      lines: spec.lines.map((l) => ({ ...l, values: [null, null, null] })),
    });
    expect(svg).toContain("Nothing");
    expect(svg).not.toContain("<path");
  });
});

describe("per-repository charts", () => {
  const dates = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 7, 7 + i)).toISOString().slice(0, 10));
  const points: RepoSeriesPoint[] = dates.map((date, i) => ({
    date,
    views: i % 10 === 3 ? null : i,
    uniqueViews: i % 10 === 3 ? null : Math.ceil(i / 2),
    clones: i % 10 === 3 ? null : i * 2,
    uniqueCloners: i % 10 === 3 ? null : i,
  }));

  it("draw the metric and a dashed unique line, without partial markers", () => {
    for (const [svg, main, unique] of [
      [repoViewsChart(points, false, false), "views", "uniqueViews"],
      [repoClonesChart(points, false, false), "clones", "uniqueCloners"],
    ] as const) {
      expect(count(svg, /<path class="line /g)).toBe(2);
      expect(pathData(svg, main)).toBeTruthy();
      expect(svg).toMatch(new RegExp(`<path class="line ${unique}"[^>]*stroke-dasharray`));
      expect(svg).not.toMatch(new RegExp(`<path class="line ${main}"[^>]*stroke-dasharray`));
      expect(count(svg, /<circle class="partial"/g)).toBe(0);
      expect(svg).not.toContain(PARTIAL_TEXT);
      expect(svg).toContain("Data through 2026-11-04 (UTC)");
    }
  });

  it("title the 90-day window and headline its total of the main metric", () => {
    const views = repoViewsChart(points, false, false);
    expect(views).toContain("Views · last 90 days");
    expect(repoClonesChart(points, false, false)).toContain("Clones · last 90 days");
    expect(headline(views)).toBe(
      points.reduce((sum, p) => sum + (p.views ?? 0), 0).toLocaleString("en-US"),
    );
    expect(count(views, /<path class="area"/g)).toBe(1);
  });

  it("draws stars as one line headlined by the latest total", () => {
    const svg = repoStarsChart(dates.map((date, i) => ({ date, total: i })), false);
    expect(count(svg, /<path class="line /g)).toBe(1);
    expect(svg).toContain(">Stars</text>");
    expect(headline(svg)).toBe("89");
  });

  it("show the placeholder when nothing is stored", () => {
    const blank = points.map((p) => ({ ...p, views: null, uniqueViews: null, clones: null, uniqueCloners: null }));
    expect(repoViewsChart(blank, false, false)).toContain("No traffic data stored yet");
    expect(repoViewsChart(blank, false, false)).not.toContain("<path");
    expect(repoClonesChart([], false, false)).toContain("No traffic data stored yet");
    expect(repoStarsChart([], false)).toContain("No star history stored");
  });

  it("are byte-stable and drop the sample banner unless asked", () => {
    expect(repoViewsChart(points, false, true)).toBe(repoViewsChart(points, false, true));
    expect(repoViewsChart(points, false, true)).toContain("SAMPLE DATA");
    expect(repoViewsChart(points, false, false)).not.toContain("SAMPLE DATA");
  });
});
