import { readFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCollect } from "../src/run-collect.js";

function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/api/${name}.json`, import.meta.url), "utf8");
}

const GITHUB_TOKEN = "ghs_actions_secret";
const TRAFFIC_TOKEN = "github_pat_traffic_secret";
const PAGE2_URL = "https://api.github.com/user/repos?affiliation=owner&per_page=100&page=2";

const CONFIG = `repositories:
  include: ["*"]
  exclude: ["test-*"]
`;
const README = `# Hello

My own intro text.

<!-- TRAFFOLIO:START -->
placeholder
<!-- TRAFFOLIO:END -->

My footer.
`;

function route(url: URL): Response {
  const ok = (text: string, headers: Record<string, string> = {}) => new Response(text, { status: 200, headers });
  const path = url.pathname;
  if (path === "/repos/octo-sample/traffolio") return ok(fixtureText("self-repo-private"));
  if (path === "/user") return ok(fixtureText("user"));
  if (path === "/user/repos") {
    return url.searchParams.get("page") === "2"
      ? ok(fixtureText("user-repos-page-2"))
      : ok(fixtureText("user-repos-page-1"), { link: `<${PAGE2_URL}>; rel="next"` });
  }
  if (/^\/repos\/octo-sample\/[^/]+\/traffic\/views$/.test(path)) return ok(fixtureText("traffic-views"));
  if (/^\/repos\/octo-sample\/[^/]+\/traffic\/clones$/.test(path)) return ok(fixtureText("traffic-clones"));
  return new Response("{}", { status: 404 });
}

let root: string;
let actionsDir: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "traffolio-collect-"));
  actionsDir = await mkdtemp(join(tmpdir(), "traffolio-actions-"));
  await writeFile(join(root, "traffolio.config.yml"), CONFIG);
  await writeFile(join(root, "README.md"), README);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(actionsDir, { recursive: true, force: true });
});

describe("runCollect", () => {
  it("collects the selected repos, renders README/SVG and reports commit=true", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => route(new URL(String(input))));
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
      sleep: async () => {},
      rootDir: root,
      now: () => Date.parse("2026-10-27T03:37:12Z"),
      log: (line) => lines.push(line),
    });

    expect(result).toEqual({ exitCode: 0, outcome: "ok", commit: true, dataThroughDate: "2026-10-25" });

    // Only the three selected repos (sample-cli, sample-web, Sample-Docs) get month files;
    // test-scratch, forked-lib, old-archive, secret-notes and the self repo stay out of data/.
    expect((await readdir(join(root, "data/traffic"))).sort()).toEqual(["100001", "100002", "100003"]);
    for (const id of ["100001", "100002", "100003"]) {
      expect(await readdir(join(root, "data/traffic", id))).toEqual(["2026-10.json"]);
    }
    const index = await readFile(join(root, "data/index.json"), "utf8");
    for (const name of ["secret-notes", "forked-lib", "old-archive", "test-scratch", "traffolio"]) {
      expect(index).not.toContain(name);
    }

    const readme = await readFile(join(root, "README.md"), "utf8");
    expect(readme).toContain("My own intro text.");
    expect(readme).toContain("My footer.");
    expect(readme).toContain("### Traffic — Data through 2026-10-25 (UTC)");
    expect(readme).not.toContain("placeholder");
    expect((await stat(join(root, "assets/views.svg"))).isFile()).toBe(true);
    expect((await stat(join(root, "assets/clones.svg"))).isFile()).toBe(true);
    await expect(stat(join(root, "assets/traffic.svg"))).rejects.toThrow();
    expect((await readdir(join(root, "assets/sparklines"))).sort()).toEqual([
      "100001.svg",
      "100002.svg",
      "100003.svg",
    ]);
    expect((await readdir(join(root, "repos"))).sort()).toEqual(["100001.md", "100002.md", "100003.md"]);
    // The extras endpoints 404 in this test: no growth data, so no stars chart.
    expect((await readdir(join(root, "assets/repos/100001"))).sort()).toEqual(["clones.svg", "views.svg"]);
    expect(readme).toContain("](repos/100001.md)");
    for (const id of ["100001", "100002", "100003"]) {
      expect(readme).toContain(`![trend](assets/sparklines/${id}.svg)`);
      expect(await readFile(join(root, `assets/sparklines/${id}.svg`), "utf8")).toContain('<path class="views"');
    }

    expect(await readFile(outputFile, "utf8")).toBe("commit=true\noutcome=ok\ndata_through=2026-10-25\npages=false\n");

    // The run timestamp appears in the summary only, never in committed files.
    const summary = await readFile(summaryFile, "utf8");
    expect(summary).toContain("2026-10-27T03:37:12.000Z");
    const status = await readFile(join(root, "data/status.json"), "utf8");
    for (const text of [readme, status, index]) expect(text).not.toContain("03:37");

    // The self lookup uses GITHUB_TOKEN; everything else uses TRAFFIC_TOKEN.
    const auth = (path: string) => {
      const call = fetch.mock.calls.find(([input]) => new URL(String(input)).pathname === path);
      return new Headers(call?.[1]?.headers).get("authorization");
    };
    expect(auth("/repos/octo-sample/traffolio")).toBe(`Bearer ${GITHUB_TOKEN}`);
    expect(auth("/user")).toBe(`Bearer ${TRAFFIC_TOKEN}`);

    for (const text of [...lines, summary]) {
      expect(text).not.toContain(GITHUB_TOKEN);
      expect(text).not.toContain(TRAFFIC_TOKEN);
    }
    expect(lines).toContain("octo-sample/sample-cli: ok (2026-10-12..2026-10-25)");

    // A same-day rerun with identical responses rewrites nothing, sparklines included.
    const again = await runCollect({
      env: { GITHUB_TOKEN, GITHUB_REPOSITORY: "octo-sample/traffolio", TRAFFIC_TOKEN },
      fetch,
      sleep: async () => {},
      rootDir: root,
      now: () => Date.parse("2026-10-27T09:00:00Z"),
      log: () => {},
    });
    expect(again).toEqual({ exitCode: 0, outcome: "ok", commit: false, dataThroughDate: "2026-10-25" });
  });
});
