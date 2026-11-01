import { minimatch } from "minimatch";
import type { ExcludeReason, RepoMeta } from "../types.js";
import type { Config } from "./config.js";

export interface ExcludedRepo {
  repo: RepoMeta;
  reason: ExcludeReason;
}

export function selectRepositories(
  repos: RepoMeta[],
  config: Config,
  selfRepoId: number,
): { selected: RepoMeta[]; excluded: ExcludedRepo[] } {
  const rules = config.repositories;
  const matches = (name: string, patterns: string[]) =>
    patterns.some((p) => minimatch(name, p, { nocase: true, dot: true }));

  const selected: RepoMeta[] = [];
  const excluded: ExcludedRepo[] = [];

  for (const repo of repos) {
    let reason: ExcludeReason | null = null;
    if (repo.id === selfRepoId && !rules.include_self) reason = "self";
    else if (repo.private && !rules.include_private) reason = "private";
    else if (repo.fork && !rules.include_forks) reason = "fork";
    else if (repo.archived && !rules.include_archived) reason = "archived";
    else if (matches(repo.name, rules.exclude)) reason = "exclude_pattern";
    else if (!matches(repo.name, rules.include)) reason = "not_included";

    if (reason) excluded.push({ repo, reason });
    else selected.push(repo);
  }

  return { selected, excluded };
}
