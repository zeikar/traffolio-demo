import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCollect } from "../src/run-collect.js";

const repoRoot = new URL("..", import.meta.url).pathname;

function fixtureText(name: string): string {
  return readFileSync(join(repoRoot, "fixtures/api", `${name}.json`), "utf8");
}

const TRAFFIC_TOKEN = "github_pat_SENTINEL_TRAFFIC";
const GITHUB_TOKEN = "ghs_SENTINEL_ACTIONS";
// Full tokens plus fragments, so a truncated or re-wrapped leak is caught too.
const SENTINELS = [TRAFFIC_TOKEN, GITHUB_TOKEN, "SENTINEL_TRAFFIC", "SENTINEL_ACTIONS", "BODY_SENTINEL"];

const CONFIG = `repositories:
  include: ["*"]
  exclude: ["test-*"]
`;
const README = `# Hello

<!-- TRAFFOLIO:START -->
placeholder
<!-- TRAFFOLIO:END -->
`;
const PAGE2_URL = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2";
const HISTORY_PAGE2_URL = "https://api.github.com/repositories/100001/stargazers/history?per_page=30&page=2";

type Override = (url: URL) => Response | undefined;

function route(url: URL, override: Override, self: string): Response {
  const forced = override(url);
  if (forced) return forced;
  const ok = (text: string, headers: Record<string, string> = {}) => new Response(text, { status: 200, headers });
  const path = url.pathname;
  if (path === "/repos/octo-sample/traffolio") return ok(fixtureText(self));
  if (path === "/user") return ok(fixtureText("user"));
  if (path === "/user/repos") {
    return url.searchParams.get("page") === "2"
      ? ok(fixtureText("user-repos-page-2"))
      : ok(fixtureText("user-repos-page-1"), { link: `<${PAGE2_URL}>; rel="next"` });
  }
  if (/^\/repos\/octo-sample\/[^/]+\/traffic\/views$/.test(path)) return ok(fixtureText("traffic-views"));
  if (/^\/repos\/octo-sample\/[^/]+\/traffic\/clones$/.test(path)) return ok(fixtureText("traffic-clones"));
  if (path === "/repos/octo-sample/sample-cli/stargazers/history") {
    return ok(fixtureText("star-history-page-1"), { link: `<${HISTORY_PAGE2_URL}>; rel="next"` });
  }
  if (path === "/repositories/100001/stargazers/history") return ok(fixtureText("star-history-page-2"));
  if (path === "/repos/octo-sample/sample-cli/forks") return ok(fixtureText("forks"));
  if (path === "/repos/octo-sample/sample-cli/releases") return ok(fixtureText("releases"));
  if (/^\/repos\/octo-sample\/[^/]+\/(stargazers\/history|forks|releases)$/.test(path)) return ok("[]");
  if (/\/traffic\/popular\/referrers$/.test(path)) return ok(fixtureText("traffic-referrers"));
  if (/\/traffic\/popular\/paths$/.test(path)) return ok(fixtureText("traffic-paths"));
  return new Response("{}", { status: 404 });
}

/** Fork-owner logins in the fixtures: user data that must never be stored. (Star history has no users.) */
const FORK_OWNER_LOGINS = (JSON.parse(fixtureText("forks")) as { owner: { login: string } }[]).map((f) => f.owner.login);

const isTraffic = (url: URL) => /\/traffic\/(views|clones)$/.test(url.pathname);
const isExtra = (url: URL) =>
  /\/(stargazers\/history|forks|releases|traffic\/popular\/(referrers|paths))$/.test(url.pathname);
const failing = (status: number, match: (url: URL) => boolean): Override => (url) =>
  match(url) ? new Response(JSON.stringify({ message: "BODY_SENTINEL" }), { status }) : undefined;

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

let root: string;
let actionsDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "traffolio-sec-"));
  actionsDir = await mkdtemp(join(tmpdir(), "traffolio-sec-actions-"));
  await writeFile(join(root, "traffolio.config.yml"), CONFIG);
  await writeFile(join(root, "README.md"), README);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(actionsDir, { recursive: true, force: true });
});

async function runAndCollectOutputs(override: Override, self = "self-repo-private") {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => route(new URL(String(input)), override, self));
  const sleeps: number[] = [];
  const lines: string[] = [];
  const outputFile = join(actionsDir, "output");
  const summaryFile = join(actionsDir, "summary");
  const result = await runCollect({
    env: {
      GITHUB_TOKEN,
      GITHUB_REPOSITORY: "octo-sample/traffolio",
      TRAFFIC_TOKEN,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
    },
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    rootDir: root,
    now: () => Date.parse("2026-10-27T03:37:12Z"),
    log: (line) => lines.push(line),
  });

  const texts: Record<string, string> = { log: lines.join("\n") };
  for (const file of [outputFile, summaryFile]) texts[file] = await readFile(file, "utf8");
  for (const file of await filesUnder(root)) texts[file] = await readFile(file, "utf8");
  return { fetch, result, sleeps, texts };
}

function expectNoSentinel(texts: Record<string, string>) {
  for (const [name, text] of Object.entries(texts)) {
    for (const sentinel of SENTINELS) {
      expect(text, `${sentinel} leaked into ${name}`).not.toContain(sentinel);
    }
  }
}

function authFor(fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>, match: (url: URL) => boolean) {
  const calls = fetch.mock.calls.filter(([input]) => match(new URL(String(input))));
  expect(calls.length).toBeGreaterThan(0);
  return calls.map(([, init]) => new Headers(init?.headers).get("authorization"));
}

describe("token and response-body hygiene", () => {
  it("happy path leaks no token", async () => {
    const { fetch, result, texts } = await runAndCollectOutputs(() => undefined);
    expect(result.outcome).toBe("ok");
    expect(authFor(fetch, isTraffic).every((a) => a === `Bearer ${TRAFFIC_TOKEN}`)).toBe(true);
    expect(authFor(fetch, isExtra).every((a) => a === `Bearer ${TRAFFIC_TOKEN}`)).toBe(true);
    expectNoSentinel(texts);
  });

  it("stores no fork-owner login anywhere", async () => {
    const { result, texts } = await runAndCollectOutputs(() => undefined);
    expect(result.outcome).toBe("ok");
    expect(Object.keys(texts).some((name) => name.includes("data/growth/100001.json"))).toBe(true);
    expect(FORK_OWNER_LOGINS.length).toBe(5);
    for (const [name, text] of Object.entries(texts)) {
      for (const login of FORK_OWNER_LOGINS) expect(text, `${login} leaked into ${name}`).not.toContain(login);
    }
  });

  it.each([
    ["401 on stargazers/history", 401, "fatal"],
    ["403 on referrers", 403, "ok"],
    ["500 on releases", 500, "partial"],
  ] as const)("%s leaks neither token nor body", async (label, code, outcome) => {
    const target = label.split(" on ")[1]!;
    const { result, texts } = await runAndCollectOutputs(
      failing(code, (u) => u.pathname.startsWith("/repos/octo-sample/sample-cli/") && u.pathname.includes(target)),
    );
    expect(result.outcome).toBe(outcome);
    expectNoSentinel(texts);
  });

  it("401 on a traffic endpoint leaks neither token nor body", async () => {
    const { fetch, result, texts } = await runAndCollectOutputs(failing(401, isTraffic));
    expect(result).toMatchObject({ outcome: "fatal", exitCode: 1 });
    expect(authFor(fetch, isTraffic)[0]).toBe(`Bearer ${TRAFFIC_TOKEN}`);
    expectNoSentinel(texts);
  });

  it("401 on /user leaks neither token nor body", async () => {
    const { fetch, result, texts } = await runAndCollectOutputs(failing(401, (u) => u.pathname === "/user"));
    expect(result).toMatchObject({ outcome: "fatal", exitCode: 1 });
    expect(authFor(fetch, (u) => u.pathname === "/user")[0]).toBe(`Bearer ${TRAFFIC_TOKEN}`);
    expectNoSentinel(texts);
  });

  it("500 on every traffic call (after retries) leaks neither token nor body", async () => {
    const { fetch, result, sleeps, texts } = await runAndCollectOutputs(failing(500, isTraffic));
    expect(result.outcome).toBe("fatal");
    expect(sleeps.length).toBeGreaterThan(0);
    expect(authFor(fetch, isTraffic).every((a) => a === `Bearer ${TRAFFIC_TOKEN}`)).toBe(true);
    expectNoSentinel(texts);
  });

  it("500 on one repo only (partial run) leaks neither token nor body", async () => {
    const { result, sleeps, texts } = await runAndCollectOutputs(
      failing(500, (u) => u.pathname === "/repos/octo-sample/sample-cli/traffic/views"),
    );
    expect(result.outcome).toBe("partial");
    expect(sleeps.length).toBeGreaterThan(0);
    expectNoSentinel(texts);
  });
});

describe("public_mode", () => {
  // In a public repository the log, summary, outputs and files are all public.
  it.each([
    ["happy path", () => undefined, "ok"],
    ["500 on releases", failing(500, (u) => u.pathname === "/repos/octo-sample/sample-cli/releases"), "partial"],
    ["401 on a traffic endpoint", failing(401, isTraffic), "fatal"],
  ] as const)("%s names no private repository and leaks neither token nor body", async (_label, override, outcome) => {
    await writeFile(join(root, "traffolio.config.yml"), `public_mode: true\n${CONFIG}`);
    const { fetch, result, texts } = await runAndCollectOutputs(override, "self-repo-public");
    expect(result.outcome).toBe(outcome);
    expect(fetch.mock.calls.some(([input]) => String(input).includes("secret-notes"))).toBe(false);
    for (const [name, text] of Object.entries(texts)) {
      expect(text, `secret-notes leaked into ${name}`).not.toContain("secret-notes");
      expect(text, `100007 leaked into ${name}`).not.toContain("100007");
    }
    expectNoSentinel(texts);
  });
});

describe("sample/real data separation", () => {
  it("no file under fixtures/ or docs/demo/ mentions the owner's handle", async () => {
    const files = [...(await filesUnder(join(repoRoot, "fixtures"))), ...(await filesUnder(join(repoRoot, "docs/demo")))];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect((await readFile(file, "utf8")).toLowerCase(), file).not.toContain("zeikar");
    }
  });

  it("every docs/demo chart except the sparklines is labelled SAMPLE DATA, every page *Sample data*", async () => {
    const files = await filesUnder(join(repoRoot, "docs/demo"));
    const charts = files.filter((f) => f.endsWith(".svg") && !f.includes("/assets/sparklines/"));
    const pages = files.filter((f) => f.includes("/docs/demo/repos/") && f.endsWith(".md"));
    expect(charts.length).toBeGreaterThanOrEqual(11);
    expect(pages.length).toBe(3);
    for (const file of charts) expect(await readFile(file, "utf8"), file).toContain("SAMPLE DATA");
    for (const file of pages) expect(await readFile(file, "utf8"), file).toContain("*Sample data*");
  });

  it("demo CLI reads only fixtures/demo, never the repo-root data/", async () => {
    const source = await readFile(join(repoRoot, "src/cli/demo.ts"), "utf8");
    // Static check: every store the demo reads from must be rooted at fixtures/demo. The only
    // other store is the repo root, used solely to write docs/demo/* outputs.
    expect(source).toMatch(/createStore\(join\(repoRoot, "fixtures", "demo"\)\)/);
    const out = source.match(/const out = createStore\(repoRoot\);/);
    expect(out).not.toBeNull();
    expect(source).not.toMatch(/\bout\.(read\w+)\(/);
    expect(join(repoRoot, "fixtures/demo/data")).not.toBe(join(repoRoot, "data"));
  });
});
