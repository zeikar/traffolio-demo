import { enumerateDates } from "../collector/normalize.js";
import type {
  DayMetrics,
  IndexFile,
  MonthFile,
  RepoStatus,
  StatusFile,
  Tracking,
} from "../types.js";

export type DayMap = ReadonlyMap<string, DayMetrics>;

/**
 * Sums over the keys that exist in a date range. `views`/`clones` are `null`
 * exactly when `presentDays === 0` ("no data"), so renderers can't mistake it
 * for a real zero.
 */
export interface PeriodSum {
  views: number | null;
  clones: number | null;
  presentDays: number;
  missingDays: number;
  /** Present dates where some tracked repos have no key (multi-repo sums only). */
  partialDays: number;
}

/** Some days of the period have no data, or lack some repositories: the total is marked `*`. */
export const isIncomplete = (p: PeriodSum): boolean => p.missingDays > 0 || p.partialDays > 0;

export interface PeriodTotals {
  d7: PeriodSum;
  d30: PeriodSum;
  all: PeriodSum;
}

export interface SeriesPoint {
  date: string;
  /** `null` when no tracked repo has a key for the date. */
  views: number | null;
  clones: number | null;
  /** Some, but not all, tracked repos have a key for the date. */
  partial: boolean;
}

export interface DashboardRow {
  id: string;
  name: string;
  fullName: string;
  visibility: "public" | "private";
  stars: number;
  forks: number;
  tracking: Tracking;
  lastError: RepoStatus["lastError"];
  d7: PeriodSum;
  d30: PeriodSum;
  /** This repo's own 30 days ending at `dataThroughDate`; empty when it is `null`. */
  series: SeriesPoint[];
}

export interface DashboardModel {
  dataThroughDate: string | null;
  totals: PeriodTotals | null;
  /** Every index entry (tracked, excluded, missing), by fullName case-insensitive. */
  rows: DashboardRow[];
  /** Tracked repos whose status has a non-null `lastError`. */
  failedCount: number;
  /** 30 days ending at `dataThroughDate`; empty when it is `null`. */
  series: SeriesPoint[];
}

export const SERIES_DAYS = 30;
export const REPO_SERIES_DAYS = 90;

/** One repository's day with the unique counts; all four `null` when the date has no key. */
export interface RepoSeriesPoint {
  date: string;
  views: number | null;
  uniqueViews: number | null;
  clones: number | null;
  uniqueCloners: number | null;
}

const noData = (missingDays = 0): PeriodSum => ({
  views: null,
  clones: null,
  presentDays: 0,
  missingDays,
  partialDays: 0,
});

export function daysFromMonthFiles(files: MonthFile[]): DayMap {
  const days = new Map<string, DayMetrics>();
  for (const file of files) {
    for (const [date, metrics] of Object.entries(file.days)) days.set(date, metrics);
  }
  return days;
}

export function shiftDate(date: string, deltaDays: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + deltaDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function earliestDate(days: DayMap): string | undefined {
  let min: string | undefined;
  for (const date of days.keys()) if (min === undefined || date < min) min = date;
  return min;
}

/**
 * Per date: summed over the repos that have the key; `null` if none do.
 * A repo counts toward `partial` only from its tracking start on: dates
 * before a repo's first collection are "not tracked yet", not missing.
 */
function dayTotals(repos: DayMap[], starts: string[], date: string): SeriesPoint {
  let views = 0;
  let clones = 0;
  let present = 0;
  let expected = 0;
  repos.forEach((days, i) => {
    if (starts[i]! > date) return;
    expected++;
    const m = days.get(date);
    if (!m) return;
    views += m.views;
    clones += m.clones;
    present++;
  });
  if (present === 0) return { date, views: null, clones: null, partial: false };
  return { date, views, clones, partial: present < expected };
}

/**
 * Each repo's tracking start: its earliest key. A repo with no keys at all
 * (its first collection failed) gets "": its real start is unknown, so it is
 * expected on every date of the scope's tracked range and still marks those
 * days partial. Alone, it has no tracked range and sums to "no data".
 */
function trackingStarts(repos: DayMap[]): string[] {
  return repos.map((days) => earliestDate(days) ?? "");
}

/**
 * Totals over the inclusive [start, end] range, clipped to begin at the
 * earliest key of any repo so days before tracking began are not "missing".
 * A date counts as present if at least one repo has a key for it, missing
 * otherwise; partial dates also count in `partialDays` so totals can be
 * flagged incomplete.
 */
function sumRange(repos: DayMap[], start: string, end: string): PeriodSum {
  const starts = trackingStarts(repos);
  const first = starts.filter((d) => d !== "").sort()[0];
  if (first === undefined) return noData();
  if (start < first) start = first;
  if (start > end) return noData();
  let views = 0;
  let clones = 0;
  let presentDays = 0;
  let missingDays = 0;
  let partialDays = 0;
  for (const date of enumerateDates(start, end)) {
    const day = dayTotals(repos, starts, date);
    if (day.views === null || day.clones === null) {
      missingDays++;
      continue;
    }
    views += day.views;
    clones += day.clones;
    presentDays++;
    if (day.partial) partialDays++;
  }
  if (presentDays === 0) return noData(missingDays);
  return { views, clones, presentDays, missingDays, partialDays };
}

/**
 * Single-repo sum. A numeric length covers [endDate - length + 1, endDate];
 * 'all' covers [this repo's earliest key, endDate]. Either way the range
 * starts no earlier than the repo's earliest key.
 */
export function sumPeriod(days: DayMap, endDate: string, length: number | "all"): PeriodSum {
  return sumRange([days], length === "all" ? "" : shiftDate(endDate, 1 - length), endDate);
}

/** Across repos; 'all' starts at the earliest key of any of them. */
export function periodTotals(repos: DayMap[], endDate: string): PeriodTotals {
  return {
    d7: sumRange(repos, shiftDate(endDate, -6), endDate),
    d30: sumRange(repos, shiftDate(endDate, -29), endDate),
    all: sumRange(repos, "", endDate),
  };
}

export function dailySeries(repos: DayMap[], endDate: string, length: number): SeriesPoint[] {
  const starts = trackingStarts(repos);
  return enumerateDates(shiftDate(endDate, 1 - length), endDate).map((date) =>
    dayTotals(repos, starts, date),
  );
}

/**
 * A single repository's last `length` days ending at `endDate`. A date without a key is `null`
 * whether it is missing or before tracking began: neither draws anything, never a 0.
 */
export function repoSeries(days: DayMap, endDate: string, length: number): RepoSeriesPoint[] {
  return enumerateDates(shiftDate(endDate, 1 - length), endDate).map((date) => {
    const m = days.get(date);
    return m
      ? { date, views: m.views, uniqueViews: m.uniqueViews, clones: m.clones, uniqueCloners: m.uniqueCloners }
      : { date, views: null, uniqueViews: null, clones: null, uniqueCloners: null };
  });
}

/**
 * Totals, series, partial flags and failedCount cover only `tracked` repos.
 * Excluded/missing repos keep their history and still get a row, computed the
 * same way, labelled with their tracking status.
 */
export function buildDashboardModel(
  index: IndexFile,
  status: StatusFile,
  monthFilesByRepo: Record<string, MonthFile[]>,
): DashboardModel {
  const end = status.dataThroughDate;
  const entries = Object.entries(index.repositories).sort(([, a], [, b]) => {
    const x = a.fullName.toLowerCase();
    const y = b.fullName.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });

  const tracked: DayMap[] = [];
  let failedCount = 0;
  const rows = entries.map(([id, entry]): DashboardRow => {
    const days = daysFromMonthFiles(monthFilesByRepo[id] ?? []);
    const lastError = status.repositories[id]?.lastError ?? null;
    if (entry.tracking === "tracked") {
      tracked.push(days);
      if (lastError) failedCount++;
    }
    return {
      id,
      name: entry.name,
      fullName: entry.fullName,
      visibility: entry.private ? "private" : "public",
      stars: entry.stars,
      forks: entry.forks,
      tracking: entry.tracking,
      lastError,
      d7: end === null ? noData() : sumPeriod(days, end, 7),
      d30: end === null ? noData() : sumPeriod(days, end, 30),
      series: end === null ? [] : dailySeries([days], end, SERIES_DAYS),
    };
  });

  return {
    dataThroughDate: end,
    totals: end === null ? null : periodTotals(tracked, end),
    rows,
    failedCount,
    series: end === null ? [] : dailySeries(tracked, end, SERIES_DAYS),
  };
}
