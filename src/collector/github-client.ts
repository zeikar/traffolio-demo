import type { ErrorKind } from "../types.js";
import { classifyStatus, retryDelayMs } from "./classify.js";

const API_ORIGIN = "https://api.github.com";
const API_VERSION = "2026-03-10";
const MAX_ATTEMPTS = 3;

/** Message is limited to method, path, status and kind: never the body, token or headers. */
export class GitHubApiError extends Error {
  readonly status: number;
  readonly kind: ErrorKind;
  readonly path: string;

  constructor(method: string, path: string, status: number, kind: ErrorKind) {
    super(`${method} ${path} failed: HTTP ${status} (${kind})`);
    this.name = "GitHubApiError";
    this.status = status;
    this.kind = kind;
    this.path = path;
  }
}

export interface GitHubResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

export interface GitHubClient {
  /** `path` is an API path (`/user/repos`) or an absolute `https://api.github.com/...` URL. */
  get(path: string, query?: Record<string, string | number>): Promise<GitHubResponse>;
}

export interface GitHubClientOptions {
  token: string;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  /** Epoch milliseconds. */
  now: () => number;
}

export function createGitHubClient({ token, fetch, sleep, now }: GitHubClientOptions): GitHubClient {
  const requestHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "traffolio",
  };

  return {
    async get(pathOrUrl, query) {
      const url = new URL(pathOrUrl, API_ORIGIN);
      if (url.origin !== API_ORIGIN) {
        throw new Error(`Refusing to send the token to a non-GitHub API origin: ${url.origin}`);
      }
      for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
      const path = url.pathname;

      for (let attempt = 1; ; attempt++) {
        let status = 0;
        let headers = new Headers();
        let kind: ErrorKind;
        try {
          const res = await fetch(url, { headers: requestHeaders });
          status = res.status;
          headers = res.headers;
          if (res.ok) return { status, headers, body: await parseJsonBody(res, path) };
          kind = classifyStatus(status, headers, await errorMessage(res));
        } catch (err) {
          if (err instanceof GitHubApiError) throw err;
          // Network failure. The underlying error is dropped on purpose: its text may carry the full URL.
          kind = "transient";
        }

        const delay = attempt < MAX_ATTEMPTS ? retryDelayMs(kind, attempt, headers, now()) : null;
        if (delay === null) throw new GitHubApiError("GET", path, status, kind);
        await sleep(delay);
      }
    },
  };
}

async function parseJsonBody(res: Response, path: string): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    // JSON.parse messages quote the input, so rethrow without it.
    throw new GitHubApiError("GET", path, res.status, "unknown");
  }
}

/** The error body's JSON `message`, for classification only; non-JSON bodies yield undefined. */
async function errorMessage(res: Response): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await res.text());
    if (typeof parsed === "object" && parsed !== null && "message" in parsed && typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    // Non-JSON error bodies (e.g. HTML from a proxy) are expected; classify by status alone.
  }
  return undefined;
}
