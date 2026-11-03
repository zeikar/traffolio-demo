import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCollect } from "../src/run-collect.js";
import type { CollectResult } from "../src/run-collect.js";
import type { IndexFile, MonthFile, StatusFile } from "../src/types.js";

// Failure handling, exit codes, 0-vs-missing and idempotence of runCollect (README › Security, Data).

// ---------------------------------------------------------------------------
// Fixtures and canned responses
// ---------------------------------------------------------------------------

function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/api/${name}.json`, import.meta.url), "utf8");
}

interface Point {
  timestamp: string;
  count: number;
  uniques: number;
}
interface RepoListItem {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
}

const NOW = Date.parse("2026-10-27T03:37:12Z");
const RUN_DATE = "2026-10-27";
const SELF_PATH = "/repos/octo-sample/traffolio";
const PAGE2_URL = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2";
const TRAFFIC_PATH = /^\/repos\/octo-sample\/[^/]+\/traffic\/(views|clones)$/;
/** Selected with the default config, in discovery order. */
const SELECTED_IDS = ["100001", "100002", "100003"];

const DEFAULT_CONFIG = `repositories:
  include: ["*"]
  exclude: ["test-*", "playground-*"]
  include_private: false
  include_forks: false
  include_archived: false
  include_self: false
`;
const README = `# Hello

My own intro text.

<!-- TRAFFOLIO:START -->
placeholder
<!-- TRAFFOLIO:END -->

My footer.
`;
const NO_DATA_HEADING = "### Traffic — No traffic data stored yet (UTC)";

const trafficPath = (name: string, kind: "views" | "clones") => `/repos/octo-sample/${name}/traffic/${kind}`;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

/** A traffic response built from the fixture, with its points optionally transformed. */
function traffic(kind: "views" | "clones", transform: (points: Point[]) => Point[] = (p) => p): Response {
  const body = JSON.parse(fixtureText(`traffic-${kind}`)) as Record<string, unknown>;
  body[kind] = transform(body[kind] as Point[]);
  return json(body);
}

// ---------------------------------------------------------------------------
// Stub fetch from a route table
// ---------------------------------------------------------------------------

/** `nth` is the 1-based count of requests to this pathname so far, for "fail once, then succeed" routes. */
type Handler = (url: URL, nth: number) => Response;
type Routes = Record<string, Handler>;

const status =
  (code: number, headers: Record<string, string> = {}, message = "error"): Handler =>
  () =>
    json({ message }, code, headers);

/** `/user/repos` handler serving both fixture pages, with each page's items transformed. */
function repoListing(transform: (repos: RepoListItem[]) => RepoListItem[] = (r) => r): Handler {
  return (url) => {
    const page = url.searchParams.get("page") === "2" ? 2 : 1;
    const repos = transform(JSON.parse(fixtureText(`user-repos-page-${page}`)) as RepoListItem[]);
    return json(repos, 200, page === 1 ? { link: `<${PAGE2_URL}>; rel="next"` } : {});
  };
}

const DEFAULT_ROUTES: Routes = {
  [SELF_PATH]: () => json(fixtureText("self-repo-private")),
  "/user": () => json(fixtureText("user")),
  "/user/repos": repoListing(),
};

/** Same handler for both traffic endpoints of every selected repo. */
function allSelectedTraffic(handler: Handler): Routes {
  const routes: Routes = {};
  for (const name of ["sample-cli", "sample-web", "Sample-Docs"]) {
    routes[trafficPath(name, "views")] = handler;
    routes[trafficPath(name, "clones")] = handler;
  }
  return routes;
}

/** Exact-path overrides win over the defaults; any other traffic path serves the fixture; the rest 404. */
function stubFetch(overrides: Routes) {
  const counts = new Map<string, number>();
  return vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    const nth = (counts.get(url.pathname) ?? 0) + 1;
    counts.set(url.pathname, nth);
    const handler = overrides[url.pathname] ?? DEFAULT_ROUTES[url.pathname];
    if (handler) return handler(url, nth);
    const match = TRAFFIC_PATH.exec(url.pathname);
    if (match) return traffic(match[1] as "views" | "clones");
    return json({ message: "Not Found" }, 404);
  });
}

// ---------------------------------------------------------------------------
// Temp dirs, run harness and file-tree snapshots
// ---------------------------------------------------------------------------

let root: string;
let actionsDir: string;
let runCount = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "traffolio-failures-"));
  // GITHUB_OUTPUT / GITHUB_STEP_SUMMARY live outside rootDir so they never count as writes.
  actionsDir = await mkdtemp(join(tmpdir(), "traffolio-failures-actions-"));
  await writeFile(join(root, "traffolio.config.yml"), DEFAULT_CONFIG);
  await writeFile(join(root, "README.md"), README);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(actionsDir, { recursive: true, force: true });
});

interface RunOptions {
  routes?: Routes;
  env?: Record<string, string | undefined>;
}

interface Run {
  result: CollectResult;
  /** Pathnames requested, in order. */
  requested: string[];
  sleeps: number[];
  lines: string[];
  /** This run's `$GITHUB_OUTPUT` contents. */
  output: string;
  /** This run's `$GITHUB_STEP_SUMMARY` contents. */
  summary: string;
}

async function run(options: RunOptions = {}): Promise<Run> {
  const fetch = stubFetch(options.routes ?? {});
  const sleeps: number[] = [];
  const lines: string[] = [];
  runCount++;
  const outputFile = join(actionsDir, `output-${runCount}`);
  const summaryFile = join(actionsDir, `summary-${runCount}`);

  const result = await runCollect({
    env: {
      GITHUB_TOKEN: "ghs_actions_secret",
      GITHUB_REPOSITORY: "octo-sample/traffolio",
      TRAFFIC_TOKEN: "github_pat_traffic_secret",
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      ...options.env,
    },
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    rootDir: root,
    now: () => NOW,
    log: (line) => lines.push(line),
  });

  return {
    result,
    requested: fetch.mock.calls.map(([input]) => new URL(String(input)).pathname),
    sleeps,
    lines,
    output: await readFile(outputFile, "utf8"),
    summary: await readFile(summaryFile, "utf8"),
  };
}

type Tree = Record<string, string>;

/** Every file under rootDir: relative path -> contents. */
async function snapshot(): Promise<Tree> {
  const tree: Tree = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    tree[relative(root, abs)] = await readFile(abs, "utf8");
  }
  return tree;
}

/** Paths added, removed or modified between two snapshots, sorted. */
function changedPaths(before: Tree, after: Tree): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((p) => before[p] !== after[p]).sort();
}

async function readText(relPath: string): Promise<string> {
  return readFile(join(root, relPath), "utf8");
}
async function readJson<T>(relPath: string): Promise<T> {
  return JSON.parse(await readText(relPath)) as T;
}
async function trafficDirs(): Promise<string[]> {
  try {
    return (await readdir(join(root, "data/traffic"))).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** Cells of the README repo-table row for `fullName` (repo, trend, visibility, 4 traffic cells, stars, forks, status). */
function readmeRow(readme: string, fullName: string): string[] {
  const line = readme.split("\n").find((l) => l.startsWith(`| [${fullName}](`));
  if (line === undefined) throw new Error(`README has no row for ${fullName}`);
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}
const trafficCells = (row: string[]) => row.slice(3, 7);

const countMatches = (text: string, re: RegExp) => (text.match(re) ?? []).length;

function expectFatal(r: Run, reason: string) {
  expect(r.result).toEqual({ exitCode: 1, outcome: "fatal", commit: false });
  expect(r.output).toBe("commit=false\noutcome=fatal\ndata_through=\npages=false\n");
  expect(r.summary).toContain(`- Reason: ${reason}`);
}

/** A seeded tree: one full successful collection of the fixtures. */
async function seed(): Promise<Tree> {
  const r = await run();
  expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
  return snapshot();
}

// ---------------------------------------------------------------------------
// §6 table rows that end the run with nothing written
// ---------------------------------------------------------------------------

describe("fatal: nothing written, commit=false, exit 1", () => {
  it("TRAFFIC_TOKEN unset", async () => {
    const before = await snapshot();
    const r = await run({ env: { TRAFFIC_TOKEN: undefined } });
    expectFatal(r, "missing_token");
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
  });

  it("GET /user returns 401", async () => {
    const before = await snapshot();
    const r = await run({ routes: { "/user": status(401, {}, "Bad credentials") } });
    expectFatal(r, "auth");
    expect(r.requested).toEqual([SELF_PATH, "/user"]);
    expect(r.sleeps).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  // Auth is never partial: even after earlier repos succeeded, a 401 on any traffic call writes nothing.
  it.each(["sample-cli", "Sample-Docs"])("a traffic endpoint of %s returns 401", async (name) => {
    const before = await snapshot();
    const r = await run({ routes: { [trafficPath(name, "views")]: status(401, {}, "Bad credentials") } });
    expectFatal(r, "auth");
    expect(r.requested).toContain(trafficPath(name, "views"));
    if (name === "Sample-Docs") {
      expect(r.requested).toContain(trafficPath("sample-cli", "clones"));
      expect(r.requested).toContain(trafficPath("sample-web", "clones"));
    }
    expect(await snapshot()).toEqual(before);
  });

  it("the Traffolio repository is public", async () => {
    const before = await snapshot();
    const r = await run({ routes: { [SELF_PATH]: () => json(fixtureText("self-repo-public")) } });
    expectFatal(r, "visibility_public");
    expect(r.lines.join("\n")).toContain(
      "Set public_mode: true in traffolio.config.yml only if you intend to publish these numbers.",
    );
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
  });

  it.each<[string, Handler, number[]]>([
    ["500 after retries", status(500), [500, 1000]],
    ["a body missing `private`", () => json(fixtureText("self-repo-malformed")), []],
    ["a non-JSON body", () => new Response("<html>oops</html>", { status: 200 }), []],
  ])("the self lookup fails with %s", async (_label, handler, sleeps) => {
    const before = await snapshot();
    const r = await run({ routes: { [SELF_PATH]: handler } });
    expectFatal(r, "visibility_undeterminable");
    expect(r.requested.every((p) => p === SELF_PATH)).toBe(true);
    expect(r.sleeps).toEqual(sleeps);
    expect(await snapshot()).toEqual(before);
  });

  it("all selected repos return 500: pre-existing month files stay byte-identical", async () => {
    const before = await seed();
    const r = await run({ routes: allSelectedTraffic(status(500)) });
    expectFatal(r, "all_failed");
    expect(r.sleeps).toEqual([500, 1000, 500, 1000, 500, 1000]);
    expect(r.summary).toContain("0 succeeded, 0 forbidden, 3 transient");
    expect(await snapshot()).toEqual(before);
    expect(Object.keys(before).filter((p) => p.startsWith("data/traffic/"))).toHaveLength(3);
  });

  it("all selected repos return 403", async () => {
    const before = await snapshot();
    const r = await run({ routes: allSelectedTraffic(status(403, {}, "Resource not accessible")) });
    expectFatal(r, "all_failed");
    expect(r.summary).toContain("0 succeeded, 3 forbidden, 0 transient");
    expect(await snapshot()).toEqual(before);
  });
});

describe("template repository: skipped, exit 0", () => {
  it("self is_template -> commit=false and nothing written", async () => {
    const before = await snapshot();
    const r = await run({ routes: { [SELF_PATH]: () => json(fixtureText("self-repo-template")) } });
    expect(r.result).toEqual({ exitCode: 0, outcome: "skipped", commit: false });
    expect(r.output).toBe("commit=false\noutcome=skipped\ndata_through=\npages=false\n");
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// §6 table rows where some repos fail
// ---------------------------------------------------------------------------

describe("partial failures", () => {
  it("one repo 500 after retries, others ok -> exit 2, only successes written, status records transient", async () => {
    const before = await snapshot();
    const r = await run({ routes: { [trafficPath("sample-web", "views")]: status(500) } });
    expect(r.result).toEqual({ exitCode: 2, outcome: "partial", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.output).toBe("commit=true\noutcome=partial\ndata_through=2026-10-25\npages=false\n");
    expect(r.sleeps).toEqual([500, 1000]);

    expect(changedPaths(before, await snapshot())).toEqual([
      "README.md",
      "assets/clones.svg",
      "assets/repos/100001/clones.svg",
      "assets/repos/100001/views.svg",
      "assets/repos/100002/clones.svg",
      "assets/repos/100002/views.svg",
      "assets/repos/100003/clones.svg",
      "assets/repos/100003/views.svg",
      "assets/sparklines/100001.svg",
      "assets/sparklines/100002.svg",
      "assets/sparklines/100003.svg",
      "assets/views.svg",
      "data/index.json",
      "data/status.json",
      "data/traffic/100001/2026-10.json",
      "data/traffic/100003/2026-10.json",
      "repos/100001.md",
      "repos/100002.md",
      "repos/100003.md",
    ]);
    const st = await readJson<StatusFile>("data/status.json");
    expect(st.repositories["100002"]).toEqual({ lastSuccessDate: null, lastError: { kind: "transient", date: RUN_DATE } });
    expect(st.repositories["100001"]).toEqual({ lastSuccessDate: "2026-10-25", lastError: null });
    expect(r.summary).toContain("2 succeeded, 0 forbidden, 1 transient");
  });

  it("one repo 403 -> exit 0, no days for it, status records forbidden, README shows —, summary warns", async () => {
    const r = await run({ routes: { [trafficPath("sample-web", "views")]: status(403, {}, "Resource not accessible") } });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.sleeps).toEqual([]);

    expect(await trafficDirs()).toEqual(["100001", "100003"]);
    const st = await readJson<StatusFile>("data/status.json");
    expect(st.repositories["100002"]).toEqual({ lastSuccessDate: null, lastError: { kind: "forbidden", date: RUN_DATE } });

    const readme = await readText("README.md");
    const row = readmeRow(readme, "octo-sample/sample-web");
    expect(trafficCells(row)).toEqual(["—", "—", "—", "—"]);
    expect(row.at(-1)).toBe(`forbidden since ${RUN_DATE}`);
    expect(readme).toContain("1 repository could not be collected (see data/status.json)");

    expect(r.summary).toContain("3 selected, 2 succeeded, 1 forbidden, 0 transient");
    expect(r.summary).toContain("- `octo-sample/sample-web`: forbidden");
  });

  it("429 with retry-after: 1 then 200 -> exit 0 after one sleep(1000)", async () => {
    const r = await run({
      routes: {
        [trafficPath("sample-cli", "views")]: (url, nth) =>
          nth === 1 ? status(429, { "retry-after": "1" })(url, nth) : traffic("views"),
      },
    });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.sleeps).toEqual([1000]);
    expect(r.requested.filter((p) => p === trafficPath("sample-cli", "views"))).toHaveLength(2);
    expect(await trafficDirs()).toEqual(SELECTED_IDS);
  });

  it("primary rate limit exhausted with reset 10 min ahead -> stop, rest transient, first repo written, exit 2", async () => {
    const reset = String(Math.floor(NOW / 1000) + 600);
    const r = await run({
      routes: {
        [trafficPath("sample-web", "views")]: status(
          403,
          { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset },
          "API rate limit exceeded",
        ),
      },
    });
    expect(r.result).toEqual({ exitCode: 2, outcome: "partial", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.sleeps).toEqual([]);

    // The limited call is the last traffic request of the run.
    const trafficRequests = r.requested.filter((p) => TRAFFIC_PATH.test(p));
    expect(trafficRequests).toEqual([
      trafficPath("sample-cli", "views"),
      trafficPath("sample-cli", "clones"),
      trafficPath("sample-web", "views"),
    ]);

    expect(await trafficDirs()).toEqual(["100001"]);
    const st = await readJson<StatusFile>("data/status.json");
    for (const id of ["100002", "100003"]) {
      expect(st.repositories[id]?.lastError).toEqual({ kind: "rate_limited", date: RUN_DATE });
    }
    expect(r.summary).toContain("1 succeeded, 0 forbidden, 2 transient");
  });
});

// ---------------------------------------------------------------------------
// §6 upsert and idempotence
// ---------------------------------------------------------------------------

describe("idempotence and upsert", () => {
  it("a second run with identical responses -> commit=false, tree identical", async () => {
    const before = await seed();
    const r = await run();
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: false, dataThroughDate: "2026-10-25" });
    expect(r.output).toBe("commit=false\noutcome=ok\ndata_through=2026-10-25\npages=false\n");
    expect(await snapshot()).toEqual(before);
  });

  it("a changed count on 2026-10-25 overwrites only that key", async () => {
    const before = await seed();
    const r = await run({
      routes: {
        [trafficPath("sample-cli", "views")]: () =>
          traffic("views", (points) =>
            points.map((p) => (p.timestamp.startsWith("2026-10-25") ? { ...p, count: 60 } : p)),
          ),
      },
    });
    expect(r.result.commit).toBe(true);

    const monthPath = "data/traffic/100001/2026-10.json";
    expect(changedPaths(before, await snapshot())).toEqual([
      "README.md",
      "assets/repos/100001/views.svg",
      "assets/sparklines/100001.svg",
      "assets/views.svg",
      monthPath,
      "repos/100001.md",
    ]);
    const prev = JSON.parse(before[monthPath]!) as MonthFile;
    const next = await readJson<MonthFile>(monthPath);
    expect(prev.days["2026-10-25"]?.views).toBe(6);
    expect(next.days).toEqual({ ...prev.days, "2026-10-25": { ...prev.days["2026-10-25"], views: 60 } });
  });

  it("a renamed repo (same id) keeps its data directory and gets its name updated", async () => {
    const before = await seed();
    const r = await run({
      routes: {
        "/user/repos": repoListing((repos) =>
          repos.map((repo) =>
            repo.id === 100001 ? { ...repo, name: "cli-tool", full_name: "octo-sample/cli-tool" } : repo,
          ),
        ),
      },
    });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.requested).toContain(trafficPath("cli-tool", "views"));

    expect(changedPaths(before, await snapshot())).toEqual(["README.md", "data/index.json", "repos/100001.md"]);
    expect(await trafficDirs()).toEqual(SELECTED_IDS);
    const index = await readJson<IndexFile>("data/index.json");
    expect(index.repositories["100001"]).toMatchObject({
      name: "cli-tool",
      fullName: "octo-sample/cli-tool",
      tracking: "tracked",
    });
    const readme = await readText("README.md");
    expect(readme).toContain("[octo-sample/cli-tool](");
    expect(readme).not.toContain("[octo-sample/sample-cli](");
  });

  it("include_private: false keeps the private repo out of every output", async () => {
    const r = await run();
    expect(r.result.exitCode).toBe(0);
    expect(r.requested.some((p) => p.startsWith("/repos/octo-sample/secret-notes"))).toBe(false);

    expect(await trafficDirs()).toEqual(SELECTED_IDS);
    for (const path of ["data/index.json", "data/status.json", "README.md", "assets/views.svg"]) {
      const text = await readText(path);
      expect(text).not.toContain("secret-notes");
      expect(text).not.toContain("100007");
    }
    expect((await readdir(join(root, "assets/sparklines"))).sort()).toEqual(SELECTED_IDS.map((id) => `${id}.svg`));
    expect((await readdir(join(root, "repos"))).sort()).toEqual(SELECTED_IDS.map((id) => `${id}.md`));
    for (const id of SELECTED_IDS) expect(await readText(`repos/${id}.md`)).not.toContain("secret-notes");
  });
});

// ---------------------------------------------------------------------------
// §6 zero vs missing
// ---------------------------------------------------------------------------

describe("zero vs missing", () => {
  it("an omitted in-window date is stored as 0; a failed repo gets no keys and renders as —", async () => {
    const omit = (kind: "views" | "clones"): Handler => () =>
      traffic(kind, (points) => points.filter((p) => !p.timestamp.startsWith("2026-10-20")));
    const r = await run({
      routes: {
        [trafficPath("sample-cli", "views")]: omit("views"),
        [trafficPath("sample-cli", "clones")]: omit("clones"),
        [trafficPath("Sample-Docs", "views")]: omit("views"),
        [trafficPath("Sample-Docs", "clones")]: omit("clones"),
        [trafficPath("sample-web", "views")]: status(500),
      },
    });
    expect(r.result).toEqual({ exitCode: 2, outcome: "partial", commit: true, dataThroughDate: "2026-10-25" });

    for (const id of ["100001", "100003"]) {
      const month = await readJson<MonthFile>(`data/traffic/${id}/2026-10.json`);
      expect(Object.keys(month.days)).toHaveLength(14);
      expect(month.days["2026-10-20"]).toEqual({ views: 0, uniqueViews: 0, clones: 0, uniqueCloners: 0 });
    }
    expect(await trafficDirs()).toEqual(["100001", "100003"]);

    const readme = await readText("README.md");
    const failedRow = readmeRow(readme, "octo-sample/sample-web");
    expect(trafficCells(failedRow)).toEqual(["—", "—", "—", "—"]);
    expect(failedRow.at(-1)).toBe(`transient since ${RUN_DATE}`);

    // The 14 window dates in the 30-day series have data from 2 of 3 tracked repos: one marker per chart and day.
    for (const chart of ["assets/views.svg", "assets/clones.svg"]) {
      expect(countMatches(await readText(chart), /<circle class="partial"/g)).toBe(14);
    }
  });
});

// ---------------------------------------------------------------------------
// Data-through date when windows end on different days per repository
// ---------------------------------------------------------------------------

describe("data-through date", () => {
  it("is the earliest window end, so the newest stored day is not a permanent partial", async () => {
    // As measured live: one repository's window ends a day later than the others.
    const shifted = (kind: "views" | "clones"): Handler => () =>
      traffic(kind, (points) =>
        points.map((p) => ({ ...p, timestamp: new Date(Date.parse(p.timestamp) + 86_400_000).toISOString() })),
      );
    const r = await run({
      routes: {
        [trafficPath("sample-web", "views")]: shifted("views"),
        [trafficPath("sample-web", "clones")]: shifted("clones"),
      },
    });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect((await readJson<MonthFile>("data/traffic/100002/2026-10.json")).days["2026-10-26"]).toBeDefined();

    const readme = await readText("README.md");
    expect(readme).toContain("Data through 2026-10-25 (UTC)");
    const viewsTotals = readme.split("\n").find((l) => l.startsWith("| Views |"));
    expect(viewsTotals?.split("|")[2]?.trim()).toMatch(/^\d+$/); // 7d total complete: no "*"

    // 2026-10-12 precedes sample-web's window: not tracked yet for it, so not partial.
    for (const chart of ["assets/views.svg", "assets/clones.svg"]) {
      expect(countMatches(await readText(chart), /<circle class="partial"/g)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Responses without a traffic window, and nothing selected
// ---------------------------------------------------------------------------

describe("no traffic window", () => {
  const emptyTraffic: Handler = (url) => {
    const kind = url.pathname.endsWith("/views") ? "views" : "clones";
    return json({ count: 0, uniques: 0, [kind]: [] });
  };

  it("empty arrays on a fresh tree -> exit 0, index/status/README/SVG written, no month files", async () => {
    const before = await snapshot();
    const r = await run({ routes: allSelectedTraffic(emptyTraffic) });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: null });
    expect(r.output).toBe("commit=true\noutcome=ok\ndata_through=\npages=false\n");

    expect(changedPaths(before, await snapshot())).toEqual([
      "README.md",
      "assets/clones.svg",
      "assets/repos/100001/clones.svg",
      "assets/repos/100001/views.svg",
      "assets/repos/100002/clones.svg",
      "assets/repos/100002/views.svg",
      "assets/repos/100003/clones.svg",
      "assets/repos/100003/views.svg",
      "assets/sparklines/100001.svg",
      "assets/sparklines/100002.svg",
      "assets/sparklines/100003.svg",
      "assets/views.svg",
      "data/index.json",
      "data/status.json",
      "repos/100001.md",
      "repos/100002.md",
      "repos/100003.md",
    ]);
    const st = await readJson<StatusFile>("data/status.json");
    expect(st.dataThroughDate).toBeNull();
    expect(Object.keys(st.repositories)).toEqual(SELECTED_IDS);
    for (const repo of Object.values(st.repositories)) {
      expect(repo).toEqual({ lastSuccessDate: null, lastError: null });
    }
    expect(await readText("README.md")).toContain(NO_DATA_HEADING);
  });

  it("empty arrays against a seeded tree -> month files and dataThroughDate unchanged", async () => {
    const before = await seed();
    const r = await run({ routes: allSelectedTraffic(emptyTraffic) });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: false, dataThroughDate: "2026-10-25" });
    expect(await snapshot()).toEqual(before);
    expect((await readJson<StatusFile>("data/status.json")).dataThroughDate).toBe("2026-10-25");
  });

  it("include: [] -> exit 0, no traffic requests, no-data README", async () => {
    await writeFile(join(root, "traffolio.config.yml"), "repositories:\n  include: []\n");
    const r = await run();
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: null });
    expect(r.requested.some((p) => TRAFFIC_PATH.test(p))).toBe(false);
    expect(await trafficDirs()).toEqual([]);
    expect(await readText("README.md")).toContain(NO_DATA_HEADING);
    expect(r.summary).toContain("8 discovered, 0 selected, 0 succeeded");
  });
});
