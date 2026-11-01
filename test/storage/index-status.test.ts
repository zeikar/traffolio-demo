import { describe, expect, it } from "vitest";
import {
  updateIndex,
  updateStatus,
  type RepoResult,
} from "../../src/storage/index-status.js";
import { stableStringify } from "../../src/storage/json.js";
import type {
  IndexEntry,
  IndexFile,
  RepoMeta,
  StatusFile,
} from "../../src/types.js";

function meta(id: number, name: string, over: Partial<RepoMeta> = {}): RepoMeta {
  return {
    id,
    name,
    fullName: `me/${name}`,
    private: false,
    fork: false,
    archived: false,
    stargazersCount: 1,
    forksCount: 2,
    ...over,
  };
}

function entry(name: string, over: Partial<IndexEntry> = {}): IndexEntry {
  return {
    name,
    fullName: `me/${name}`,
    private: false,
    fork: false,
    archived: false,
    stars: 1,
    forks: 2,
    tracking: "tracked",
    ...over,
  };
}

describe("updateIndex", () => {
  it("keeps the id key on rename and updates name", () => {
    const prev: IndexFile = {
      schemaVersion: 1,
      repositories: { "1": entry("old") },
    };
    const out = updateIndex(
      prev,
      { selected: [meta(1, "new")], excluded: [] },
      "private",
    );
    expect(Object.keys(out.repositories)).toEqual(["1"]);
    expect(out.repositories["1"]?.name).toBe("new");
    expect(out.repositories["1"]?.fullName).toBe("me/new");
  });

  it("marks a tracked repo that turned private as excluded:private", () => {
    const prev: IndexFile = {
      schemaVersion: 1,
      repositories: { "1": entry("a") },
    };
    const out = updateIndex(
      prev,
      {
        selected: [],
        excluded: [{ repo: meta(1, "a", { private: true }), reason: "private" }],
      },
      "private",
    );
    expect(out.repositories["1"]?.private).toBe(true);
    expect(out.repositories["1"]?.tracking).toBe("excluded:private");
  });

  it("in public mode, keeps the previous entry of a repo that turned private, only marked missing", () => {
    const prev: IndexFile = {
      schemaVersion: 1,
      repositories: { "1": entry("a", { stars: 3 }), "2": entry("b") },
    };
    const out = updateIndex(
      prev,
      {
        selected: [],
        excluded: [
          { repo: meta(1, "renamed", { private: true, stargazersCount: 50 }), reason: "private" },
          { repo: meta(2, "b", { fork: true }), reason: "fork" },
        ],
      },
      "public",
    );
    expect(out.repositories["1"]).toEqual(entry("a", { stars: 3, tracking: "missing" }));
    expect(stableStringify(out)).not.toContain("renamed");
    expect(out.repositories["2"]).toMatchObject({ fork: true, tracking: "excluded:fork" });
  });

  it("drops excluded repos that were never in prev", () => {
    const out = updateIndex(
      undefined,
      {
        selected: [meta(1, "a")],
        excluded: [
          { repo: meta(2, "secret-notes", { private: true }), reason: "private" },
        ],
      },
      "private",
    );
    expect(Object.keys(out.repositories)).toEqual(["1"]);
    expect(stableStringify(out)).not.toContain("secret-notes");
  });

  it("marks undiscovered repos missing without deleting or altering them", () => {
    const prev: IndexFile = {
      schemaVersion: 1,
      repositories: { "5": entry("gone", { stars: 9 }) },
    };
    const out = updateIndex(prev, { selected: [], excluded: [] }, "private");
    expect(out.repositories["5"]).toEqual(
      entry("gone", { stars: 9, tracking: "missing" }),
    );
    expect(prev.repositories["5"]?.tracking).toBe("tracked");
  });

  it("sorts repository keys", () => {
    const out = updateIndex(
      undefined,
      { selected: [meta(30, "c"), meta(100, "a"), meta(2, "b")], excluded: [] },
      "private",
    );
    expect(Object.keys(out.repositories)).toEqual(["2", "30", "100"]);
  });
});

describe("updateStatus", () => {
  const ok = (repoId: number, end: string | null): RepoResult => ({
    repoId,
    outcome: "success",
    window: end ? { start: "2026-01-01", end } : null,
  });

  it("records forbidden without touching lastSuccessDate", () => {
    const prev: StatusFile = {
      schemaVersion: 1,
      dataThroughDate: "2026-01-10",
      repositories: { "1": { lastSuccessDate: "2026-01-10", lastError: null } },
    };
    const out = updateStatus(
      prev,
      [{ repoId: 1, outcome: "error", kind: "forbidden" }],
      "2026-01-12",
    );
    expect(out.repositories["1"]).toEqual({
      lastSuccessDate: "2026-01-10",
      lastError: { kind: "forbidden", date: "2026-01-12" },
    });
    expect(out.dataThroughDate).toBe("2026-01-10");
  });

  it("success clears lastError and advances dates", () => {
    const prev: StatusFile = {
      schemaVersion: 1,
      dataThroughDate: "2026-01-10",
      repositories: {
        "1": {
          lastSuccessDate: "2026-01-05",
          lastError: { kind: "transient", date: "2026-01-11" },
        },
      },
    };
    const out = updateStatus(prev, [ok(1, "2026-01-14")], "2026-01-15");
    expect(out.repositories["1"]).toEqual({
      lastSuccessDate: "2026-01-14",
      lastError: null,
    });
    expect(out.dataThroughDate).toBe("2026-01-14");
  });

  it("keeps the start date of a repeating error and resets it when the kind changes", () => {
    const prev: StatusFile = {
      schemaVersion: 1,
      dataThroughDate: "2026-01-10",
      repositories: {
        "1": {
          lastSuccessDate: "2026-01-09",
          lastError: { kind: "forbidden", date: "2026-01-10" },
        },
      },
    };
    const same = updateStatus(prev, [{ repoId: 1, outcome: "error", kind: "forbidden" }], "2026-01-15");
    expect(same.repositories["1"]?.lastError).toEqual({ kind: "forbidden", date: "2026-01-10" });
    const changed = updateStatus(prev, [{ repoId: 1, outcome: "error", kind: "not_found" }], "2026-01-15");
    expect(changed.repositories["1"]?.lastError).toEqual({ kind: "not_found", date: "2026-01-15" });
  });

  it("dataThroughDate is the earliest window end among this run's successes", () => {
    const prev: StatusFile = { schemaVersion: 1, dataThroughDate: "2026-01-20", repositories: {} };
    const out = updateStatus(
      prev,
      [ok(1, "2026-01-26"), ok(2, "2026-01-27"), { repoId: 3, outcome: "error", kind: "forbidden" }],
      "2026-01-28",
    );
    expect(out.dataThroughDate).toBe("2026-01-26");
  });

  it("dataThroughDate can move back when a later-ending repo is no longer collected", () => {
    const prev: StatusFile = { schemaVersion: 1, dataThroughDate: "2026-01-28", repositories: {} };
    const out = updateStatus(prev, [ok(1, "2026-01-27")], "2026-01-29");
    expect(out.dataThroughDate).toBe("2026-01-27");
  });

  it("window:null success leaves lastSuccessDate and dataThroughDate", () => {
    const prev: StatusFile = {
      schemaVersion: 1,
      dataThroughDate: "2026-01-10",
      repositories: {
        "1": {
          lastSuccessDate: "2026-01-10",
          lastError: { kind: "transient", date: "2026-01-11" },
        },
      },
    };
    const out = updateStatus(prev, [ok(1, null)], "2026-01-12");
    expect(out.repositories["1"]).toEqual({
      lastSuccessDate: "2026-01-10",
      lastError: null,
    });
    expect(out.dataThroughDate).toBe("2026-01-10");
  });

  it("empty prev and no windows gives null dataThroughDate", () => {
    const out = updateStatus(undefined, [ok(1, null)], "2026-01-12");
    expect(out.dataThroughDate).toBeNull();
    expect(out.repositories["1"]).toEqual({
      lastSuccessDate: null,
      lastError: null,
    });
  });

  it("keeps entries without results, sorts keys, does not mutate prev", () => {
    const prev: StatusFile = {
      schemaVersion: 1,
      dataThroughDate: null,
      repositories: { "9": { lastSuccessDate: null, lastError: null } },
    };
    const snapshot = JSON.stringify(prev);
    const out = updateStatus(prev, [ok(100, "2026-02-01"), ok(2, null)], "2026-02-02");
    expect(Object.keys(out.repositories)).toEqual(["2", "9", "100"]);
    expect(out.repositories["9"]).toEqual(prev.repositories["9"]);
    expect(JSON.stringify(prev)).toBe(snapshot);
  });

  it("serializes only YYYY-MM-DD dates, no timestamps", () => {
    const out = updateStatus(
      undefined,
      [ok(1, "2026-03-01"), { repoId: 2, outcome: "error", kind: "auth" }],
      "2026-03-02",
    );
    const text = stableStringify(out);
    expect(text).not.toMatch(/T\d\d:/);
    const dates = [...text.matchAll(/"(\d{4}[^"]*)"/g)].map((m) => m[1]);
    expect(dates.length).toBeGreaterThan(0);
    for (const d of dates) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
