import type { ExtrasFiles } from "../collect-extras.js";
import { enumerateDates } from "../collector/normalize.js";
import type { Store } from "../storage/store.js";
import type {
  GrowthFile,
  PathEntry,
  ReferrerEntry,
  ReferrerMonthFile,
  ReleasesFile,
  RepoStatus,
  Tracking,
} from "../types.js";
import {
  REPO_SERIES_DAYS,
  repoSeries,
  shiftDate,
  sumPeriod,
  type DashboardRow,
  type DayMap,
  type PeriodSum,
  type RepoSeriesPoint,
} from "./aggregate.js";

export type RepoCounts<T> = Record<"d7" | "d30" | "d90" | "all", T>;

export interface RepoPageModel {
  id: string;
  name: string;
  fullName: string;
  visibility: "public" | "private";
  /** Same types as `DashboardRow`, so `statusLabel` accepts the model. */
  tracking: Tracking;
  lastError: RepoStatus["lastError"];
  dataThroughDate: string | null;
  totals: RepoCounts<PeriodSum>;
  /** The last `REPO_SERIES_DAYS` days ending at `dataThroughDate`; empty when it is `null`. */
  series: RepoSeriesPoint[];
  growth: {
    /** Cumulative stars over the series window; earlier stars are folded into the first total. */
    stars: { date: string; total: number }[];
    newStars: RepoCounts<number>;
    newForks: RepoCounts<number>;
  } | null;
  referrers: { date: string; referrers: ReferrerEntry[]; paths: PathEntry[] } | null;
  releases: {
    asOf: string;
    /** Snapshot the change is measured from; `null` when no snapshot is old enough. */
    baseDate: string | null;
    rows: { tag: string; name: string; publishedDate: string | null; total: number; change: number | null }[];
  } | null;
}

export interface RepoExtras {
  growth?: GrowthFile;
  referrers?: ReferrerMonthFile;
  releases?: ReleasesFile;
}

const PERIODS = { d7: 7, d30: 30, d90: 90, all: "all" } as const;
const RELEASE_BASE_DAYS = 30;

const mapPeriods = <T>(fn: (length: number | "all") => T): RepoCounts<T> => ({
  d7: fn(PERIODS.d7),
  d30: fn(PERIODS.d30),
  d90: fn(PERIODS.d90),
  all: fn(PERIODS.all),
});

const noTotals = (): PeriodSum => ({ views: null, clones: null, presentDays: 0, missingDays: 0, partialDays: 0 });

/** Mirrors CLIENT_LOGIC `growthAdded` for one repository: dates in [end - length + 1, end], or up to `end` for "all". */
function added(counts: Record<string, number>, end: string, length: number | "all"): number {
  const start = length === "all" ? null : shiftDate(end, 1 - length);
  let total = 0;
  for (const [date, n] of Object.entries(counts)) if ((start === null || date >= start) && date <= end) total += n;
  return total;
}

/** Mirrors CLIENT_LOGIC `starSeries`: stars before the window start are folded into the first total. */
function starSeries(stars: Record<string, number>, start: string, end: string): { date: string; total: number }[] {
  let total = 0;
  for (const [date, n] of Object.entries(stars)) if (date < start) total += n;
  return enumerateDates(start, end).map((date) => {
    total += stars[date] ?? 0;
    return { date, total };
  });
}

function newestSnapshotDate(dates: string[]): string | undefined {
  return dates.sort().at(-1);
}

function releaseSection(file: ReleasesFile): RepoPageModel["releases"] {
  const dates = Object.keys(file.snapshots).sort();
  const asOf = dates.at(-1);
  if (asOf === undefined) return null;
  const limit = shiftDate(asOf, -RELEASE_BASE_DAYS);
  const baseDate = dates.filter((d) => d <= limit).at(-1) ?? null;
  const base = baseDate === null ? null : file.snapshots[baseDate]!;
  const latest = file.snapshots[asOf]!;
  const rows = Object.keys(latest)
    .map((id) => {
      const info = file.releases[id];
      const total = latest[id]!;
      return {
        id,
        tag: info?.tag ?? `#${id}`,
        name: info?.name ?? "",
        publishedDate: info?.publishedDate ?? null,
        total,
        change: base === null ? null : total - (base[id] ?? 0),
      };
    })
    .sort((a, b) => {
      if (a.publishedDate !== b.publishedDate) {
        if (a.publishedDate === null) return 1;
        if (b.publishedDate === null) return -1;
        return a.publishedDate < b.publishedDate ? 1 : -1;
      }
      return Number(b.id) - Number(a.id);
    })
    .map(({ id: _id, ...row }) => row);
  return { asOf, baseDate, rows };
}

export function buildRepoPageModel(
  row: DashboardRow,
  days: DayMap,
  end: string | null,
  extras: RepoExtras,
): RepoPageModel {
  const referrerDate = extras.referrers && newestSnapshotDate(Object.keys(extras.referrers.snapshots));
  const snapshot = referrerDate === undefined || referrerDate === null ? undefined : extras.referrers!.snapshots[referrerDate];
  const start = end === null ? null : shiftDate(end, 1 - REPO_SERIES_DAYS);

  return {
    id: row.id,
    name: row.name,
    fullName: row.fullName,
    visibility: row.visibility,
    tracking: row.tracking,
    lastError: row.lastError,
    dataThroughDate: end,
    totals: mapPeriods((length) => (end === null ? noTotals() : sumPeriod(days, end, length))),
    series: end === null ? [] : repoSeries(days, end, REPO_SERIES_DAYS),
    growth:
      extras.growth && end !== null && start !== null
        ? {
            stars: starSeries(extras.growth.stars, start, end),
            newStars: mapPeriods((length) => added(extras.growth!.stars, end, length)),
            newForks: mapPeriods((length) => added(extras.growth!.forks, end, length)),
          }
        : null,
    referrers:
      referrerDate && snapshot
        ? { date: referrerDate, referrers: snapshot.referrers, paths: snapshot.paths }
        : null,
    releases: extras.releases ? releaseSection(extras.releases) : null,
  };
}

/** This run's files (matched by repository id) win over the stored ones, as in `readTopReferrers`. */
export async function loadRepoExtras(store: Store, id: string, computed: ExtrasFiles): Promise<RepoExtras> {
  const match = <T extends { repositoryId: number }>(files: T[]): T | undefined =>
    files.find((f) => String(f.repositoryId) === id);
  const growth = match(computed.growth) ?? (await store.readGrowth(id));
  const referrers = match(computed.referrers) ?? (await store.readLatestReferrerMonth(id));
  const releases = match(computed.releases) ?? (await store.readReleases(id));
  return {
    ...(growth && { growth }),
    ...(referrers && { referrers }),
    ...(releases && { releases }),
  };
}
