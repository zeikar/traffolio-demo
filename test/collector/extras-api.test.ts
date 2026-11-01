import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  getPopularPaths,
  getReferrers,
  listForkTimestamps,
  listReleases,
  listStarHistory,
} from "../../src/collector/extras-api.js";
import { PageLimitError, ResponseShapeError } from "../../src/collector/github-api.js";
import { createGitHubClient } from "../../src/collector/github-client.js";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`../../fixtures/api/${name}.json`, import.meta.url), "utf8"));
}

function setup(route: (url: URL) => Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => route(new URL(String(input))));
  const client = createGitHubClient({ token: "dummy", fetch, sleep: async () => {}, now: () => 0 });
  return { client, fetch };
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers });
}

// GitHub's Link URLs for repository listings use the numeric /repositories/{id} form.
const HISTORY_PAGE2 = "https://api.github.com/repositories/100001/stargazers/history?per_page=30&page=2";

describe("listStarHistory", () => {
  it("follows Link across two pages and returns week and days of every week, in order", async () => {
    const { client, fetch } = setup((url) =>
      url.searchParams.get("page") === "2"
        ? json(fixture("star-history-page-2"))
        : json(fixture("star-history-page-1"), { link: `<${HISTORY_PAGE2}>; rel="next"` }),
    );
    const weeks = await listStarHistory(client, "octo-sample/sample-cli");

    const pages = [fixture("star-history-page-1"), fixture("star-history-page-2")] as { week: number; days: number[] }[][];
    expect(weeks).toEqual(pages.flat().map(({ week, days }) => ({ week, days })));
    expect(weeks).toHaveLength(40);

    const urls = fetch.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0]!.pathname).toBe("/repos/octo-sample/sample-cli/stargazers/history");
    expect(urls[0]!.searchParams.get("per_page")).toBe("30");
    expect(String(urls[1])).toBe(HISTORY_PAGE2);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github+json");
    }
  });

  it("ignores unknown keys", async () => {
    const { client } = setup(() => json([{ week: 1792886400, total: 1, days: [0, 1, 0, 0, 0, 0, 0], extra: "x" }]));
    expect(await listStarHistory(client, "o/r")).toEqual([{ week: 1792886400, days: [0, 1, 0, 0, 0, 0, 0] }]);
  });

  it.each([
    ["six days", { week: 1792886400, total: 0, days: [0, 0, 0, 0, 0, 0] }],
    ["eight days", { week: 1792886400, total: 0, days: [0, 0, 0, 0, 0, 0, 0, 0] }],
    ["a fractional count", { week: 1792886400, total: 1, days: [0.5, 0.5, 0, 0, 0, 0, 0] }],
    ["a negative count", { week: 1792886400, total: 0, days: [-1, 1, 0, 0, 0, 0, 0] }],
    ["a string week", { week: "2026-10-25", total: 0, days: [0, 0, 0, 0, 0, 0, 0] }],
    ["a missing total", { week: 1792886400, days: [0, 0, 0, 0, 0, 0, 0] }],
    ["a stargazer object", { starred_at: "2026-10-25T00:00:00Z", user: { login: "someone" } }],
  ])("rejects %s as a shape error", async (_label, item) => {
    const { client } = setup(() => json([item]));
    await expect(listStarHistory(client, "o/r")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("stops at the page limit", async () => {
    const { client } = setup(() => json([], { link: `<${HISTORY_PAGE2}>; rel="next"` }));
    await expect(listStarHistory(client, "o/r")).rejects.toBeInstanceOf(PageLimitError);
  });
});

describe("listForkTimestamps", () => {
  it("returns created_at of each fork with the default media type", async () => {
    const { client, fetch } = setup(() => json(fixture("forks")));
    const stamps = await listForkTimestamps(client, "octo-sample/sample-cli");
    expect(stamps).toEqual((fixture("forks") as { created_at: string }[]).map((f) => f.created_at));
    const [input, init] = fetch.mock.calls[0]!;
    expect(new URL(String(input)).pathname).toBe("/repos/octo-sample/sample-cli/forks");
    expect(new Headers(init?.headers).get("accept")).toBe("application/vnd.github+json");
  });
});

describe("referrers and paths", () => {
  it("parse the popular referrers and paths, dropping unknown keys", async () => {
    const { client, fetch } = setup((url) =>
      url.pathname.endsWith("/referrers")
        ? json([{ referrer: "github.com", count: 3, uniques: 2, extra: true }])
        : json(fixture("traffic-paths")),
    );
    expect(await getReferrers(client, "o/r")).toEqual([{ referrer: "github.com", count: 3, uniques: 2 }]);
    expect(await getPopularPaths(client, "o/r")).toEqual(fixture("traffic-paths"));
    expect(fetch.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/repos/o/r/traffic/popular/referrers",
      "/repos/o/r/traffic/popular/paths",
    ]);
  });

  it("throws on a malformed body", async () => {
    const { client } = setup(() => json({ referrers: [] }));
    await expect(getReferrers(client, "o/r")).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("listReleases", () => {
  it("maps every release, drafts included (filtered later)", async () => {
    const { client } = setup(() => json(fixture("releases")));
    const releases = await listReleases(client, "octo-sample/sample-cli");
    expect(releases.map((r) => [r.id, r.draft])).toEqual([
      [9000004, true],
      [9000003, false],
      [9000002, false],
      [9000001, false],
    ]);
    expect(releases[1]).toEqual({
      id: 9000003,
      tag: "v2.1.0-beta.1",
      name: "v2.1.0 beta 1",
      draft: false,
      publishedAt: "2026-10-20T23:30:00Z",
      assets: [
        { name: "sample-cli-2.1.0-beta.1-x64.dmg", downloadCount: 15 },
        { name: "sample-cli-2.1.0-beta.1-x64.dmg.blockmap", downloadCount: 120 },
        { name: "latest-mac.yml", downloadCount: 300 },
      ],
    });
    expect(releases[3]).toMatchObject({ name: null, assets: [] });
  });
});
