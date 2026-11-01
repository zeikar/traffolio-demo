import { z } from "zod";
import type { PathEntry, ReferrerEntry } from "../types.js";
import { fetchAllPages, parseBody } from "./github-api.js";
import type { GitHubClient } from "./github-client.js";

const PAGE = { per_page: 100, page: 1 };
// The star history endpoint caps per_page at 30.
const STAR_HISTORY_PAGE = { per_page: 30, page: 1 };

// Validated up front so a malformed timestamp is a shape error, not a crash while bucketing.
const Timestamp = z.iso.datetime({ offset: true });

const Count = z.number().int().nonnegative();
// `week` is the week's start (Sunday) in Unix seconds; `days` runs Sunday..Saturday.
// `total` is checked for shape only and then dropped: if it ever disagreed with the sum of `days`,
// only `days` says which dates the stars belong to, and the stored history is per date.
const StarWeek = z.object({ week: z.number().int(), total: Count, days: z.array(Count).length(7) });
// Only the dates are read; owner objects in the fork listing are dropped by the schema.
const Fork = z.object({ created_at: Timestamp });

const Referrer = z.object({ referrer: z.string(), count: z.number(), uniques: z.number() });
const PopularPath = z.object({ path: z.string(), title: z.string(), count: z.number(), uniques: z.number() });

const Release = z.object({
  id: z.number(),
  tag_name: z.string(),
  name: z.string().nullable(),
  draft: z.boolean(),
  published_at: Timestamp.nullable(),
  assets: z.array(z.object({ name: z.string(), download_count: z.number() })),
});

export interface ReleaseItem {
  id: number;
  tag: string;
  name: string | null;
  draft: boolean;
  publishedAt: string | null;
  assets: { name: string; downloadCount: number }[];
}

export interface StarWeekItem {
  /** Unix seconds of the week's start. */
  week: number;
  /** Stars on each day of the week, Sunday first. */
  days: number[];
}

/** GitHub's weekly star history of current stars, every page (most recent week first). */
export async function listStarHistory(client: GitHubClient, fullName: string): Promise<StarWeekItem[]> {
  const items = await fetchAllPages(client, `/repos/${fullName}/stargazers/history`, STAR_HISTORY_PAGE, StarWeek);
  return items.map((w) => ({ week: w.week, days: w.days }));
}

/** `created_at` of every existing fork. */
export async function listForkTimestamps(client: GitHubClient, fullName: string): Promise<string[]> {
  const items = await fetchAllPages(client, `/repos/${fullName}/forks`, PAGE, Fork);
  return items.map((f) => f.created_at);
}

export async function getReferrers(client: GitHubClient, fullName: string): Promise<ReferrerEntry[]> {
  const path = `/repos/${fullName}/traffic/popular/referrers`;
  return parseBody(z.array(Referrer), (await client.get(path)).body, path);
}

export async function getPopularPaths(client: GitHubClient, fullName: string): Promise<PathEntry[]> {
  const path = `/repos/${fullName}/traffic/popular/paths`;
  return parseBody(z.array(PopularPath), (await client.get(path)).body, path);
}

export async function listReleases(client: GitHubClient, fullName: string): Promise<ReleaseItem[]> {
  const items = await fetchAllPages(client, `/repos/${fullName}/releases`, PAGE, Release);
  return items.map((r) => ({
    id: r.id,
    tag: r.tag_name,
    name: r.name,
    draft: r.draft,
    publishedAt: r.published_at,
    assets: r.assets.map((a) => ({ name: a.name, downloadCount: a.download_count })),
  }));
}
