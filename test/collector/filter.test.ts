import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/collector/config.js";
import { selectRepositories } from "../../src/collector/filter.js";
import type { RepoMeta } from "../../src/types.js";

function repo(
  id: number,
  name: string,
  over: Partial<RepoMeta> = {},
): RepoMeta {
  return {
    id,
    name,
    fullName: `me/${name}`,
    private: false,
    fork: false,
    archived: false,
    stargazersCount: 0,
    forksCount: 0,
    ...over,
  };
}

function cfg(yaml = "") {
  return parseConfig(yaml);
}

const SELF = 1;

describe("selectRepositories", () => {
  it("matches globs case-insensitively against name", () => {
    const r = repo(2, "Sample-Docs");
    const out = selectRepositories(
      [r],
      cfg("repositories:\n  include: ['sample-*']"),
      SELF,
    );
    expect(out.selected).toEqual([r]);
  });

  it("matches dot-prefixed names with * and excludes them with .*", () => {
    const r = repo(2, ".github");
    expect(selectRepositories([r], cfg(), SELF).selected).toEqual([r]);
    const out = selectRepositories(
      [r],
      cfg("repositories:\n  exclude: ['.*']"),
      SELF,
    );
    expect(out.excluded.map((e) => e.reason)).toEqual(["exclude_pattern"]);
  });

  it("exclude beats include", () => {
    const r = repo(2, "sample-x");
    const out = selectRepositories(
      [r],
      cfg("repositories:\n  include: ['sample-*']\n  exclude: ['*-x']"),
      SELF,
    );
    expect(out.selected).toEqual([]);
    expect(out.excluded).toEqual([{ repo: r, reason: "exclude_pattern" }]);
  });

  it("excludes self by id even when name is not traffolio", () => {
    const r = repo(SELF, "my-stats");
    const out = selectRepositories([r], cfg(), SELF);
    expect(out.excluded).toEqual([{ repo: r, reason: "self" }]);
  });

  it("include_self lifts only the self exclusion", () => {
    const r = repo(SELF, "my-stats");
    expect(
      selectRepositories([r], cfg("repositories:\n  include_self: true"), SELF)
        .selected,
    ).toEqual([r]);

    const priv = repo(SELF, "my-stats", { private: true });
    const out = selectRepositories(
      [priv],
      cfg("repositories:\n  include_self: true\n  include_private: false"),
      SELF,
    );
    expect(out.excluded).toEqual([{ repo: priv, reason: "private" }]);
  });

  it.each([
    ["private", "include_private", { private: true }],
    ["fork", "include_forks", { fork: true }],
    ["archived", "include_archived", { archived: true }],
  ] as const)(
    "%s repos are excluded by default and included via %s",
    (reason, flag, over) => {
      const r = repo(2, "a", over);
      expect(selectRepositories([r], cfg(), SELF).excluded).toEqual([
        { repo: r, reason },
      ]);
      expect(
        selectRepositories([r], cfg(`repositories:\n  ${flag}: true`), SELF)
          .selected,
      ).toEqual([r]);
    },
  );

  it("include: [] selects nothing", () => {
    const r = repo(2, "a");
    const out = selectRepositories(
      [r],
      cfg("repositories:\n  include: []"),
      SELF,
    );
    expect(out.selected).toEqual([]);
    expect(out.excluded).toEqual([{ repo: r, reason: "not_included" }]);
  });

  it("evaluates reasons in order: self, private, fork, archived", () => {
    const r = repo(SELF, "a", { private: true, fork: true, archived: true });
    expect(selectRepositories([r], cfg(), SELF).excluded[0]?.reason).toBe(
      "self",
    );
    const r2 = repo(2, "a", { private: true, fork: true, archived: true });
    expect(selectRepositories([r2], cfg(), SELF).excluded[0]?.reason).toBe(
      "private",
    );
  });

  it("preserves input order", () => {
    const repos = [
      repo(5, "c"),
      repo(3, "a"),
      repo(4, "b", { fork: true }),
      repo(2, "d"),
    ];
    const out = selectRepositories(repos, cfg(), SELF);
    expect(out.selected.map((r) => r.name)).toEqual(["c", "a", "d"]);
    expect(out.excluded.map((e) => e.repo.name)).toEqual(["b"]);
  });
});
