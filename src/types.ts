/** Dates are YYYY-MM-DD (UTC) strings. */

export interface DayMetrics {
  views: number;
  uniqueViews: number;
  clones: number;
  uniqueCloners: number;
}

export interface MonthFile {
  schemaVersion: 1;
  repositoryId: number;
  /** YYYY-MM */
  month: string;
  /** Keyed by YYYY-MM-DD. */
  days: Record<string, DayMetrics>;
}

export interface RepoMeta {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazersCount: number;
  forksCount: number;
}

export type ExcludeReason =
  | 'self'
  | 'private'
  | 'fork'
  | 'archived'
  | 'exclude_pattern'
  | 'not_included';

/** `public`: a public Traffolio repository publishing traffic under `public_mode`. */
export type CollectMode = 'private' | 'public';

export type Tracking = 'tracked' | `excluded:${ExcludeReason}` | 'missing';

export interface IndexEntry {
  name: string;
  fullName: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stars: number;
  forks: number;
  tracking: Tracking;
}

export interface IndexFile {
  schemaVersion: 1;
  /** Keyed by repository id. */
  repositories: Record<string, IndexEntry>;
}

export type ErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'transient'
  | 'rate_limited'
  | 'unknown';

export type Outcome = 'ok' | 'partial' | 'fatal' | 'skipped';

export interface RepoStatus {
  lastSuccessDate: string | null;
  lastError: { kind: ErrorKind; date: string } | null;
}

export interface StatusFile {
  schemaVersion: 1;
  dataThroughDate: string | null;
  /** Keyed by repository id. */
  repositories: Record<string, RepoStatus>;
}

/**
 * data/growth/<repoId>.json — stars and forks per UTC date, rebuilt from GitHub's
 * weekly star history (per-day counts, possibly a day off since GitHub's days
 * aren't UTC) and the fork list (`created_at`), so history goes back to the
 * repository's start. Both cover only current stars and existing forks, so past
 * totals can be slightly lower than they really were.
 */
export interface GrowthFile {
  schemaVersion: 1;
  repositoryId: number;
  /** Stars given on each date (that still exist). */
  stars: Record<string, number>;
  /** Forks created on each date (that still exist). */
  forks: Record<string, number>;
}

export interface ReferrerEntry {
  referrer: string;
  count: number;
  uniques: number;
}

export interface PathEntry {
  path: string;
  title: string;
  count: number;
  uniques: number;
}

/** GitHub's top 10 referrers and paths over the 14 days before the run date. */
export interface ReferrerSnapshot {
  referrers: ReferrerEntry[];
  paths: PathEntry[];
}

/** data/referrers/<repoId>/<YYYY-MM>.json — one snapshot per run date (UTC). */
export interface ReferrerMonthFile {
  schemaVersion: 1;
  repositoryId: number;
  /** YYYY-MM */
  month: string;
  /** Keyed by run date YYYY-MM-DD. */
  snapshots: Record<string, ReferrerSnapshot>;
}

export interface ReleaseInfo {
  tag: string;
  name: string;
  /** YYYY-MM-DD, or null when GitHub has none. */
  publishedDate: string | null;
}

/**
 * data/releases/<repoId>.json — cumulative downloads per published release as of
 * each run date (assets only; updater metadata such as latest.yml excluded).
 * Daily downloads are the difference between consecutive snapshots.
 */
export interface ReleasesFile {
  schemaVersion: 1;
  repositoryId: number;
  /** Keyed by GitHub release id. */
  releases: Record<string, ReleaseInfo>;
  /** Run date YYYY-MM-DD -> release id -> cumulative downloads. */
  snapshots: Record<string, Record<string, number>>;
}
