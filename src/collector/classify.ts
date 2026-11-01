import type { ErrorKind } from "../types.js";

/** Longest rate-limit wait we sit through inside one run; beyond this the caller stops. */
export const MAX_RATE_LIMIT_WAIT_MS = 120_000;

const TRANSIENT_BACKOFF_MS = [500, 1000, 2000];
// GitHub: without retry-after or an exhausted primary quota, wait at least a minute.
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;

/** `bodyMessage` is the JSON `message` of the error body, used only to spot secondary rate limits. */
export function classifyStatus(status: number, headers: Headers, bodyMessage: string | undefined): ErrorKind {
  if (status === 401) return "auth";
  if (status === 429) return "rate_limited";
  if (status === 403) {
    // Rate-limit signals are only trusted on 403: any response carries x-ratelimit-remaining,
    // so e.g. a 404 that spent the last request of the quota is still a 404.
    if (
      headers.has("retry-after") ||
      headers.get("x-ratelimit-remaining") === "0" ||
      /rate limit/i.test(bodyMessage ?? "")
    ) {
      return "rate_limited";
    }
    return "forbidden";
  }
  if (status === 404) return "not_found";
  if (status >= 500 && status <= 599) return "transient";
  return "unknown";
}

/**
 * Delay before retrying after failed attempt number `attempt` (1-based), or null to give up.
 * Network failures are classified as `transient` by the caller.
 */
export function retryDelayMs(kind: ErrorKind, attempt: number, headers: Headers, nowMs: number): number | null {
  if (kind === "transient") {
    return TRANSIENT_BACKOFF_MS[Math.min(attempt, TRANSIENT_BACKOFF_MS.length) - 1]!;
  }
  if (kind !== "rate_limited") return null;
  const delay = rateLimitDelayMs(headers, nowMs);
  return delay > MAX_RATE_LIMIT_WAIT_MS ? null : delay;
}

function rateLimitDelayMs(headers: Headers, nowMs: number): number {
  const retryAfter = parseNonNegative(headers.get("retry-after"));
  if (retryAfter !== null) return retryAfter * 1000;
  // The reset time belongs to the primary quota; a secondary limit with quota left must not use it.
  if (headers.get("x-ratelimit-remaining") === "0") {
    const reset = parseNonNegative(headers.get("x-ratelimit-reset"));
    if (reset !== null) return Math.max(0, reset * 1000 - nowMs);
  }
  return DEFAULT_RATE_LIMIT_WAIT_MS;
}

function parseNonNegative(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
