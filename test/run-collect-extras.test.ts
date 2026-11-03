import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCollect } from "../src/run-collect.js";
import type { CollectResult } from "../src/run-collect.js";
import type { GrowthFile, ReferrerMonthFile, ReleasesFile, StatusFile } from "../src/types.js";

// Star/fork history, referrer snapshots and release downloads (README › Data, Security failure table).

function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/api/${name}.json`, import.meta.url), "utf8");
}

const DAY1 = Date.parse("2026-10-27T03:37:12Z");
const DAY2 = Date.parse("2026-10-28T03:37:12Z");
const SELF_PATH = "/repos/octo-sample/traffolio";
const REPOS_PAGE2 = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2";
const HISTORY_PAGE2 = "https://api.github.com/repositories/100001/stargazers/history?per_page=30&page=2";
const HISTORY = "stargazers/history";
const EXTRA_PATH = /\/(stargazers\/history|forks|releases|traffic\/popular\/(referrers|paths))$/;

const CONFIG = `repositories:
  include: ["*"]
  exclude: ["test-*"]
`;
const README = `# Hello

<!-- TRAFFOLIO:START -->
placeholder
<!-- TRAFFOLIO:END -->
`;

const repoPath = (name: string, rest: string) => `/repos/octo-sample/${name}/${rest}`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

type Handler = (url: URL) => Response;
type Routes = Record<string, Handler>;

const status =
  (code: number, headers: Record<string, string> = {}, message = "error"): Handler =>
  () =>
    json({ message }, code, headers);

/** sample-cli has star history (two pages), forks and releases; the other repositories have none. */
function defaultRoute(url: URL): Response {
  const path = url.pathname;
  if (path === SELF_PATH) return json(fixtureText("self-repo-private"));
  if (path === "/user") return json(fixtureText("user"));
  if (path === "/user/repos") {
    return url.searchParams.get("page") === "2"
      ? json(fixtureText("user-repos-page-2"))
      : json(fixtureText("user-repos-page-1"), 200, { link: `<${REPOS_PAGE2}>; rel="next"` });
  }
  if (path === repoPath("sample-cli", HISTORY)) {
    return json(fixtureText("star-history-page-1"), 200, { link: `<${HISTORY_PAGE2}>; rel="next"` });
  }
  if (path === "/repositories/100001/stargazers/history") return json(fixtureText("star-history-page-2"));
  if (path === repoPath("sample-cli", "forks")) return json(fixtureText("forks"));
  if (path === repoPath("sample-cli", "releases")) return json(fixtureText("releases"));
  const m = /^\/repos\/octo-sample\/[^/]+\/(.+)$/.exec(path);
  if (m?.[1] === "traffic/views") return json(fixtureText("traffic-views"));
  if (m?.[1] === "traffic/clones") return json(fixtureText("traffic-clones"));
  if (m?.[1] === "traffic/popular/referrers") return json(fixtureText("traffic-referrers"));
  if (m?.[1] === "traffic/popular/paths") return json(fixtureText("traffic-paths"));
  if (m && [HISTORY, "forks", "releases"].includes(m[1]!)) return json([]);
  return json({ message: "Not Found" }, 404);
}

let root: string;
let actionsDir: string;
let runCount = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "traffolio-extras-"));
  actionsDir = await mkdtemp(join(tmpdir(), "traffolio-extras-actions-"));
  await writeFile(join(root, "traffolio.config.yml"), CONFIG);
  await writeFile(join(root, "README.md"), README);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(actionsDir, { recursive: true, force: true });
});

interface Run {
  result: CollectResult;
  requested: string[];
  sleeps: number[];
  lines: string[];
  summary: string;
}

async function run(options: { routes?: Routes; now?: number } = {}): Promise<Run> {
  const routes = options.routes ?? {};
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    return (routes[url.pathname] ?? defaultRoute)(url);
  });
  const sleeps: number[] = [];
  const lines: string[] = [];
  runCount++;
  const summaryFile = join(actionsDir, `summary-${runCount}`);
  const result = await runCollect({
    env: {
      GITHUB_TOKEN: "ghs_actions_secret",
      GITHUB_REPOSITORY: "octo-sample/traffolio",
      TRAFFIC_TOKEN: "github_pat_traffic_secret",
      GITHUB_OUTPUT: join(actionsDir, `output-${runCount}`),
      GITHUB_STEP_SUMMARY: summaryFile,
    },
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    rootDir: root,
    now: () => options.now ?? DAY1,
    log: (line) => lines.push(line),
  });
  return {
    result,
    requested: fetch.mock.calls.map(([input]) => new URL(String(input)).pathname),
    sleeps,
    lines,
    summary: await readFile(summaryFile, "utf8"),
  };
}

type Tree = Record<string, string>;

async function snapshot(): Promise<Tree> {
  const tree: Tree = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    tree[relative(root, abs)] = await readFile(abs, "utf8");
  }
  return tree;
}

function changedPaths(before: Tree, after: Tree): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((p) => before[p] !== after[p]).sort();
}

const readJson = async <T>(rel: string): Promise<T> => JSON.parse(await readFile(join(root, rel), "utf8")) as T;
const extrasFiles = (tree: Tree) =>
  Object.keys(tree)
    .filter((p) => /^data\/(growth|referrers|releases)\//.test(p))
    .sort();

const SEEDED_EXTRAS = [
  "data/growth/100001.json",
  "data/growth/100002.json",
  "data/growth/100003.json",
  "data/referrers/100001/2026-10.json",
  "data/referrers/100002/2026-10.json",
  "data/referrers/100003/2026-10.json",
  "data/releases/100001.json",
];

async function seed(): Promise<Tree> {
  const r = await run();
  expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
  return snapshot();
}

describe("extras happy path", () => {
  it("writes growth, referrers and releases for selected repos only; same-day rerun commits nothing", async () => {
    const before = await seed();
    expect(extrasFiles(before)).toEqual(SEEDED_EXTRAS);

    const growth = await readJson<GrowthFile>("data/growth/100001.json");
    expect(Object.values(growth.stars).reduce((a, b) => a + b, 0)).toBe(42);
    expect(growth.forks).toEqual({ "2025-05-02": 1, "2025-11-19": 2, "2026-07-08": 1, "2026-10-21": 1 });
    // Newest week (Sunday 2026-10-25) and oldest (Sunday 2026-01-25); zero days are omitted.
    expect(growth.stars["2026-10-25"]).toBe(1);
    expect(growth.stars["2026-10-27"]).toBe(2);
    expect(growth.stars["2026-10-26"]).toBeUndefined();
    expect(growth.stars["2026-01-28"]).toBe(6);
    expect(await readJson<GrowthFile>("data/growth/100002.json")).toEqual({
      schemaVersion: 1,
      repositoryId: 100002,
      stars: {},
      forks: {},
    });

    const referrers = await readJson<ReferrerMonthFile>("data/referrers/100001/2026-10.json");
    expect(Object.keys(referrers.snapshots)).toEqual(["2026-10-27"]);
    expect(referrers.snapshots["2026-10-27"]!.referrers.map((r) => r.referrer)).toEqual([
      "github.com",
      "Google",
      "news.ycombinator.com",
      "reddit.com",
    ]);
    expect(referrers.snapshots["2026-10-27"]!.paths.map((p) => p.count)).toEqual([140, 18, 18]);

    // Draft 9000004 dropped; metadata, signatures and checksum lists not counted.
    expect(await readJson<ReleasesFile>("data/releases/100001.json")).toEqual({
      schemaVersion: 1,
      repositoryId: 100001,
      releases: {
        "9000001": { tag: "v1.0.0", name: "", publishedDate: "2025-04-01" },
        "9000002": { tag: "v2.0.0", name: "Sample CLI 2.0", publishedDate: "2026-08-03" },
        "9000003": { tag: "v2.1.0-beta.1", name: "v2.1.0 beta 1", publishedDate: "2026-10-20" },
      },
      snapshots: { "2026-10-27": { "9000001": 0, "9000002": 150, "9000003": 15 } },
    });

    expect(before["repos/100001.md"]).toContain("## Release downloads (as of 2026-10-27)");
    expect(before["repos/100001.md"]).toContain("## Stars and forks");
    // 100002's growth file is empty: the chart is the placeholder, but it exists.
    for (const id of ["100001", "100002", "100003"]) expect(before[`assets/repos/${id}/stars.svg`]).toBeDefined();

    const readme = before["README.md"]!;
    expect(readme).toContain("#### Top referrers (last 14 days as of 2026-10-27, UTC)");
    expect(readme).toContain("| github.com | 192 |");
    expect(readme).toContain("| Google | 36 |");

    // The private repository is never requested nor written.
    for (const text of Object.values(before)) {
      expect(text).not.toContain("secret-notes");
      expect(text).not.toContain("100007");
    }

    const again = await run({ now: DAY1 + 5 * 3_600_000 });
    expect(again.result).toEqual({ exitCode: 0, outcome: "ok", commit: false, dataThroughDate: "2026-10-25" });
    expect(await snapshot()).toEqual(before);
  });

  it("pages through star history, requests extras only for selected repos, after traffic", async () => {
    const r = await run();
    expect(r.requested).toContain("/repositories/100001/stargazers/history");
    expect(r.requested.some((p) => p.endsWith("/stargazers"))).toBe(false);

    const extraRequests = r.requested.filter((p) => EXTRA_PATH.test(p) && p.startsWith("/repos/"));
    expect([...new Set(extraRequests.map((p) => p.split("/")[3]))]).toEqual(["sample-cli", "sample-web", "Sample-Docs"]);
    expect(r.requested.some((p) => p.includes("secret-notes"))).toBe(false);

    const lastTraffic = Math.max(...r.requested.map((p, i) => (/\/traffic\/(views|clones)$/.test(p) ? i : -1)));
    const firstExtra = r.requested.findIndex((p) => EXTRA_PATH.test(p));
    expect(firstExtra).toBeGreaterThan(lastTraffic);

    expect(r.summary).toContain(
      "- Extras: stars/forks 3 ok, referrers 3 ok, releases 1 with assets; 0 forbidden, 0 failed",
    );
  });

  it("refetches star history and forks even when the stored totals match the repository listing", async () => {
    await seed();
    const r = await run();
    expect(r.requested).toContain(repoPath("sample-cli", HISTORY));
    expect(r.requested).toContain(repoPath("sample-cli", "forks"));
  });

  it("picks up an unstar plus a new star that leave the total unchanged", async () => {
    await seed();
    const before = await readJson<GrowthFile>("data/growth/100001.json");
    const weeks = JSON.parse(fixtureText("star-history-page-1")) as { week: number; total: number; days: number[] }[];
    // The Sunday star of the newest week moved to Monday 2026-10-26.
    weeks[0]!.days = [0, 1, 2, 0, 0, 0, 1];
    await run({
      routes: {
        [repoPath("sample-cli", HISTORY)]: () =>
          json(JSON.stringify(weeks), 200, { link: `<${HISTORY_PAGE2}>; rel="next"` }),
      },
    });
    const after = await readJson<GrowthFile>("data/growth/100001.json");
    expect(Object.values(after.stars).reduce((a, b) => a + b, 0)).toBe(42);
    expect(after.stars["2026-10-26"]).toBe(1);
    expect(after.stars).not.toEqual(before.stars);
  });

  it("a next-day run adds a referrer and a release snapshot and keeps the old ones", async () => {
    const before = await seed();
    const r = await run({ now: DAY2 });
    expect(r.result).toMatchObject({ exitCode: 0, commit: true });
    expect(changedPaths(before, await snapshot())).toEqual([
      "README.md",
      "data/referrers/100001/2026-10.json",
      "data/referrers/100002/2026-10.json",
      "data/referrers/100003/2026-10.json",
      "data/releases/100001.json",
      "repos/100001.md",
      "repos/100002.md",
      "repos/100003.md",
    ]);
    const referrers = await readJson<ReferrerMonthFile>("data/referrers/100002/2026-10.json");
    expect(Object.keys(referrers.snapshots)).toEqual(["2026-10-27", "2026-10-28"]);
    const releases = await readJson<ReleasesFile>("data/releases/100001.json");
    expect(Object.keys(releases.snapshots)).toEqual(["2026-10-27", "2026-10-28"]);
  });

  it("keeps snapshotting a tracked repository after its last counted asset disappears", async () => {
    await seed();
    await run({ now: DAY2, routes: { [repoPath("sample-cli", "releases")]: () => json([]) } });
    const releases = await readJson<ReleasesFile>("data/releases/100001.json");
    expect(releases.snapshots["2026-10-28"]).toEqual({});
    expect(releases.snapshots["2026-10-27"]).toEqual({ "9000001": 0, "9000002": 150, "9000003": 15 });
  });

  it("a repository without counted release assets gets no releases file", async () => {
    const onlyMetadata = JSON.stringify([
      { id: 1, tag_name: "v1", name: "v1", draft: false, published_at: "2026-10-01T00:00:00Z", assets: [{ name: "latest.yml", download_count: 9 }] },
    ]);
    await run({ routes: { [repoPath("sample-cli", "releases")]: () => json(onlyMetadata) } });
    expect(extrasFiles(await snapshot()).filter((p) => p.startsWith("data/releases/"))).toEqual([]);
  });
});

describe("extras failures", () => {
  it("403 on an extra -> warning, exit 0, previous file kept, traffic status untouched", async () => {
    const before = await seed();
    const path = repoPath("sample-web", "traffic/popular/referrers");
    const r = await run({ now: DAY2, routes: { [path]: status(403, {}, "Resource not accessible") } });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.sleeps).toEqual([]);
    const after = await snapshot();
    expect(after["data/referrers/100002/2026-10.json"]).toBe(before["data/referrers/100002/2026-10.json"]);
    expect(after["data/status.json"]).toBe(before["data/status.json"]);
    expect(r.lines).toContain("octo-sample/sample-web: referrers forbidden");
    expect(r.summary).toContain("referrers 2 ok, releases 1 with assets; 1 forbidden, 0 failed");
  });

  it("404 on an extra is a warning too", async () => {
    const r = await run({ routes: { [repoPath("Sample-Docs", "releases")]: status(404) } });
    expect(r.result.exitCode).toBe(0);
    expect(r.lines).toContain("octo-sample/Sample-Docs: releases forbidden (not_found)");
  });

  it.each<[string, Handler, number[]]>([
    ["500 after retries", status(500), [500, 1000]],
    ["a malformed body", () => json({ releases: [] }), []],
  ])("%s on an extra -> partial exit 2, previous file kept, status untouched", async (_label, handler, sleeps) => {
    const before = await seed();
    const r = await run({ now: DAY2, routes: { [repoPath("sample-cli", "releases")]: handler } });
    expect(r.result).toEqual({ exitCode: 2, outcome: "partial", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.sleeps).toEqual(sleeps);
    const after = await snapshot();
    expect(after["data/releases/100001.json"]).toBe(before["data/releases/100001.json"]);
    expect(after["data/status.json"]).toBe(before["data/status.json"]);
    expect(r.summary).toContain("3 selected, 3 succeeded, 0 forbidden, 0 transient");
    expect(r.summary).toContain("releases 0 with assets; 0 forbidden, 1 failed");
  });

  it("403 on star history -> warning, exit 0, previous growth file kept", async () => {
    const before = await seed();
    const r = await run({
      now: DAY2,
      routes: { [repoPath("sample-cli", HISTORY)]: status(403, {}, "Resource not accessible by personal access token") },
    });
    expect(r.result).toMatchObject({ exitCode: 0, outcome: "ok" });
    expect(r.sleeps).toEqual([]);
    expect((await snapshot())["data/growth/100001.json"]).toBe(before["data/growth/100001.json"]);
    expect(r.lines).toContain("octo-sample/sample-cli: stars/forks forbidden");
    expect(r.summary).toContain("stars/forks 2 ok");
    expect(r.summary).toContain("1 forbidden, 0 failed");
  });

  it("401 on star history -> fatal, nothing written", async () => {
    const before = await snapshot();
    const r = await run({ routes: { [repoPath("sample-cli", HISTORY)]: status(401, {}, "Bad credentials") } });
    expect(r.result).toEqual({ exitCode: 1, outcome: "fatal", commit: false });
    expect(r.summary).toContain("- Reason: auth");
    expect(r.lines).toContain("octo-sample/sample-cli: stars/forks auth");
    expect(await snapshot()).toEqual(before);
  });

  it.each<[string, Handler, number[]]>([
    ["500 after retries", status(500, {}, "BODY_TEXT server error"), [500, 1000]],
    ["422 (page past the limit)", status(422, {}, "BODY_TEXT pagination is limited"), []],
  ])("%s on star history -> partial exit 2, previous growth file kept, body not logged", async (_label, handler, sleeps) => {
    const before = await seed();
    const r = await run({ now: DAY2, routes: { [repoPath("sample-cli", HISTORY)]: handler } });
    expect(r.result).toMatchObject({ exitCode: 2, outcome: "partial" });
    expect(r.sleeps).toEqual(sleeps);
    expect((await snapshot())["data/growth/100001.json"]).toBe(before["data/growth/100001.json"]);
    expect(r.summary).toContain("stars/forks 2 ok");
    expect(r.summary).toContain("0 forbidden, 1 failed");
    expect(r.lines.join("\n")).not.toContain("BODY_TEXT");
  });

  it("rate limit given up during extras -> stop all requests, keep what was gathered, exit 2", async () => {
    const reset = String(Math.floor(DAY1 / 1000) + 600);
    const limited = repoPath("sample-web", "traffic/popular/referrers");
    const r = await run({
      routes: {
        [limited]: status(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset }, "API rate limit exceeded"),
      },
    });
    expect(r.result).toEqual({ exitCode: 2, outcome: "partial", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.sleeps).toEqual([]);
    expect(r.requested.at(-1)).toBe(limited);
    expect(extrasFiles(await snapshot())).toEqual([
      "data/growth/100001.json",
      "data/growth/100002.json",
      "data/referrers/100001/2026-10.json",
      "data/releases/100001.json",
    ]);
    expect((await readJson<StatusFile>("data/status.json")).repositories["100002"]?.lastError).toBeNull();
    expect(r.summary).toContain("1 failed; stopped early (rate limit)");
  });

  it("traffic already rate limited -> no extra requests at all", async () => {
    const reset = String(Math.floor(DAY1 / 1000) + 600);
    const r = await run({
      routes: {
        [repoPath("sample-web", "traffic/views")]: status(
          403,
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
          "API rate limit exceeded",
        ),
      },
    });
    expect(r.result).toMatchObject({ exitCode: 2, outcome: "partial" });
    expect(r.requested.some((p) => EXTRA_PATH.test(p))).toBe(false);
    expect(extrasFiles(await snapshot())).toEqual([]);
    expect(r.summary).toContain("- Extras: skipped (rate limit reached during traffic collection)");
  });
});
