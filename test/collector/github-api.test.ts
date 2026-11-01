import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ResponseShapeError,
  getAuthenticatedUser,
  getRepository,
  getTraffic,
  listOwnedRepositories,
  parseNextLink,
} from "../../src/collector/github-api.js";
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

const PAGE2_URL = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2";

describe("parseNextLink", () => {
  it("extracts the next url", () => {
    const header = `<${PAGE2_URL}>; rel="next", <https://api.github.com/user/repos?page=3>; rel="last"`;
    expect(parseNextLink(header)).toBe(PAGE2_URL);
  });

  it("finds next when it is not first", () => {
    const header = `<https://api.github.com/x?page=1>; rel="prev", <https://api.github.com/x?page=3>; rel="next"`;
    expect(parseNextLink(header)).toBe("https://api.github.com/x?page=3");
  });

  it("returns null without next", () => {
    expect(parseNextLink(null)).toBeNull();
    expect(parseNextLink(`<https://api.github.com/x?page=1>; rel="prev"`)).toBeNull();
  });
});

describe("getAuthenticatedUser", () => {
  it("returns login and id", async () => {
    const { client } = setup(() => json(fixture("user")));
    expect(await getAuthenticatedUser(client)).toEqual({ login: "octo-sample", id: 5000001 });
  });
});

describe("listOwnedRepositories", () => {
  it("follows the Link header across two pages in order", async () => {
    const { client, fetch } = setup((url) =>
      url.searchParams.get("page") === "2"
        ? json(fixture("user-repos-page-2"))
        : json(fixture("user-repos-page-1"), { link: `<${PAGE2_URL}>; rel="next"` }),
    );
    const repos = await listOwnedRepositories(client);
    expect(repos).toHaveLength(8);
    const all = [...(fixture("user-repos-page-1") as { id: number }[]), ...(fixture("user-repos-page-2") as { id: number }[])];
    expect(repos.map((r) => r.id)).toEqual(all.map((r) => r.id));
    expect(repos[0]).toEqual({
      id: expect.any(Number),
      name: expect.any(String),
      fullName: expect.stringContaining("/"),
      private: expect.any(Boolean),
      fork: expect.any(Boolean),
      archived: expect.any(Boolean),
      stargazersCount: expect.any(Number),
      forksCount: expect.any(Number),
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops after a single page without Link", async () => {
    const { client, fetch } = setup(() => json(fixture("user-repos-page-2")));
    expect(await listOwnedRepositories(client)).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends affiliation=owner and never type", async () => {
    const { client, fetch } = setup(() => json([]));
    await listOwnedRepositories(client);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.pathname).toBe("/user/repos");
    expect(url.searchParams.get("affiliation")).toBe("owner");
    expect(url.searchParams.get("per_page")).toBe("100");
    expect(url.searchParams.has("type")).toBe(false);
  });

  it("throws on a non-boolean private field", async () => {
    const items = fixture("user-repos-page-2") as Record<string, unknown>[];
    const { client } = setup(() => json([{ ...items[0], private: "false" }]));
    await expect(listOwnedRepositories(client)).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws instead of looping forever when a next link repeats", async () => {
    const { client } = setup(() => json([], { link: `<${PAGE2_URL}>; rel="next"` }));
    await expect(listOwnedRepositories(client)).rejects.toThrow(/repeated/);
  });

  it("follows more than 100 pages to the end", async () => {
    const { client, fetch } = setup((url) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      return page < 150
        ? json([], { link: `<https://api.github.com/user/repos?affiliation=owner&per_page=100&page=${page + 1}>; rel="next"` })
        : json([]);
    });
    await expect(listOwnedRepositories(client)).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(150);
  });
});

describe("getTraffic", () => {
  it("fetches views and clones with per=day", async () => {
    const { client, fetch } = setup((url) =>
      json(fixture(url.pathname.endsWith("/views") ? "traffic-views" : "traffic-clones")),
    );
    const { views, clones } = await getTraffic(client, "octo-sample/traffolio");
    const urls = fetch.mock.calls.map((c) => new URL(String(c[0])));
    expect(urls.map((u) => u.pathname)).toEqual([
      "/repos/octo-sample/traffolio/traffic/views",
      "/repos/octo-sample/traffolio/traffic/clones",
    ]);
    expect(urls.every((u) => u.searchParams.get("per") === "day")).toBe(true);
    expect(views).toEqual((fixture("traffic-views") as { views: unknown[] }).views);
    expect(clones).toEqual((fixture("traffic-clones") as { clones: unknown[] }).clones);
  });

  it("throws on a malformed traffic body", async () => {
    const { client } = setup(() => json({ count: 1, uniques: 1 }));
    await expect(getTraffic(client, "octo-sample/traffolio")).rejects.toBeInstanceOf(ResponseShapeError);
  });
});

describe("getRepository", () => {
  it.each([
    ["self-repo-private", true, false],
    ["self-repo-public", false, false],
    ["self-repo-template", undefined, true],
  ])("maps %s", async (name, isPrivate, isTemplate) => {
    const body = fixture(name) as { id: number; private: boolean };
    const { client } = setup(() => json(body));
    expect(await getRepository(client, "octo-sample/traffolio")).toEqual({
      id: body.id,
      private: isPrivate ?? body.private,
      isTemplate,
    });
  });

  it("throws when private is missing", async () => {
    const { client } = setup(() => json(fixture("self-repo-malformed")));
    await expect(getRepository(client, "octo-sample/traffolio")).rejects.toBeInstanceOf(ResponseShapeError);
  });

  it("throws on a string private without echoing the body", async () => {
    const { client } = setup(() => json({ id: 1, private: "false", is_template: false }));
    const err = await getRepository(client, "octo-sample/traffolio").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseShapeError);
    expect((err as Error).message).toBe("Unexpected response shape from GET /repos/octo-sample/traffolio");
  });
});
