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

const PARTIAL_TEXT =
  "partial day — one or more tracked repos have no data for that date";

describe("README charts", () => {
  it("are byte-stable across calls", () => {
    expect(viewsChart(series, true)).toBe(viewsChart(series, true));
    expect(clonesChart(series, true)).toBe(clonesChart(series, true));
  });

  it("draw exactly one line per chart, broken at missing days", () => {
    expect(gapCount(series)).toBe(1);
    for (const [chart, key] of [
      [viewsChart(series, false), "views"],
      [clonesChart(series, false), "clones"],
    ] as const) {
      expect(count(chart, /<path class="line/g)).toBe(1);
      expect(count(pathData(chart, key), /M/g)).toBe(gapCount(series) + 1);
    }
  });

  it("mark each partial day once per chart", () => {
    const partialDays = series.filter((p) => p.partial).length;
    expect(partialDays).toBeGreaterThan(0);
    for (const chart of [viewsChart(series, false), clonesChart(series, false)]) {
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
    expect(count(viewsChart(full, false), /<circle class="partial"/g)).toBe(0);
  });

  it("keep an isolated day visible as its own subpath", () => {
    const svg = viewsChart(
      [
        point("2026-01-01", null),
        point("2026-01-02", 4),
        point("2026-01-03", null),
      ],
      false,
    );
    expect(count(pathData(svg, "views"), /M/g)).toBe(1);
    expect(count(svg, /<circle class="solo"/g)).toBe(1);
  });

  it("show the sample banner only when requested", () => {
    expect(viewsChart(series, true)).toContain("SAMPLE DATA");
    expect(clonesChart(series, true)).toContain("SAMPLE DATA");
    expect(viewsChart(series, false)).not.toContain("SAMPLE DATA");
  });

  it("have titles, state the data date in UTC and carry no script", () => {
    const views = viewsChart(series, true);
    expect(views).toContain("Daily views · last 30 days");
    expect(clonesChart(series, true)).toContain("Daily clones · last 30 days");
    expect(views).toContain(
      "Data through 2026-10-25 (UTC) · daily totals across tracked repos",
    );
    expect(views).not.toMatch(/<script/i);
  });

  it("render a no-data placeholder for an empty series", () => {
    const svg = viewsChart([], false);
    expect(svg).toContain("No traffic data stored yet");
    expect(svg).toContain("UTC");
    expect(svg).not.toContain("<path");
    expect(svg).not.toMatch(/<script/i);
  });

  it("escape text taken from the series", () => {
    const svg = viewsChart([point("<x&y>", 1)], false);
    expect(svg).toContain("&lt;x&amp;y&gt;");
    expect(svg).not.toContain("<x&y>");
  });

  it("use integer coordinates only", () => {
    for (const chart of [viewsChart(series, false), clonesChart(series, false)]) {
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
      { key: "a", label: "A", color: "#111111", values: [1, 2, 3] },
      { key: "b", label: "B", color: "#222222", values: [1, null, 2], dashed: true },
    ],
    footer: "F",
    emptyText: "Nothing",
    sampleLabel: false,
  };

  it("emits stroke-dasharray only for dashed lines", () => {
    const svg = renderChartSvg(spec);
    expect(count(svg, /<path class="line/g)).toBe(2);
    expect(svg.match(/<path class="line a"[^>]*>/)![0]).not.toContain("stroke-dasharray");
    expect(svg.match(/<path class="line b"[^>]*>/)![0]).toContain("stroke-dasharray");
  });

  it("shows the partial legend item only when partial is given", () => {
    expect(renderChartSvg(spec)).not.toContain(PARTIAL_TEXT);
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
      [repoViewsChart(points, false), "views", "uniqueViews"],
      [repoClonesChart(points, false), "clones", "uniqueCloners"],
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

  it("titles the 90-day window", () => {
    expect(repoViewsChart(points, false)).toContain("Daily views · last 90 days");
    expect(repoClonesChart(points, false)).toContain("Daily clones · last 90 days");
  });

  it("draws stars as one line", () => {
    const svg = repoStarsChart(dates.map((date, i) => ({ date, total: i })), false);
    expect(count(svg, /<path class="line /g)).toBe(1);
    expect(svg).toContain("Stars · last 90 days");
  });

  it("show the placeholder when nothing is stored", () => {
    const blank = points.map((p) => ({ ...p, views: null, uniqueViews: null, clones: null, uniqueCloners: null }));
    expect(repoViewsChart(blank, false)).toContain("No traffic data stored yet");
    expect(repoViewsChart(blank, false)).not.toContain("<path");
    expect(repoClonesChart([], false)).toContain("No traffic data stored yet");
    expect(repoStarsChart([], false)).toContain("No star history stored");
  });

  it("are byte-stable and drop the sample banner unless asked", () => {
    expect(repoViewsChart(points, true)).toBe(repoViewsChart(points, true));
    expect(repoViewsChart(points, true)).toContain("SAMPLE DATA");
    expect(repoViewsChart(points, false)).not.toContain("SAMPLE DATA");
  });
});
