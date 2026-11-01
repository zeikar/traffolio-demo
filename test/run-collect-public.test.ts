import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCollect } from "../src/run-collect.js";
import type { CollectResult } from "../src/run-collect.js";
import type { IndexFile, StatusFile } from "../src/types.js";

// public_mode: a public Traffolio repository publishing traffic of its selected public repositories.

function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/api/${name}.json`, import.meta.url), "utf8");
}

interface RepoListItem {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  stargazers_count: number;
}

const NOW = Date.parse("2026-10-27T03:37:12Z");
const SELF_PATH = "/repos/octo-sample/traffolio";
const PAGE2_URL = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2";
const TRAFFIC_PATH = /^\/repos\/octo-sample\/[^/]+\/traffic\/(views|clones)$/;
const SELECTED_IDS = ["100001", "100002", "100003"];

const PUBLIC_CONFIG = `public_mode: true
repositories:
  include: ["*"]
  exclude: ["test-*"]
`;
const README = `# Demo

<!-- TRAFFOLIO:START -->
placeholder
<!-- TRAFFOLIO:END -->
`;

const json = (body: string, headers: Record<string, string> = {}) => new Response(body, { status: 200, headers });

/** The self repository is public here, in the listing too. */
const publicSelf = (repos: RepoListItem[]) => repos.map((r) => (r.id === 100008 ? { ...r, private: false } : r));

interface RunOptions {
  self?: string;
  transformRepos?: (repos: RepoListItem[]) => RepoListItem[];
}

interface Run {
  result: CollectResult;
  requested: string[];
  lines: string[];
  output: string;
  summary: string;
}

let root: string;
let actionsDir: string;
let runCount = 0;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "traffolio-public-"));
  actionsDir = await mkdtemp(join(tmpdir(), "traffolio-public-actions-"));
  await writeFile(join(root, "traffolio.config.yml"), PUBLIC_CONFIG);
  await writeFile(join(root, "README.md"), README);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(actionsDir, { recursive: true, force: true });
});

async function run(options: RunOptions = {}): Promise<Run> {
  const { self = "self-repo-public", transformRepos = publicSelf } = options;
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === SELF_PATH) return json(fixtureText(self));
    if (url.pathname === "/user") return json(fixtureText("user"));
    if (url.pathname === "/user/repos") {
      const page = url.searchParams.get("page") === "2" ? 2 : 1;
      const repos = transformRepos(JSON.parse(fixtureText(`user-repos-page-${page}`)) as RepoListItem[]);
      return json(JSON.stringify(repos), page === 1 ? { link: `<${PAGE2_URL}>; rel="next"` } : {});
    }
    const match = TRAFFIC_PATH.exec(url.pathname);
    if (match) return json(fixtureText(`traffic-${match[1]}`));
    return new Response('{"message":"Not Found"}', { status: 404 });
  });
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
    },
    fetch,
    sleep: async () => {},
    rootDir: root,
    now: () => NOW,
    log: (line) => lines.push(line),
  });
  return {
    result,
    requested: fetch.mock.calls.map(([input]) => new URL(String(input)).pathname),
    lines,
    output: await readFile(outputFile, "utf8"),
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

const readJson = async <T>(relPath: string) => JSON.parse(await readFile(join(root, relPath), "utf8")) as T;

/** Every text a run publishes: log lines, outputs, summary and all files in the repository. */
const published = async (r: Run) => [...r.lines, r.output, r.summary, ...Object.values(await snapshot())];

function expectFatal(r: Run, reason: string) {
  expect(r.result).toEqual({ exitCode: 1, outcome: "fatal", commit: false });
  expect(r.output).toBe("commit=false\noutcome=fatal\ndata_through=\n");
  expect(r.summary).toContain(`- Reason: ${reason}`);
}

async function seedIndex(index: IndexFile | string) {
  await mkdir(join(root, "data"), { recursive: true });
  await writeFile(join(root, "data/index.json"), typeof index === "string" ? index : JSON.stringify(index));
}

describe("public repository with public_mode: true", () => {
  it("collects the selected public repositories only; a same-day rerun commits nothing", async () => {
    const r = await run();
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect((await readdir(join(root, "data/traffic"))).sort()).toEqual(SELECTED_IDS);
    expect(Object.keys((await readJson<IndexFile>("data/index.json")).repositories)).toEqual(SELECTED_IDS);
    expect(r.requested.some((p) => p.startsWith("/repos/octo-sample/secret-notes"))).toBe(false);
    for (const text of await published(r)) {
      expect(text).not.toContain("secret-notes");
      expect(text).not.toContain("100007");
    }
    expect(r.lines).toContain("Discovered 8 owned repositories; selected 3.");

    const before = await snapshot();
    const again = await run();
    expect(again.result).toEqual({ exitCode: 0, outcome: "ok", commit: false, dataThroughDate: "2026-10-25" });
    expect(await snapshot()).toEqual(before);
  });

  it("include_private: true -> fatal config error before any collection, nothing written", async () => {
    await writeFile(join(root, "traffolio.config.yml"), `${PUBLIC_CONFIG}  include_private: true\n`);
    const before = await snapshot();
    const r = await run();
    expectFatal(r, "config");
    expect(r.lines.join("\n")).toContain("include_private cannot be used with public_mode");
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
  });

  it("stored data about a private repository -> fatal, nothing written", async () => {
    await seedIndex({
      schemaVersion: 1,
      repositories: {
        "100007": {
          name: "secret-notes",
          fullName: "octo-sample/secret-notes",
          private: true,
          fork: false,
          archived: false,
          stars: 0,
          forks: 0,
          tracking: "tracked",
        },
      },
    });
    const before = await snapshot();
    const r = await run();
    expectFatal(r, "public_private_data");
    expect(r.lines.join("\n")).toContain(
      "this public repository already contains data about private repositories; nothing was written",
    );
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
    for (const text of [...r.lines, r.output, r.summary]) expect(text).not.toContain("secret-notes");
  });

  it("a malformed data/index.json -> fatal, nothing written", async () => {
    await seedIndex("{ not json");
    const before = await snapshot();
    const r = await run();
    expectFatal(r, "unexpected");
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
  });

  it("a tracked repo that turned private keeps its previous entry, only marked missing", async () => {
    await run();
    const before = await snapshot();
    const prevIndex = await readJson<IndexFile>("data/index.json");
    const prevStatus = await readJson<StatusFile>("data/status.json");

    const r = await run({
      transformRepos: (repos) =>
        publicSelf(repos).map((repo) =>
          repo.id === 100002
            ? { ...repo, name: "hidden-web", full_name: "octo-sample/hidden-web", private: true, stargazers_count: 99 }
            : repo,
        ),
    });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.requested.some((p) => p.includes("hidden-web"))).toBe(false);

    const index = await readJson<IndexFile>("data/index.json");
    expect(index.repositories["100002"]).toEqual({ ...prevIndex.repositories["100002"], tracking: "missing" });
    expect((await readJson<StatusFile>("data/status.json")).repositories["100002"]).toEqual(
      prevStatus.repositories["100002"],
    );
    const after = await snapshot();
    expect(after["data/traffic/100002/2026-10.json"]).toBe(before["data/traffic/100002/2026-10.json"]);

    for (const text of await published(r)) expect(text).not.toContain("hidden-web");
    for (const line of r.lines) expect(line).not.toContain("sample-web");
    expect(r.summary).not.toContain("sample-web");
  });

  it("a template repository is still skipped", async () => {
    const before = await snapshot();
    const r = await run({ self: "self-repo-template" });
    expect(r.result).toEqual({ exitCode: 0, outcome: "skipped", commit: false });
    expect(r.requested).toEqual([SELF_PATH]);
    expect(await snapshot()).toEqual(before);
  });
});

describe("private repository with public_mode: true", () => {
  it("behaves like private mode and logs that public_mode has no effect", async () => {
    const r = await run({ self: "self-repo-private", transformRepos: (repos) => repos });
    expect(r.result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });
    expect(r.lines).toContain("public_mode has no effect in a private repository.");
    expect((await readdir(join(root, "data/traffic"))).sort()).toEqual(SELECTED_IDS);
  });

  it("allows include_private, as private mode does", async () => {
    await writeFile(join(root, "traffolio.config.yml"), `${PUBLIC_CONFIG}  include_private: true\n`);
    const r = await run({ self: "self-repo-private", transformRepos: (repos) => repos });
    expect(r.result.outcome).toBe("ok");
    expect((await readdir(join(root, "data/traffic"))).sort()).toEqual([...SELECTED_IDS, "100007"]);
  });
});
