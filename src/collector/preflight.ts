import { ConfigError } from "./config.js";
import { GitHubApiError, createGitHubClient } from "./github-client.js";
import { ResponseShapeError, getRepository } from "./github-api.js";
import type { SelfRepoInfo } from "./github-api.js";
import type { CollectMode } from "../types.js";

export type PreflightDecision =
  | { action: "proceed"; selfRepoId: number; mode: CollectMode }
  | { action: "skip_template" }
  | { action: "fail"; reason: "public" | "undeterminable" };

/**
 * Fail closed: `proceed` only when the repository is exactly `private === true`, or exactly
 * `private === false` with `public_mode` turned on.
 */
export function decidePreflight(
  selfRepo: SelfRepoInfo | undefined,
  options: { publicMode: boolean },
): PreflightDecision {
  if (selfRepo === undefined) return { action: "fail", reason: "undeterminable" };
  if (selfRepo.isTemplate === true) return { action: "skip_template" };
  if (selfRepo.private === true) return { action: "proceed", selfRepoId: selfRepo.id, mode: "private" };
  if (selfRepo.private === false && options.publicMode === true) {
    return { action: "proceed", selfRepoId: selfRepo.id, mode: "public" };
  }
  return { action: "fail", reason: "public" };
}

export interface LookupSelfRepositoryOptions {
  githubToken: string | undefined;
  repositoryFullName: string | undefined;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  log: (line: string) => void;
}

const FULL_NAME = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** Any failure yields undefined (undeterminable). Logs the error kind only, never messages. */
export async function lookupSelfRepository(options: LookupSelfRepositoryOptions): Promise<SelfRepoInfo | undefined> {
  const { githubToken, repositoryFullName, fetch, sleep, now, log } = options;
  if (!githubToken || !repositoryFullName || !FULL_NAME.test(repositoryFullName)) return undefined;
  try {
    const client = createGitHubClient({ token: githubToken, fetch, sleep, now });
    return await getRepository(client, repositoryFullName);
  } catch (err) {
    const kind =
      err instanceof GitHubApiError ? err.kind : err instanceof ResponseShapeError ? "response_shape" : errorName(err);
    log(`self-repository lookup failed (${kind})`);
    return undefined;
  }
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown";
}

export function checkTrafficToken(env: Record<string, string | undefined>): string {
  const token = env.TRAFFIC_TOKEN;
  if (token === undefined || token.trim() === "") {
    throw new ConfigError("TRAFFIC_TOKEN secret is not set. See README › Setup step 5.");
  }
  return token;
}
