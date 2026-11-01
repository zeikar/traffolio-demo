import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildDashboardModel,
  type SeriesPoint,
} from "../../src/reporter/aggregate.js";
import { renderTrafficSvg } from "../../src/reporter/svg.js";
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

function pathData(svg: string, metric: "views" | "clones"): string {
  const match = svg.match(
    new RegExp(`<path class="line ${metric}" d="([^"]*)"`),
  );
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

describe("renderTrafficSvg", () => {
  it("is byte-stable across calls", () => {
    expect(renderTrafficSvg(series, { sampleLabel: true })).toBe(
      renderTrafficSvg(series, { sampleLabel: true }),
    );
  });

  it("breaks each metric's line at missing days", () => {
    const svg = renderTrafficSvg(series, { sampleLabel: false });
    expect(gapCount(series)).toBe(1);
    for (const metric of ["views", "clones"] as const) {
      expect(count(pathData(svg, metric), /M/g)).toBe(gapCount(series) + 1);
    }
  });

  it("marks partial days on both metrics", () => {
    const partialDays = series.filter((p) => p.partial).length;
    expect(partialDays).toBeGreaterThan(0);
    const svg = renderTrafficSvg(series, { sampleLabel: false });
    expect(count(svg, /<circle class="partial"/g)).toBe(partialDays * 2);
    expect(svg).toContain(
      "partial day — one or more tracked repos have no data for that date",
    );
  });

  it("draws no partial markers when no day is partial", () => {
    const full = [
      point("2026-01-01", 3),
      point("2026-01-02", 0),
      point("2026-01-03", 5),
    ];
    expect(
      count(
        renderTrafficSvg(full, { sampleLabel: false }),
        /<circle class="partial"/g,
      ),
    ).toBe(0);
  });

  it("keeps an isolated day visible as its own subpath", () => {
    const svg = renderTrafficSvg(
      [
        point("2026-01-01", null),
        point("2026-01-02", 4),
        point("2026-01-03", null),
      ],
      { sampleLabel: false },
    );
    expect(count(pathData(svg, "views"), /M/g)).toBe(1);
    expect(count(svg, /<circle class="solo"/g)).toBe(2);
  });

  it("shows the sample banner only when requested", () => {
    expect(renderTrafficSvg(series, { sampleLabel: true })).toContain(
      "SAMPLE DATA",
    );
    expect(renderTrafficSvg(series, { sampleLabel: false })).not.toContain(
      "SAMPLE DATA",
    );
  });

  it("states the data date in UTC and has no script", () => {
    const svg = renderTrafficSvg(series, { sampleLabel: true });
    expect(svg).toContain(
      "Data through 2026-10-25 (UTC) · daily totals across tracked repos",
    );
    expect(svg).not.toMatch(/<script/i);
  });

  it("renders a no-data placeholder for an empty series", () => {
    const svg = renderTrafficSvg([], { sampleLabel: false });
    expect(svg).toContain("No traffic data stored yet");
    expect(svg).toContain("UTC");
    expect(svg).not.toContain("<path");
    expect(svg).not.toMatch(/<script/i);
  });

  it("escapes text taken from the series", () => {
    const svg = renderTrafficSvg([point("<x&y>", 1)], { sampleLabel: false });
    expect(svg).toContain("&lt;x&amp;y&gt;");
    expect(svg).not.toContain("<x&y>");
  });
});
