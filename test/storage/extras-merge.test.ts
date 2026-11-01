import { describe, expect, it } from "vitest";
import { withReferrerSnapshot, withReleaseSnapshot } from "../../src/storage/extras-merge.js";
import type { ReferrerMonthFile, ReleasesFile } from "../../src/types.js";

const snap = (count: number) => ({ referrers: [{ referrer: "github.com", count, uniques: 1 }], paths: [] });

describe("withReferrerSnapshot", () => {
  it("creates the month file for the run date", () => {
    expect(withReferrerSnapshot(undefined, 7, "2026-10-27", snap(3))).toEqual({
      schemaVersion: 1,
      repositoryId: 7,
      month: "2026-10",
      snapshots: { "2026-10-27": snap(3) },
    });
  });

  it("keeps other dates and overwrites the same run date", () => {
    const prev: ReferrerMonthFile = {
      schemaVersion: 1,
      repositoryId: 7,
      month: "2026-10",
      snapshots: { "2026-10-26": snap(1), "2026-10-27": snap(2) },
    };
    expect(withReferrerSnapshot(prev, 7, "2026-10-27", { referrers: [], paths: [] }).snapshots).toEqual({
      "2026-10-26": snap(1),
      "2026-10-27": { referrers: [], paths: [] },
    });
  });
});

describe("withReleaseSnapshot", () => {
  it("keeps metadata of deleted releases, updates current ones and replaces the run date's snapshot", () => {
    const prev: ReleasesFile = {
      schemaVersion: 1,
      repositoryId: 7,
      releases: {
        "1": { tag: "v1", name: "Old", publishedDate: "2026-01-01" },
        "2": { tag: "v2", name: "Two", publishedDate: "2026-05-01" },
      },
      snapshots: { "2026-10-26": { "1": 10, "2": 5 }, "2026-10-27": { "1": 11, "2": 6 } },
    };
    const next = withReleaseSnapshot(prev, 7, "2026-10-27", {
      releases: { "2": { tag: "v2", name: "Two (renamed)", publishedDate: "2026-05-01" } },
      downloads: { "2": 8 },
      hasCountedAssets: true,
    });
    expect(next).toEqual({
      schemaVersion: 1,
      repositoryId: 7,
      releases: {
        "1": { tag: "v1", name: "Old", publishedDate: "2026-01-01" },
        "2": { tag: "v2", name: "Two (renamed)", publishedDate: "2026-05-01" },
      },
      snapshots: { "2026-10-26": { "1": 10, "2": 5 }, "2026-10-27": { "2": 8 } },
    });
  });
});
