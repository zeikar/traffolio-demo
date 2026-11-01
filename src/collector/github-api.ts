import { z } from "zod";
import type { RepoMeta } from "../types.js";
import type { GitHubClient } from "./github-client.js";
import type { TrafficPoint } from "./normalize.js";

// Safety net only: GitHub's own `rel="next"` links end every real listing.
const MAX_PAGES = 2000;

/** Message carries only the request path: never the body or Zod issue values, which can echo input. */
export class ResponseShapeError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Unexpected response shape from GET ${path}`);
    this.name = "ResponseShapeError";
    this.path = path;
  }
}

/** A paginated listing looped or ran past the safety cap. Message carries only the path. */
export class PageLimitError extends Error {
  readonly path: string;

  constructor(path: string, reason: "limit" | "loop" = "limit") {
    super(reason === "loop" ? `GET ${path} repeated a next page link` : `GET ${path} exceeded ${MAX_PAGES} pages`);
    this.name = "PageLimitError";
    this.path = path;
  }
}

const RepoListItem = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  private: z.boolean(),
  fork: z.boolean(),
  archived: z.boolean(),
  stargazers_count: z.number(),
  forks_count: z.number(),
});

const SelfRepo = z.object({
  id: z.number(),
  private: z.boolean(),
  is_template: z.boolean(),
});

const User = z.object({ login: z.string(), id: z.number() });

const TrafficPointSchema = z.object({ timestamp: z.string(), count: z.number(), uniques: z.number() });

const ViewsResponse = z.object({ count: z.number(), uniques: z.number(), views: z.array(TrafficPointSchema) });
const ClonesResponse = z.object({ count: z.number(), uniques: z.number(), clones: z.array(TrafficPointSchema) });

export interface SelfRepoInfo {
  id: number;
  private: boolean;
  isTemplate: boolean;
}

export function parseBody<T>(schema: z.ZodType<T>, body: unknown, path: string): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new ResponseShapeError(path);
  return result.data;
}

/** Returns the `rel="next"` URL of a Link header, or null. */
export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = /^\s*<([^>]*)>\s*;(.*)$/.exec(part);
    if (match && /;?\s*rel="?next"?\s*(;|$)/.test(`;${match[2]}`)) return match[1];
  }
  return null;
}

export async function getAuthenticatedUser(client: GitHubClient): Promise<{ login: string; id: number }> {
  const res = await client.get("/user");
  return parseBody(User, res.body, "/user");
}

/** Every item of a listing, following `Link: rel="next"` until there is none; throws if a next link repeats or MAX_PAGES is exceeded. */
export async function fetchAllPages<T>(
  client: GitHubClient,
  path: string,
  query: Record<string, string | number>,
  item: z.ZodType<T>,
): Promise<T[]> {
  const items: T[] = [];
  let res = await client.get(path, query);
  const seen = new Set<string>();
  for (let page = 1; ; page++) {
    items.push(...parseBody(z.array(item), res.body, path));
    const next = parseNextLink(res.headers.get("link"));
    if (next === null) return items;
    if (seen.has(next)) throw new PageLimitError(path, "loop");
    seen.add(next);
    if (page >= MAX_PAGES) throw new PageLimitError(path);
    res = await client.get(next);
  }
}

export async function listOwnedRepositories(client: GitHubClient): Promise<RepoMeta[]> {
  const items = await fetchAllPages(client, "/user/repos", { affiliation: "owner", per_page: 100, page: 1 }, RepoListItem);
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    fullName: item.full_name,
    private: item.private,
    fork: item.fork,
    archived: item.archived,
    stargazersCount: item.stargazers_count,
    forksCount: item.forks_count,
  }));
}

export async function getTraffic(
  client: GitHubClient,
  fullName: string,
): Promise<{ views: TrafficPoint[]; clones: TrafficPoint[] }> {
  const viewsPath = `/repos/${fullName}/traffic/views`;
  const clonesPath = `/repos/${fullName}/traffic/clones`;
  const views = await client.get(viewsPath, { per: "day" });
  const clones = await client.get(clonesPath, { per: "day" });
  return {
    views: parseBody(ViewsResponse, views.body, viewsPath).views,
    clones: parseBody(ClonesResponse, clones.body, clonesPath).clones,
  };
}

export async function getRepository(client: GitHubClient, fullName: string): Promise<SelfRepoInfo> {
  const path = `/repos/${fullName}`;
  const res = await client.get(path);
  const repo = parseBody(SelfRepo, res.body, path);
  return { id: repo.id, private: repo.private, isTemplate: repo.is_template };
}
