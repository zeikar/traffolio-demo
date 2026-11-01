import type { ErrorKind, Outcome } from "../types.js";

export interface RepoErrorEntry {
  fullName: string;
  outcome: "forbidden" | "transient";
  kind: ErrorKind;
}

export interface SummaryCounts {
  discovered: number;
  selected: number;
  succeeded: number;
  forbidden: number;
  transient: number;
}

/** Results of the star/fork, referrer and release collection, counted per repository. */
export interface ExtrasCounts {
  starsForks: number;
  referrers: number;
  /** Repositories whose release list has at least one counted asset. */
  releasesWithAssets: number;
  /** 403/404 warnings. */
  forbidden: number;
  /** Transient, unknown and rate-limit failures. */
  failed: number;
  /** A rate limit stopped the remaining extras. */
  rateLimited: boolean;
}

/** `skipped` when the traffic loop already hit the rate limit. */
export function extrasLine(extras: ExtrasCounts | "skipped"): string {
  if (extras === "skipped") return "Extras: skipped (rate limit reached during traffic collection)";
  const e = extras;
  return (
    `Extras: stars/forks ${e.starsForks} ok, referrers ${e.referrers} ok, releases ${e.releasesWithAssets} with assets; ` +
    `${e.forbidden} forbidden, ${e.failed} failed${e.rateLimited ? "; stopped early (rate limit)" : ""}`
  );
}

export interface SummaryInput {
  /** Exact ISO run start time. The summary is the only output allowed to carry it (§8). */
  runStartedAt: string;
  outcome: Outcome;
  /** Category of a fatal stop or skip (e.g. `missing_token`), never an error message. */
  reason?: string;
  dataThroughDate: string | null;
  /** Absent when the run stopped before repositories were classified. */
  counts?: SummaryCounts;
  /** Absent when the run stopped before the extras ran. */
  extras?: ExtrasCounts | "skipped";
  perRepoErrors: RepoErrorEntry[];
}

/** `forbidden`, `transient`, or `<outcome> (<kind>)` when the kind is more specific. */
export function repoErrorLabel(entry: Pick<RepoErrorEntry, "outcome" | "kind">): string {
  return entry.kind === entry.outcome ? entry.outcome : `${entry.outcome} (${entry.kind})`;
}

/** Built from names, counts and categories only, so it cannot contain tokens or response bodies. */
export function renderSummary(input: SummaryInput): string {
  const out = [`### Traffolio collect: ${input.outcome}`, "", `- Run started: ${input.runStartedAt}`];
  if (input.reason) out.push(`- Reason: ${input.reason}`);
  if (input.outcome === "ok" || input.outcome === "partial") {
    out.push(`- Data through: ${input.dataThroughDate ?? "no data stored yet"} (UTC)`);
  }
  if (input.counts) {
    const c = input.counts;
    out.push(
      `- Repositories: ${c.discovered} discovered, ${c.selected} selected, ${c.succeeded} succeeded, ` +
        `${c.forbidden} forbidden, ${c.transient} transient`,
    );
  }
  if (input.extras) out.push(`- ${extrasLine(input.extras)}`);
  if (input.perRepoErrors.length > 0) {
    out.push("", "#### Repository warnings and errors", "");
    for (const entry of input.perRepoErrors) out.push(`- \`${entry.fullName}\`: ${repoErrorLabel(entry)}`);
  }
  return out.join("\n") + "\n";
}
