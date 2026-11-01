import {
  getPopularPaths,
  getReferrers,
  listForkTimestamps,
  listReleases,
  listStarHistory,
} from "./collector/extras-api.js";
import { countByDate, countStarHistory, sortPaths, sortReferrers, summarizeReleases } from "./collector/extras-normalize.js";
import { PageLimitError, ResponseShapeError } from "./collector/github-api.js";
import { GitHubApiError } from "./collector/github-client.js";
import type { GitHubClient } from "./collector/github-client.js";
import { extrasLine, repoErrorLabel } from "./reporter/summary.js";
import type { ExtrasCounts } from "./reporter/summary.js";
import { withReferrerSnapshot, withReleaseSnapshot } from "./storage/extras-merge.js";
import type { Store } from "./storage/store.js";
import type { ErrorKind, GrowthFile, ReferrerMonthFile, ReleasesFile, RepoMeta } from "./types.js";

export interface ExtrasFiles {
  growth: GrowthFile[];
  referrers: ReferrerMonthFile[];
  releases: ReleasesFile[];
}

export interface ExtrasResult {
  /** Files to write in the run's single write block. */
  files: ExtrasFiles;
  summary: ExtrasCounts | "skipped";
  /** Some extra failed in a way that makes the run partial (exit 2). */
  partial: boolean;
}

const EXTRAS = ["stars/forks", "referrers", "releases"] as const;

function errorKind(err: unknown): ErrorKind {
  if (err instanceof GitHubApiError) return err.kind;
  if (err instanceof ResponseShapeError || err instanceof PageLimitError) return "unknown";
  throw err;
}

/**
 * Collects star/fork history, referrer snapshots and release downloads for each repository, after
 * traffic. Only computes files; nothing is written here. A failed extra keeps that repository's
 * previous file: 403/404 is a warning, other failures make the run partial, and a rate limit the
 * client gave up on stops all further calls. A 401 is rethrown so the caller ends the run.
 */
export async function collectExtras(
  client: GitHubClient,
  store: Store,
  repos: RepoMeta[],
  runDate: string,
  log: (line: string) => void,
  trafficRateLimited: boolean,
): Promise<ExtrasResult> {
  const files: ExtrasFiles = { growth: [], referrers: [], releases: [] };
  if (trafficRateLimited) {
    log(extrasLine("skipped"));
    return { files, summary: "skipped", partial: true };
  }

  const counts: ExtrasCounts = {
    starsForks: 0,
    referrers: 0,
    releasesWithAssets: 0,
    forbidden: 0,
    failed: 0,
    rateLimited: false,
  };
  const done = () => {
    log(extrasLine(counts));
    return { files, summary: counts, partial: counts.failed > 0 };
  };

  for (const repo of repos) {
    for (const extra of EXTRAS) {
      try {
        if (extra === "stars/forks") {
          files.growth.push(await growthFile(client, repo));
          counts.starsForks++;
        } else if (extra === "referrers") {
          files.referrers.push(await referrerFile(client, store, repo, runDate));
          counts.referrers++;
        } else {
          const file = await releasesFile(client, store, repo, runDate);
          if (file) {
            files.releases.push(file);
            counts.releasesWithAssets++;
          }
        }
      } catch (err) {
        const kind = errorKind(err);
        const label = `${repo.fullName}: ${extra}`;
        if (kind === "auth") {
          log(`${label} auth`);
          throw err;
        }
        if (kind === "forbidden" || kind === "not_found") {
          counts.forbidden++;
          log(`${label} ${repoErrorLabel({ outcome: "forbidden", kind })}`);
          continue;
        }
        counts.failed++;
        log(`${label} ${repoErrorLabel({ outcome: "transient", kind })}`);
        if (kind === "rate_limited") {
          log("Rate limit not lifted in time; skipping the remaining stars/forks, referrer and release requests.");
          counts.rateLimited = true;
          return done();
        }
      }
    }
  }
  return done();
}

/** Both are refetched every run: an unchanged count doesn't prove the dates are (unstar + new star). */
async function growthFile(client: GitHubClient, repo: RepoMeta): Promise<GrowthFile> {
  const stars = countStarHistory(await listStarHistory(client, repo.fullName));
  const forks = countByDate(await listForkTimestamps(client, repo.fullName));
  return { schemaVersion: 1, repositoryId: repo.id, stars, forks };
}

async function referrerFile(
  client: GitHubClient,
  store: Store,
  repo: RepoMeta,
  runDate: string,
): Promise<ReferrerMonthFile> {
  const referrers = sortReferrers(await getReferrers(client, repo.fullName));
  const paths = sortPaths(await getPopularPaths(client, repo.fullName));
  const prev = await store.readReferrerMonth(repo.id, runDate.slice(0, 7));
  return withReferrerSnapshot(prev, repo.id, runDate, { referrers, paths });
}

/** Undefined for a repository that has no releases file and no counted release asset. */
async function releasesFile(
  client: GitHubClient,
  store: Store,
  repo: RepoMeta,
  runDate: string,
): Promise<ReleasesFile | undefined> {
  const summary = summarizeReleases(await listReleases(client, repo.fullName));
  const prev = await store.readReleases(repo.id);
  if (!prev && !summary.hasCountedAssets) return undefined;
  return withReleaseSnapshot(prev, repo.id, runDate, summary);
}

/** Writes each file only when its bytes changed; returns one changed flag per file. */
export async function writeExtras(store: Store, files: ExtrasFiles): Promise<boolean[]> {
  const changed: boolean[] = [];
  for (const file of files.growth) changed.push(await store.writeGrowth(file));
  for (const file of files.referrers) changed.push(await store.writeReferrerMonth(file));
  for (const file of files.releases) changed.push(await store.writeReleases(file));
  return changed;
}
