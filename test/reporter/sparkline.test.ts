import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "../../src/reporter/aggregate.js";
import { renderSparklineSvg } from "../../src/reporter/sparkline.js";

const point = (
  date: string,
  views: number | null,
  clones: number | null = views,
): SeriesPoint => ({ date, views, clones, partial: false });

const day = (i: number): string => `2026-10-${String(i + 1).padStart(2, "0")}`;

function pathData(svg: string, metric: "views" | "clones"): string | undefined {
  return svg.match(new RegExp(`<path class="${metric}" d="([^"]*)"`))?.[1];
}

const count = (text: string, pattern: RegExp): number =>
  text.match(pattern)?.length ?? 0;

/** Every `y` coordinate in a path's `M`/`L` commands. */
const ys = (d: string): number[] =>
  [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[2]));

const series = Array.from({ length: 30 }, (_, i) =>
  point(day(i), (i * 7) % 11, i % 4),
);

describe("renderSparklineSvg", () => {
  it("is a self-contained, deterministic SVG with a generic title", () => {
    const svg = renderSparklineSvg(series);
    expect(svg).toBe(renderSparklineSvg(structuredClone(series)));
    expect(svg).toMatch(
      /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="28" viewBox="0 0 120 28" role="img"/,
    );
    expect(svg).toContain("<title>30-day views and clones</title>");
    expect(svg).not.toMatch(/<script|href=|on\w+=/i);
    // Light card so the lines stay legible on GitHub's dark theme.
    expect(svg).toMatch(/<rect [^>]*fill="#ffffff"/);
  });

  it("draws views and clones with the main chart's colors on a shared scale", () => {
    const svg = renderSparklineSvg([point(day(0), 10, 5), point(day(1), 0, 10)]);
    expect(svg).toMatch(/<path class="views" [^>]*stroke="#0969da"/);
    expect(svg).toMatch(/<path class="clones" [^>]*stroke="#bc4c00"/);
    const [v0, v1] = ys(pathData(svg, "views")!);
    const [c0, c1] = ys(pathData(svg, "clones")!);
    // Same peak value (10) maps to the same top y; 0 maps to the baseline.
    expect(v0).toBe(c1);
    expect(v1).toBeGreaterThan(c0!);
    expect(v1).toBeGreaterThan(v0!);
  });

  it("breaks the line at null days into separate subpaths", () => {
    const gappy = series.map((p, i) =>
      i >= 10 && i < 14 ? point(p.date, null) : p,
    );
    const svg = renderSparklineSvg(gappy);
    expect(count(pathData(svg, "views")!, /M/g)).toBe(2);
    expect(count(pathData(svg, "clones")!, /M/g)).toBe(2);
  });

  it("keeps an isolated day visible", () => {
    const svg = renderSparklineSvg([
      point(day(0), null),
      point(day(1), 4),
      point(day(2), null),
    ]);
    expect(count(pathData(svg, "views")!, /M/g)).toBe(1);
    expect(count(svg, /<circle class="solo"/g)).toBe(2);
  });

  it("draws an all-zero window as a flat baseline", () => {
    const svg = renderSparklineSvg(series.map((p) => point(p.date, 0)));
    for (const metric of ["views", "clones"] as const) {
      const values = ys(pathData(svg, metric)!);
      expect(values).toHaveLength(30);
      expect(new Set(values).size).toBe(1);
      expect(values.every(Number.isFinite)).toBe(true);
    }
  });

  it("renders a no-data placeholder for an empty or all-null series", () => {
    for (const input of [[], series.map((p) => point(p.date, null))]) {
      const svg = renderSparklineSvg(input);
      expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(svg).toContain("no data");
      expect(svg).not.toContain("<path");
      expect(svg).toMatch(/<rect [^>]*fill="#ffffff"/);
      expect(svg).not.toMatch(/<script/i);
    }
  });
});
