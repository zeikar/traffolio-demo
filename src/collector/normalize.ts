import type { DayMetrics } from "../types.js";

export interface TrafficPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

export interface NormalizedTraffic {
  window: { start: string; end: string } | null;
  days: Record<string, DayMetrics>;
}

export function toUtcDate(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Inclusive list of YYYY-MM-DD dates from start to end. */
export function enumerateDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last; t += 86_400_000) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  return dates;
}

function indexByDate(points: TrafficPoint[]): Map<string, TrafficPoint> {
  return new Map(points.map((p) => [toUtcDate(p.timestamp), p]));
}

/**
 * The window is the intersection of the views and clones ranges; dates inside
 * it missing from an array are 0, dates outside it are not reported.
 */
export function normalizeTraffic(
  views: TrafficPoint[],
  clones: TrafficPoint[],
): NormalizedTraffic {
  if (views.length === 0 || clones.length === 0) return { window: null, days: {} };

  const viewMap = indexByDate(views);
  const cloneMap = indexByDate(clones);
  const viewDates = [...viewMap.keys()].sort();
  const cloneDates = [...cloneMap.keys()].sort();

  const start = viewDates[0]! > cloneDates[0]! ? viewDates[0]! : cloneDates[0]!;
  const lastView = viewDates[viewDates.length - 1]!;
  const lastClone = cloneDates[cloneDates.length - 1]!;
  const end = lastView < lastClone ? lastView : lastClone;
  if (start > end) return { window: null, days: {} };

  const days: Record<string, DayMetrics> = {};
  for (const date of enumerateDates(start, end)) {
    const v = viewMap.get(date);
    const c = cloneMap.get(date);
    days[date] = {
      views: v?.count ?? 0,
      uniqueViews: v?.uniques ?? 0,
      clones: c?.count ?? 0,
      uniqueCloners: c?.uniques ?? 0,
    };
  }
  return { window: { start, end }, days };
}
