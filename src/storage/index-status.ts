import type { ExcludedRepo } from "../collector/filter.js";
import type {
  CollectMode,
  ErrorKind,
  IndexEntry,
  IndexFile,
  RepoMeta,
  RepoStatus,
  StatusFile,
  Tracking,
} from "../types.js";

export type RepoResult =
  | {
      repoId: number;
      outcome: "success";
      window: { start: string; end: string } | null;
    }
  | { repoId: number; outcome: "error"; kind: ErrorKind };

function entryFrom(repo: RepoMeta, tracking: Tracking): IndexEntry {
  return {
    name: repo.name,
    fullName: repo.fullName,
    private: repo.private,
    fork: repo.fork,
    archived: repo.archived,
    stars: repo.stargazersCount,
    forks: repo.forksCount,
    tracking,
  };
}

function sortedRecord<T>(map: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of [...map.keys()].sort()) out[key] = map.get(key) as T;
  return out;
}

/**
 * Entry set is selected repos plus repos already in `prev`; an excluded repo
 * absent from `prev` is dropped so never-tracked repos stay out of data/.
 *
 * In public mode a repo that turned private keeps its previous entry, only marked
 * `missing`, so the published index reveals neither the change nor its new metadata.
 */
export function updateIndex(
  prev: IndexFile | undefined,
  selection: { selected: RepoMeta[]; excluded: ExcludedRepo[] },
  mode: CollectMode,
): IndexFile {
  const known = prev?.repositories ?? {};
  const next = new Map<string, IndexEntry>();

  for (const repo of selection.selected) {
    next.set(String(repo.id), entryFrom(repo, "tracked"));
  }
  for (const { repo, reason } of selection.excluded) {
    const key = String(repo.id);
    if (!(key in known) || (mode === "public" && repo.private)) continue;
    next.set(key, entryFrom(repo, `excluded:${reason}`));
  }
  for (const [key, entry] of Object.entries(known)) {
    if (!next.has(key)) next.set(key, { ...entry, tracking: "missing" });
  }

  return { schemaVersion: 1, repositories: sortedRecord(next) };
}

/**
 * `dataThroughDate` is the last date every repository collected in this run has
 * data for (the earliest window end): GitHub's windows end on different days per
 * repository, and the latest one would leave the newest day permanently partial.
 * Failed repositories don't hold it back. Without any window it stays as before.
 *
 * `lastError.date` is when the current error started; it is kept while the same
 * kind repeats, so a long outage reads as such and doesn't rewrite status daily.
 */
export function updateStatus(
  prev: StatusFile | undefined,
  results: RepoResult[],
  runDate: string,
): StatusFile {
  const next = new Map<string, RepoStatus>();
  for (const [key, status] of Object.entries(prev?.repositories ?? {})) {
    next.set(key, { ...status });
  }
  let earliestEnd: string | null = null;

  for (const result of results) {
    const key = String(result.repoId);
    const status: RepoStatus = next.get(key) ?? {
      lastSuccessDate: null,
      lastError: null,
    };
    if (result.outcome === "error") {
      if (status.lastError?.kind !== result.kind) {
        status.lastError = { kind: result.kind, date: runDate };
      }
    } else {
      status.lastError = null;
      if (result.window) {
        const end = result.window.end;
        status.lastSuccessDate = end;
        if (earliestEnd === null || end < earliestEnd) earliestEnd = end;
      }
    }
    next.set(key, status);
  }

  return {
    schemaVersion: 1,
    dataThroughDate: earliestEnd ?? prev?.dataThroughDate ?? null,
    repositories: sortedRecord(next),
  };
}
