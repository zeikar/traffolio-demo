import { describe, expect, it } from "vitest";
import { topReferrers } from "../../src/reporter/referrers.js";
import type { ReferrerEntry, ReferrerMonthFile } from "../../src/types.js";

const ref = (referrer: string, count: number): ReferrerEntry => ({ referrer, count, uniques: 1 });

function file(repoId: number, snapshots: Record<string, ReferrerEntry[]>): ReferrerMonthFile {
  return {
    schemaVersion: 1,
    repositoryId: repoId,
    month: "2026-10",
    snapshots: Object.fromEntries(Object.entries(snapshots).map(([d, referrers]) => [d, { referrers, paths: [] }])),
  };
}

describe("topReferrers", () => {
  it("sums counts per referrer on the newest snapshot date, top 5 by count then name", () => {
    const top = topReferrers([
      file(1, {
        "2026-10-26": [ref("old.example", 999)],
        "2026-10-27": [ref("github.com", 10), ref("Google", 4), ref("a.example", 1), ref("b.example", 1)],
      }),
      file(2, { "2026-10-27": [ref("github.com", 5), ref("Google", 6), ref("c.example", 2), ref("d.example", 1)] }),
      // Stale: this repository's referrers last succeeded earlier, so it is left out.
      file(3, { "2026-10-20": [ref("stale.example", 500)] }),
    ]);
    expect(top).toEqual({
      date: "2026-10-27",
      referrers: [
        { referrer: "github.com", count: 15 },
        { referrer: "Google", count: 10 },
        { referrer: "c.example", count: 2 },
        { referrer: "a.example", count: 1 },
        { referrer: "b.example", count: 1 },
      ],
    });
  });

  it("is null without snapshots or when the newest snapshots are empty", () => {
    expect(topReferrers([])).toBeNull();
    expect(topReferrers([file(1, {})])).toBeNull();
    expect(topReferrers([file(1, { "2026-10-20": [ref("x", 1)], "2026-10-27": [] })])).toBeNull();
  });
});
