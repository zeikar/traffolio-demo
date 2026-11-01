import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  enumerateDates,
  normalizeTraffic,
  toUtcDate,
  type TrafficPoint,
} from "../../src/collector/normalize.js";

async function fixture(name: string): Promise<TrafficPoint[]> {
  const raw = await readFile(new URL(`../../fixtures/api/${name}`, import.meta.url), "utf8");
  return (JSON.parse(raw) as Record<string, TrafficPoint[]>)[name.includes("views") ? "views" : "clones"]!;
}

const pt = (date: string, count: number, uniques: number): TrafficPoint => ({
  timestamp: `${date}T00:00:00Z`,
  count,
  uniques,
});

describe("toUtcDate / enumerateDates", () => {
  it("maps non-midnight timestamps to the UTC date", () => {
    expect(toUtcDate("2026-10-12T23:59:59Z")).toBe("2026-10-12");
    expect(toUtcDate("2026-10-12T23:30:00-05:00")).toBe("2026-10-13");
  });

  it("enumerates inclusively across month boundaries", () => {
    expect(enumerateDates("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("normalizeTraffic", () => {
  it("normalizes the fixture pair to 14 days, keeping zero days", async () => {
    const views = await fixture("traffic-views.json");
    const clones = await fixture("traffic-clones.json");
    const { window, days } = normalizeTraffic(views, clones);
    expect(window).toEqual({ start: "2026-10-12", end: "2026-10-25" });
    expect(Object.keys(days)).toHaveLength(14);
    expect(days["2026-10-12"]).toMatchObject({ views: 12, uniqueViews: 5 });
    expect(days["2026-10-14"]!.views).toBe(0);
  });

  it("fills a missing interior day with zeros", () => {
    const views = [pt("2026-10-01", 3, 2), pt("2026-10-03", 4, 1)];
    const clones = [pt("2026-10-01", 1, 1), pt("2026-10-02", 2, 2), pt("2026-10-03", 5, 3)];
    const { days } = normalizeTraffic(views, clones);
    expect(Object.keys(days)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(days["2026-10-02"]).toEqual({ views: 0, uniqueViews: 0, clones: 2, uniqueCloners: 2 });
    expect(days["2026-10-03"]).toEqual({ views: 4, uniqueViews: 1, clones: 5, uniqueCloners: 3 });
  });

  it("returns only the intersection for mismatched ranges", () => {
    const views = [pt("2026-10-01", 1, 1), pt("2026-10-05", 1, 1)];
    const clones = [pt("2026-10-03", 2, 2), pt("2026-10-08", 2, 2)];
    const { window, days } = normalizeTraffic(views, clones);
    expect(window).toEqual({ start: "2026-10-03", end: "2026-10-05" });
    expect(Object.keys(days)).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
  });

  it("returns a null window when ranges do not overlap", () => {
    const r = normalizeTraffic([pt("2026-10-01", 1, 1)], [pt("2026-10-05", 1, 1)]);
    expect(r).toEqual({ window: null, days: {} });
  });

  it("returns a null window when either array is empty", () => {
    expect(normalizeTraffic([], [pt("2026-10-01", 1, 1)])).toEqual({ window: null, days: {} });
    expect(normalizeTraffic([pt("2026-10-01", 1, 1)], [])).toEqual({ window: null, days: {} });
  });

  it("handles unsorted input and non-midnight timestamps", () => {
    const views = [
      { timestamp: "2026-10-02T13:45:00Z", count: 7, uniques: 3 },
      { timestamp: "2026-10-01T08:00:00Z", count: 1, uniques: 1 },
    ];
    const clones = [pt("2026-10-02", 2, 2), pt("2026-10-01", 1, 1)];
    const { window, days } = normalizeTraffic(views, clones);
    expect(window).toEqual({ start: "2026-10-01", end: "2026-10-02" });
    expect(days["2026-10-02"]).toEqual({ views: 7, uniqueViews: 3, clones: 2, uniqueCloners: 2 });
  });
});
