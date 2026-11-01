import type { PathEntry, ReferrerEntry, ReleaseInfo } from "../types.js";
import type { ReleaseItem, StarWeekItem } from "./extras-api.js";
import { toUtcDate } from "./normalize.js";

/** Number of timestamps on each UTC date. */
export function countByDate(timestamps: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const ts of timestamps) {
    const date = toUtcDate(ts);
    counts[date] = (counts[date] ?? 0) + 1;
  }
  return counts;
}

const DAY_MS = 86_400_000;

/** Stars on each date: day i of a week is the week's UTC date plus i days. Days without stars are omitted. */
export function countStarHistory(weeks: StarWeekItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { week, days } of weeks) {
    days.forEach((count, i) => {
      if (count === 0) return;
      const date = new Date(week * 1000 + i * DAY_MS).toISOString().slice(0, 10);
      counts[date] = (counts[date] ?? 0) + count;
    });
  }
  return counts;
}

const byCountThen = (a: { count: number }, b: { count: number }, x: string, y: string): number =>
  b.count - a.count || (x < y ? -1 : x > y ? 1 : 0);

/** Count descending, then name ascending, so equal responses serialize identically. */
export function sortReferrers(entries: ReferrerEntry[]): ReferrerEntry[] {
  return [...entries].sort((a, b) => byCountThen(a, b, a.referrer, b.referrer));
}

export function sortPaths(entries: PathEntry[]): PathEntry[] {
  return [...entries].sort((a, b) => byCountThen(a, b, a.path, b.path));
}

// Updater metadata, signatures and checksums are fetched by tools rather than downloaded by people.
// Matched by name so real deliverables such as dataset.json or rules.yaml still count.
const METADATA_ASSET =
  /^latest(-[^/]+)?\.(ya?ml|json)$|\.(blockmap|sig|asc|minisig|sha1|sha256|sha512|md5)$|^(sha\d*|md5)sums|checksums.*\.txt$/i;

export function isCountedAsset(name: string): boolean {
  return !METADATA_ASSET.test(name);
}

export interface ReleaseSummary {
  /** Published (non-draft) releases by id. */
  releases: Record<string, ReleaseInfo>;
  /** Release id -> downloads summed over counted assets. */
  downloads: Record<string, number>;
  /** At least one published release has a counted asset. */
  hasCountedAssets: boolean;
}

export function summarizeReleases(items: ReleaseItem[]): ReleaseSummary {
  const summary: ReleaseSummary = { releases: {}, downloads: {}, hasCountedAssets: false };
  for (const item of items) {
    if (item.draft) continue;
    const id = String(item.id);
    summary.releases[id] = {
      tag: item.tag,
      name: item.name ?? "",
      publishedDate: item.publishedAt === null ? null : toUtcDate(item.publishedAt),
    };
    const counted = item.assets.filter((a) => isCountedAsset(a.name));
    if (counted.length > 0) summary.hasCountedAssets = true;
    summary.downloads[id] = counted.reduce((sum, a) => sum + a.downloadCount, 0);
  }
  return summary;
}
