import type { ReleaseSummary } from "../collector/extras-normalize.js";
import type { ReferrerMonthFile, ReferrerSnapshot, ReleasesFile } from "../types.js";

/** Sets the run date's snapshot in its month file; a same-day rerun overwrites the same key. */
export function withReferrerSnapshot(
  prev: ReferrerMonthFile | undefined,
  repoId: number,
  runDate: string,
  snapshot: ReferrerSnapshot,
): ReferrerMonthFile {
  return {
    schemaVersion: 1,
    repositoryId: repoId,
    month: runDate.slice(0, 7),
    snapshots: { ...prev?.snapshots, [runDate]: snapshot },
  };
}

/** Keeps metadata of releases that no longer exist; the run date's snapshot is replaced whole. */
export function withReleaseSnapshot(
  prev: ReleasesFile | undefined,
  repoId: number,
  runDate: string,
  summary: ReleaseSummary,
): ReleasesFile {
  return {
    schemaVersion: 1,
    repositoryId: repoId,
    releases: { ...prev?.releases, ...summary.releases },
    snapshots: { ...prev?.snapshots, [runDate]: summary.downloads },
  };
}
