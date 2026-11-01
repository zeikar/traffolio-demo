import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ConfigError } from "../../src/collector/config.js";
import { checkTrafficToken, decidePreflight, lookupSelfRepository } from "../../src/collector/preflight.js";

function fixtureText(name: string): string {
  return readFileSync(new URL(`../../fixtures/api/${name}.json`, import.meta.url), "utf8");
}

function lookup(fetchImpl: typeof globalThis.fetch, overrides: Partial<Parameters<typeof lookupSelfRepository>[0]> = {}) {
  const log = vi.fn<(line: string) => void>();
  const fetch = vi.fn(fetchImpl);
  const promise = lookupSelfRepository({
    githubToken: "ghs_secret",
    repositoryFullName: "octo-sample/traffolio",
    fetch,
    sleep: async () => {},
    now: () => 0,
    log,
    ...overrides,
  });
  return { promise, log, fetch };
}

const respond = (body: string, status = 200) => async () => new Response(body, { status });

describe("decidePreflight", () => {
  const off = { publicMode: false };
  const on = { publicMode: true };

  it("proceeds in private mode for a private repo, whatever public_mode says", () => {
    for (const options of [off, on]) {
      expect(decidePreflight({ id: 7, private: true, isTemplate: false }, options)).toEqual({
        action: "proceed",
        selfRepoId: 7,
        mode: "private",
      });
    }
  });

  it("fails for a public repo without public_mode", () => {
    expect(decidePreflight({ id: 7, private: false, isTemplate: false }, off)).toEqual({ action: "fail", reason: "public" });
  });

  it("proceeds in public mode for a public repo with public_mode", () => {
    expect(decidePreflight({ id: 7, private: false, isTemplate: false }, on)).toEqual({
      action: "proceed",
      selfRepoId: 7,
      mode: "public",
    });
  });

  it("skips a template, before checking visibility", () => {
    for (const options of [off, on]) {
      expect(decidePreflight({ id: 7, private: false, isTemplate: true }, options)).toEqual({ action: "skip_template" });
      expect(decidePreflight({ id: 7, private: true, isTemplate: true }, options)).toEqual({ action: "skip_template" });
    }
  });

  it("fails as undeterminable without info, even with public_mode", () => {
    expect(decidePreflight(undefined, off)).toEqual({ action: "fail", reason: "undeterminable" });
    expect(decidePreflight(undefined, on)).toEqual({ action: "fail", reason: "undeterminable" });
  });
});

describe("lookupSelfRepository", () => {
  it("returns the normalized info for the private fixture", async () => {
    const { promise, fetch } = lookup(respond(fixtureText("self-repo-private")));
    expect(await promise).toEqual({ id: 100008, private: true, isTemplate: false });
    expect(String(fetch.mock.calls[0][0])).toBe("https://api.github.com/repos/octo-sample/traffolio");
  });

  it("returns the normalized info for the public fixture", async () => {
    const { promise } = lookup(respond(fixtureText("self-repo-public")));
    const info = await promise;
    expect(decidePreflight(info, { publicMode: false })).toEqual({ action: "fail", reason: "public" });
  });

  it("returns undefined for the malformed fixture", async () => {
    const { promise, log } = lookup(respond(fixtureText("self-repo-malformed")));
    const info = await promise;
    expect(info).toBeUndefined();
    expect(decidePreflight(info, { publicMode: false })).toEqual({ action: "fail", reason: "undeterminable" });
    expect(log).toHaveBeenCalledWith("self-repository lookup failed (response_shape)");
  });

  it("returns undefined for a string `private`", async () => {
    const { promise } = lookup(respond('{"private":"true"}'));
    expect(await promise).toBeUndefined();
  });

  it("returns undefined on 404 and logs the kind only", async () => {
    const { promise, log } = lookup(respond('{"message":"Not Found"}', 404));
    expect(await promise).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toMatch(/^self-repository lookup failed \(\w+\)$/);
    expect(log.mock.calls[0][0]).not.toContain("ghs_secret");
  });

  it("returns undefined on network errors", async () => {
    const { promise } = lookup(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await promise).toBeUndefined();
  });

  it("returns undefined without calling fetch when env is missing or malformed", async () => {
    for (const overrides of [
      { githubToken: undefined },
      { githubToken: "" },
      { repositoryFullName: undefined },
      { repositoryFullName: "no-slash" },
      { repositoryFullName: "a/b/c" },
    ]) {
      const { promise, fetch } = lookup(respond(fixtureText("self-repo-private")), overrides);
      expect(await promise).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});

describe("checkTrafficToken", () => {
  it("returns the token", () => {
    expect(checkTrafficToken({ TRAFFIC_TOKEN: "tok" })).toBe("tok");
  });

  it.each([undefined, "", "   "])("throws a setup pointer for %j", (value) => {
    expect(() => checkTrafficToken({ TRAFFIC_TOKEN: value })).toThrow(ConfigError);
    expect(() => checkTrafficToken({ TRAFFIC_TOKEN: value })).toThrow("README › Setup step 5.");
  });
});
