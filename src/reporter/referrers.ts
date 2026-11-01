import type { Store } from "../storage/store.js";
import type { IndexFile, ReferrerMonthFile } from "../types.js";

export interface TopReferrers {
  /** Run date of the snapshots that were summed. */
  date: string;
  referrers: { referrer: string; count: number }[];
}

const TOP_REFERRERS = 5;

/**
 * Sums referrer counts over the snapshots taken on the newest snapshot date among `files`, so a
 * repository whose referrers failed lately drops out instead of contributing stale numbers.
 * Uniques are not summed: the same person can visit several repositories. Null when there is nothing to show.
 */
export function topReferrers(files: ReferrerMonthFile[]): TopReferrers | null {
  const date = files
    .flatMap((f) => Object.keys(f.snapshots))
    .sort()
    .at(-1);
  if (date === undefined) return null;
  const totals = new Map<string, number>();
  for (const file of files) {
    for (const r of file.snapshots[date]?.referrers ?? []) totals.set(r.referrer, (totals.get(r.referrer) ?? 0) + r.count);
  }
  if (totals.size === 0) return null;
  const referrers = [...totals]
    .map(([referrer, count]) => ({ referrer, count }))
    .sort((a, b) => b.count - a.count || (a.referrer < b.referrer ? -1 : a.referrer > b.referrer ? 1 : 0))
    .slice(0, TOP_REFERRERS);
  return { date, referrers };
}

/** Top referrers over each tracked repository's newest month file; `computed` (this run's files) win over stored ones. */
export async function readTopReferrers(
  store: Store,
  index: IndexFile,
  computed: ReferrerMonthFile[],
): Promise<TopReferrers | null> {
  const byId = new Map(computed.map((f) => [String(f.repositoryId), f]));
  const files: ReferrerMonthFile[] = [];
  for (const [id, entry] of Object.entries(index.repositories)) {
    if (entry.tracking !== "tracked") continue;
    const file = byId.get(id) ?? (await store.readLatestReferrerMonth(id));
    if (file) files.push(file);
  }
  return topReferrers(files);
}
