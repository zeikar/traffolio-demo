import { describe, expect, it, vi } from "vitest";
import { GitHubApiError, createGitHubClient } from "../../src/collector/github-client.js";

const TOKEN = "ghp_SENTINEL_TOKEN_123";
const NOW = 1_800_000_000_000;
const SECONDARY = "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.";

function res(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

function setup(...responses: (Response | Error)[]) {
  const fetch = vi.fn<typeof globalThis.fetch>();
  for (const r of responses) {
    if (r instanceof Error) fetch.mockRejectedValueOnce(r);
    else fetch.mockResolvedValueOnce(r);
  }
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createGitHubClient({ token: TOKEN, fetch, sleep, now: () => NOW });
  return { client, fetch, sleep };
}

async function failure(p: Promise<unknown>): Promise<GitHubApiError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GitHubApiError);
  return err as GitHubApiError;
}

const resetIn = (seconds: number) => String(NOW / 1000 + seconds);

describe("createGitHubClient", () => {
  it("returns status, headers and parsed body, sending the required headers", async () => {
    const { client, fetch } = setup(res(200, [{ id: 1 }], { link: '<x>; rel="next"' }));
    const out = await client.get("/user/repos", { per_page: 100, affiliation: "owner" });
    expect(out.status).toBe(200);
    expect(out.body).toEqual([{ id: 1 }]);
    expect(out.headers.get("link")).toBe('<x>; rel="next"');

    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe("https://api.github.com/user/repos?per_page=100&affiliation=owner");
    const sent = new Headers(init?.headers);
    expect(sent.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(sent.get("accept")).toBe("application/vnd.github+json");
    expect(sent.get("x-github-api-version")).toBe("2026-03-10");
    expect(sent.get("user-agent")).toBe("traffolio");
  });

  it("accepts an absolute api.github.com URL (Link rel=next)", async () => {
    const { client, fetch } = setup(res(200, []));
    await client.get("https://api.github.com/user/repos?page=2&per_page=100");
    expect(String(fetch.mock.calls[0]![0])).toBe("https://api.github.com/user/repos?page=2&per_page=100");
  });

  it.each(["https://evil.example/user/repos", "//evil.example/user/repos", "http://api.github.com/user"])(
    "rejects %s without calling fetch",
    async (url) => {
      const { client, fetch } = setup(res(200, []));
      await expect(client.get(url)).rejects.toThrow(/origin/);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("401 -> auth after one attempt", async () => {
    const { client, fetch, sleep } = setup(res(401, { message: "Bad credentials" }));
    const err = await failure(client.get("/user"));
    expect(err).toMatchObject({ status: 401, kind: "auth", path: "/user" });
    expect(err.message).toBe("GET /user failed: HTTP 401 (auth)");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("404 -> not_found, path excludes query", async () => {
    const { client, fetch } = setup(res(404, { message: "Not Found" }));
    const err = await failure(client.get("/repos/me/x/traffic/views", { per: "day" }));
    expect(err).toMatchObject({ status: 404, kind: "not_found", path: "/repos/me/x/traffic/views" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("500 x3 -> transient after 3 attempts with backoff [500, 1000]", async () => {
    const { client, fetch, sleep } = setup(res(500), res(500), res(500));
    const err = await failure(client.get("/user"));
    expect(err).toMatchObject({ status: 500, kind: "transient" });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000]);
  });

  it("502 then 200 -> success", async () => {
    const { client, sleep } = setup(res(502, "<html>bad gateway</html>"), res(200, { ok: true }));
    expect((await client.get("/user")).body).toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500]);
  });

  it("network TypeError then 200 -> success", async () => {
    const { client, sleep } = setup(new TypeError("fetch failed"), res(200, { ok: true }));
    expect((await client.get("/user")).body).toEqual({ ok: true });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500]);
  });

  it("network failure x3 -> status 0 transient, message keeps to the path", async () => {
    const leak = new TypeError("fetch failed: https://api.github.com/user/repos?secret=1");
    const { client, fetch } = setup(leak, leak, leak);
    const err = await failure(client.get("/user/repos", { secret: "1" }));
    expect(err).toMatchObject({ status: 0, kind: "transient", path: "/user/repos" });
    expect(err.message).toBe("GET /user/repos failed: HTTP 0 (transient)");
    expect(String(err)).not.toContain("secret");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("429 with retry-after: 7 -> sleep(7000) then retry", async () => {
    const { client, sleep } = setup(res(429, {}, { "retry-after": "7" }), res(200, {}));
    await client.get("/user");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([7000]);
  });

  it("403 with remaining 0 and reset 30 s ahead -> sleep(30000) then retry", async () => {
    const { client, fetch, sleep } = setup(
      res(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": resetIn(30) }),
      res(200, {}),
    );
    await client.get("/user");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([30000]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("403 with remaining 0 and reset 10 min ahead -> no retry, rate_limited", async () => {
    const { client, fetch, sleep } = setup(
      res(403, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": resetIn(600) }),
    );
    const err = await failure(client.get("/user"));
    expect(err).toMatchObject({ status: 403, kind: "rate_limited" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("403 secondary limit (message only) -> rate_limited, sleep(60000), message text not in error", async () => {
    const { client, fetch, sleep } = setup(
      res(403, { message: SECONDARY }),
      res(403, { message: SECONDARY }),
      res(403, { message: SECONDARY }),
    );
    const err = await failure(client.get("/user"));
    expect(err).toMatchObject({ status: 403, kind: "rate_limited" });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([60000, 60000]);
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const text of [err.message, String(err), err.stack ?? "", JSON.stringify(err)]) {
      expect(text).not.toContain("secondary");
    }
  });

  it("secondary limit with quota remaining ignores a near reset -> sleep(60000)", async () => {
    const { client, sleep } = setup(
      res(403, { message: SECONDARY }, { "x-ratelimit-remaining": "42", "x-ratelimit-reset": resetIn(30) }),
      res(200, {}),
    );
    await client.get("/user");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([60000]);
  });

  it("secondary limit with quota remaining ignores a far reset -> sleep(60000) and retry", async () => {
    const { client, fetch, sleep } = setup(
      res(403, { message: SECONDARY }, { "x-ratelimit-remaining": "42", "x-ratelimit-reset": resetIn(600) }),
      res(200, {}),
    );
    await client.get("/user");
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([60000]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("403 without rate-limit signals -> forbidden, no retry", async () => {
    const { client, fetch } = setup(res(403, { message: "Resource not accessible by personal access token" }));
    const err = await failure(client.get("/repos/me/x/traffic/views"));
    expect(err).toMatchObject({ status: 403, kind: "forbidden" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("never exposes the token or response body in the error", async () => {
    const body = "BODY_SENTINEL_xyz";
    const { client } = setup(res(401, { message: body, documentation_url: body }));
    const err = await failure(client.get("/user"));
    for (const text of [err.message, String(err), err.stack ?? "", JSON.stringify(err)]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(body);
    }
  });

  it("a non-JSON 2xx body fails without echoing the body", async () => {
    const { client } = setup(res(200, "<html>BODY_SENTINEL_xyz</html>"));
    const err = await failure(client.get("/user"));
    expect(err).toMatchObject({ status: 200, kind: "unknown" });
    expect(String(err)).not.toContain("BODY_SENTINEL");
  });
});
