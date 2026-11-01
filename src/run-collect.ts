import { join } from "node:path";
import { setOutput, writeSummary } from "./actions.js";
import { collectExtras, writeExtras } from "./collect-extras.js";
import type { ExtrasFiles } from "./collect-extras.js";
import { ConfigError, loadConfig } from "./collector/config.js";
import { selectRepositories } from "./collector/filter.js";
import type { ExcludedRepo } from "./collector/filter.js";
import { ResponseShapeError, getAuthenticatedUser, getTraffic, listOwnedRepositories } from "./collector/github-api.js";
import { GitHubApiError, createGitHubClient } from "./collector/github-client.js";
import type { GitHubClient } from "./collector/github-client.js";
import { normalizeTraffic } from "./collector/normalize.js";
import type { NormalizedTraffic } from "./collector/normalize.js";
import { checkTrafficToken, decidePreflight, lookupSelfRepository } from "./collector/preflight.js";
import { PUBLIC_MODE_NO_EFFECT, checkPublicMode } from "./collector/public-mode.js";
import { buildDashboardModel } from "./reporter/aggregate.js";
import { MarkerError, assertMarkers, renderSection, replaceSection } from "./reporter/readme.js";
import { readTopReferrers } from "./reporter/referrers.js";
import { renderSparklineSvg } from "./reporter/sparkline.js";
import { renderSummary, repoErrorLabel } from "./reporter/summary.js";
import type { RepoErrorEntry, SummaryCounts, SummaryInput } from "./reporter/summary.js";
import { renderTrafficSvg } from "./reporter/svg.js";
import { updateIndex, updateStatus } from "./storage/index-status.js";
import type { RepoResult } from "./storage/index-status.js";
import { upsertDays } from "./storage/merge.js";
import { createStore } from "./storage/store.js";
import type { Store } from "./storage/store.js";
import type { CollectMode, ErrorKind, MonthFile, Outcome, RepoMeta } from "./types.js";

export interface CollectDeps {
  env: Record<string, string | undefined>;
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  rootDir: string;
  /** Epoch milliseconds. */
  now: () => number;
  log: (line: string) => void;
}

export interface CollectResult {
  exitCode: 0 | 1 | 2;
  outcome: Outcome;
  commit: boolean;
  dataThroughDate?: string | null;
}

type FatalReason =
  | "config"
  | "readme_markers"
  | "visibility_public"
  | "visibility_undeterminable"
  | "public_private_data"
  | "missing_token"
  | "auth"
  | "user_lookup"
  | "repo_listing"
  | "all_failed"
  | "unexpected";

class FatalError extends Error {
  readonly reason: FatalReason;

  constructor(reason: FatalReason, message: string) {
    super(message);
    this.name = "FatalError";
    this.reason = reason;
  }
}

type RepoOutcome =
  | { repo: RepoMeta; outcome: "success"; traffic: NormalizedTraffic }
  | { repo: RepoMeta; outcome: "forbidden" | "transient"; kind: ErrorKind };

type SummaryBody = Omit<SummaryInput, "runStartedAt">;

/** What the summary can still report when the run stops early. */
interface Progress {
  counts?: SummaryCounts;
  perRepoErrors: RepoErrorEntry[];
}

const SVG_PATH = "assets/traffic.svg";
const sparklinePath = (id: string): string => `assets/sparklines/${id}.svg`;

const VISIBILITY_MESSAGES = {
  undeterminable:
    "Could not confirm that this Traffolio repository is private (GITHUB_TOKEN/GITHUB_REPOSITORY missing " +
    "or the lookup failed), so it is treated as public. Nothing collected or written.",
  public:
    "This Traffolio repository is public. Collection is refused so traffic data is never published. " +
    "Nothing collected or written. " +
    "Set public_mode: true in traffolio.config.yml only if you intend to publish these numbers.",
} as const;

const TEMPLATE_MESSAGE =
  "This is the Traffolio template repository (is_template: true); skipping collection. " +
  "Create your own private repository from this template to start collecting.";

/** Messages of these classes are built from known-safe parts; other errors are reported by name only. */
function describeError(err: unknown): string {
  const safe = [ConfigError, MarkerError, GitHubApiError, ResponseShapeError].some((cls) => err instanceof cls);
  if (safe) return `${(err as Error).name}: ${(err as Error).message}`;
  return err instanceof Error ? err.name : "unknown error";
}

/** Runs `fn`, turning any failure into a FatalError (a 401 anywhere is reported as `auth`). */
async function fatalOnError<T>(reason: FatalReason, fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const actual = err instanceof GitHubApiError && err.kind === "auth" ? "auth" : reason;
    throw new FatalError(actual, `Stopped (${actual}); nothing written. ${describeError(err)}`);
  }
}

export async function runCollect(deps: CollectDeps): Promise<CollectResult> {
  const startedAt = new Date(deps.now()).toISOString();
  const progress: Progress = { perRepoErrors: [] };
  let result: CollectResult;
  let summary: SummaryBody;
  try {
    ({ result, summary } = await collect(deps, startedAt.slice(0, 10), progress));
  } catch (err) {
    const fatal = err instanceof FatalError;
    deps.log(fatal ? err.message : `Stopped (unexpected); nothing written. ${describeError(err)}`);
    result = { exitCode: 1, outcome: "fatal", commit: false };
    summary = { outcome: "fatal", reason: fatal ? err.reason : "unexpected", dataThroughDate: null, ...progress };
  }

  await setOutput("commit", String(result.commit), deps.env);
  await setOutput("outcome", result.outcome, deps.env);
  await setOutput("data_through", result.dataThroughDate ?? "", deps.env);
  await writeSummary(renderSummary({ runStartedAt: startedAt, ...summary }), deps.env);
  return result;
}

async function collect(
  deps: CollectDeps,
  runDate: string,
  progress: Progress,
): Promise<{ result: CollectResult; summary: SummaryBody }> {
  const { env, fetch, sleep, now, log } = deps;
  const store = createStore(deps.rootDir);

  const config = await fatalOnError("config", () => loadConfig(join(deps.rootDir, "traffolio.config.yml")));
  const readme = await fatalOnError("readme_markers", async () => {
    const text = await store.readTextFile("README.md");
    if (text === undefined) throw new MarkerError("README.md not found");
    assertMarkers(text);
    return text;
  });

  const decision = decidePreflight(
    await lookupSelfRepository({
      githubToken: env.GITHUB_TOKEN,
      repositoryFullName: env.GITHUB_REPOSITORY,
      fetch,
      sleep,
      now,
      log,
    }),
    { publicMode: config.public_mode },
  );
  if (decision.action === "skip_template") {
    log(TEMPLATE_MESSAGE);
    return {
      result: { exitCode: 0, outcome: "skipped", commit: false },
      summary: { outcome: "skipped", reason: "template", dataThroughDate: null, perRepoErrors: [] },
    };
  }
  if (decision.action === "fail") {
    throw new FatalError(`visibility_${decision.reason}`, VISIBILITY_MESSAGES[decision.reason]);
  }
  if (decision.mode === "public") {
    const violation = checkPublicMode(config, await fatalOnError("unexpected", () => store.readIndex()));
    if (violation) throw new FatalError(violation.reason, violation.message);
  } else if (config.public_mode) {
    log(PUBLIC_MODE_NO_EFFECT);
  }

  const token = await fatalOnError("missing_token", () => checkTrafficToken(env));
  const client = createGitHubClient({ token, fetch, sleep, now });
  await fatalOnError("user_lookup", () => getAuthenticatedUser(client));
  const repos = await fatalOnError("repo_listing", () => listOwnedRepositories(client));
  const selection = selectRepositories(repos, config, decision.selfRepoId);
  log(`Discovered ${repos.length} owned repositories; selected ${selection.selected.length}.`);

  const outcomes = await collectTraffic(client, selection.selected, log);
  const counts: SummaryCounts = {
    discovered: repos.length,
    selected: outcomes.length,
    succeeded: outcomes.filter((o) => o.outcome === "success").length,
    forbidden: outcomes.filter((o) => o.outcome === "forbidden").length,
    transient: outcomes.filter((o) => o.outcome === "transient").length,
  };
  progress.counts = counts;
  progress.perRepoErrors = outcomes.flatMap((o) =>
    o.outcome === "success" ? [] : [{ fullName: o.repo.fullName, outcome: o.outcome, kind: o.kind }],
  );
  if (counts.selected > 0 && counts.succeeded === 0) {
    throw new FatalError("all_failed", "Stopped (all_failed): every selected repository failed; nothing written.");
  }

  const trafficRateLimited = outcomes.some((o) => o.outcome === "transient" && o.kind === "rate_limited");
  const extras = await fatalOnError("unexpected", () =>
    collectExtras(client, store, selection.selected, runDate, log, trafficRateLimited),
  );

  const { commit, dataThroughDate } = await writeResults(
    store,
    readme,
    selection,
    outcomes,
    extras.files,
    runDate,
    decision.mode,
  );
  const outcome = counts.transient > 0 || extras.partial ? "partial" : "ok";
  return {
    result: { exitCode: outcome === "partial" ? 2 : 0, outcome, commit, dataThroughDate },
    summary: { outcome, dataThroughDate, counts, extras: extras.summary, perRepoErrors: progress.perRepoErrors },
  };
}

/**
 * Fetches each repo in turn, continuing past per-repo failures. A 401 aborts the run;
 * a rate limit the client gave up on stops further calls and marks the rest transient.
 */
async function collectTraffic(
  client: GitHubClient,
  selected: RepoMeta[],
  log: (line: string) => void,
): Promise<RepoOutcome[]> {
  const outcomes: RepoOutcome[] = [];
  const record = (o: RepoOutcome) => {
    outcomes.push(o);
    if (o.outcome !== "success") log(`${o.repo.fullName}: ${repoErrorLabel(o)}`);
    else if (o.traffic.window) log(`${o.repo.fullName}: ok (${o.traffic.window.start}..${o.traffic.window.end})`);
    else log(`${o.repo.fullName}: ok (no traffic window in response)`);
  };

  for (const [i, repo] of selected.entries()) {
    let kind: ErrorKind;
    try {
      const { views, clones } = await getTraffic(client, repo.fullName);
      record({ repo, outcome: "success", traffic: normalizeTraffic(views, clones) });
      continue;
    } catch (err) {
      if (err instanceof GitHubApiError) kind = err.kind;
      else if (err instanceof ResponseShapeError) kind = "unknown";
      else throw err;
    }

    if (kind === "auth") {
      log(`${repo.fullName}: auth`);
      throw new FatalError("auth", "Stopped (auth): TRAFFIC_TOKEN was rejected (HTTP 401); nothing written.");
    }
    if (kind === "rate_limited") {
      log(`Rate limit not lifted in time; skipping the remaining ${selected.length - i - 1} repositories.`);
      for (const rest of selected.slice(i)) record({ repo: rest, outcome: "transient", kind: "rate_limited" });
      break;
    }
    const outcome = kind === "forbidden" || kind === "not_found" ? "forbidden" : "transient";
    record({ repo, outcome, kind });
  }
  return outcomes;
}

function toRepoResult(o: RepoOutcome): RepoResult {
  return o.outcome === "success"
    ? { repoId: o.repo.id, outcome: "success", window: o.traffic.window }
    : { repoId: o.repo.id, outcome: "error", kind: o.kind };
}

/**
 * Reads and computes every output first, so a malformed data file aborts before anything is
 * written; then writes in one block. Each write is skipped when the bytes are unchanged.
 */
async function writeResults(
  store: Store,
  readme: string,
  selection: { selected: RepoMeta[]; excluded: ExcludedRepo[] },
  outcomes: RepoOutcome[],
  extras: ExtrasFiles,
  runDate: string,
  mode: CollectMode,
): Promise<{ commit: boolean; dataThroughDate: string | null }> {
  const index = updateIndex(await store.readIndex(), selection, mode);
  const status = updateStatus(await store.readStatus(), outcomes.map(toRepoResult), runDate);

  const monthFilesByRepo: Record<string, MonthFile[]> = {};
  for (const id of Object.keys(index.repositories)) monthFilesByRepo[id] = await store.readMonthFiles(id);

  const touchedMonths: MonthFile[] = [];
  for (const o of outcomes) {
    if (o.outcome !== "success" || o.traffic.window === null) continue;
    const id = String(o.repo.id);
    const merged = upsertDays(monthFilesByRepo[id] ?? [], o.repo.id, o.traffic.days);
    monthFilesByRepo[id] = merged;
    const months = new Set(Object.keys(o.traffic.days).map((date) => date.slice(0, 7)));
    touchedMonths.push(...merged.filter((file) => months.has(file.month)));
  }

  const model = buildDashboardModel(index, status, monthFilesByRepo);
  const svg = renderTrafficSvg(model.series, { sampleLabel: false });
  const sparklines = model.rows.map((row) => [sparklinePath(row.id), renderSparklineSvg(row.series)] as const);
  const topReferrers = await readTopReferrers(store, index, extras.referrers);
  const nextReadme = replaceSection(
    readme,
    renderSection(model, { svgPath: SVG_PATH, sparklinePath, sampleLabel: false, topReferrers }),
  );

  const changed: boolean[] = [];
  for (const file of touchedMonths) changed.push(await store.writeMonthFile(file));
  changed.push(
    await store.writeIndex(index),
    await store.writeStatus(status),
    await store.writeTextFile(SVG_PATH, svg),
    await store.writeTextFile("README.md", nextReadme),
  );
  for (const [path, text] of sparklines) changed.push(await store.writeTextFile(path, text));
  changed.push(...(await writeExtras(store, extras)));
  return { commit: changed.includes(true), dataThroughDate: status.dataThroughDate };
}
