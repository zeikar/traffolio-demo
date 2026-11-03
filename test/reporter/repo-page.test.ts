import { beforeAll, describe, expect, it } from "vitest";
import { buildDashboardModel, daysFromMonthFiles } from "../../src/reporter/aggregate.js";
import type { DashboardModel } from "../../src/reporter/aggregate.js";
import { buildRepoPageModel, loadRepoExtras } from "../../src/reporter/repo-model.js";
import type { RepoPageModel } from "../../src/reporter/repo-model.js";
import { renderRepoPage } from "../../src/reporter/repo-page.js";
import { createStore } from "../../src/storage/store.js";
import type { MonthFile } from "../../src/types.js";
import { demoRoot } from "../dashboard-demo.js";

const render = (m: RepoPageModel, sampleLabel = false) =>
  renderRepoPage(m, { imagePath: (name) => `img/${name}.svg`, sampleLabel });

let dashboard: DashboardModel;
let pages: Record<string, RepoPageModel>;

beforeAll(async () => {
  const store = createStore(demoRoot);
  const index = (await store.readIndex())!;
  const status = (await store.readStatus())!;
  const files: Record<string, MonthFile[]> = {};
  for (const id of Object.keys(index.repositories)) files[id] = await store.readMonthFiles(id);
  dashboard = buildDashboardModel(index, status, files);
  pages = {};
  for (const row of dashboard.rows) {
    const extras = await loadRepoExtras(store, row.id, { growth: [], referrers: [], releases: [] });
    pages[row.id] = buildRepoPageModel(row, daysFromMonthFiles(files[row.id]!), dashboard.dataThroughDate, extras);
  }
});

describe("renderRepoPage", () => {
  it("has the heading, GitHub link, status and data-through date", () => {
    const s = render(pages["100001"]!);
    expect(s.startsWith("# octo-sample/sample-cli\n")).toBe(true);
    expect(s).toContain("[GitHub](https://github.com/octo-sample/sample-cli) · public · Status: ok · Data through 2026-10-25 (UTC)");
  });

  it("shows the forbidden status", () => {
    expect(render(pages["100003"]!)).toContain("Status: forbidden since 2026-10-10");
  });

  it("labels missing and excluded repositories", () => {
    const base = pages["100001"]!;
    expect(render({ ...base, tracking: "missing" })).toContain("Status: missing");
    expect(render({ ...base, tracking: "excluded:archived" })).toContain("Status: excluded (archived)");
  });

  it("has a totals table with Views and Clones only, — for no data, and the footnote", () => {
    const s = render(pages["100003"]!);
    expect(s).toContain("| | 7d | 30d | 90d | All |");
    expect(s).toMatch(/\| Views \| — \|/);
    expect(s).toMatch(/\| Clones \|/);
    expect(s).not.toMatch(/^\| unique/im);
    expect(render(pages["100001"]!)).toContain("\\* Includes days with no stored data");
  });

  it("uses imagePath for the images and shows the stars section only with growth", () => {
    const s = render(pages["100001"]!);
    expect(s).toContain("](img/views.svg)");
    expect(s).toContain("](img/clones.svg)");
    expect(s).toContain("## Stars and forks");
    expect(s).toContain("](img/stars.svg)");
    const bare = render({ ...pages["100001"]!, growth: null });
    expect(bare).not.toContain("Stars and forks");
    expect(bare).not.toContain("stars.svg");
  });

  it("renders referrer and page tables with unique columns and the snapshot date", () => {
    const s = render(pages["100001"]!);
    expect(s).toContain("## Top referrers and pages (last 14 days as of 2026-10-27, UTC)");
    expect(s).toContain("| Referrer | Views | Unique visitors |");
    expect(s).toContain("| Page | Title | Views | Unique visitors |");
    expect(render(pages["100003"]!)).toContain("as of 2026-10-06");
  });

  it("renders the release table with the change column and values", () => {
    const s = render(pages["100001"]!);
    expect(s).toContain("## Release downloads (as of 2026-10-27)");
    expect(s).toContain("| Release | Published | Downloads | Change since 2026-09-22 |");
    expect(s).toMatch(/v1\.0\.0 \| 2025-04-01 \| 220 \| 7 \|/);
    expect(s).toMatch(/\| 161 \| 53 \|/);
    expect(s).toMatch(/\| 15 \| 15 \|/);
  });

  it("drops the change column when there is no base snapshot, and shows — for no publish date", () => {
    const releases = {
      asOf: "2026-10-27",
      baseDate: null,
      rows: [{ tag: "v1", name: "", publishedDate: null, total: 3, change: null }],
    };
    const s = render({ ...pages["100001"]!, releases });
    expect(s).toContain("| Release | Published | Downloads |\n| --- | --- | ---: |\n| v1 | — | 3 |");
    expect(s).not.toContain("Change since");
  });

  it("escapes hostile text in names, referrers, paths and releases", () => {
    const s = render({
      ...pages["100001"]!,
      fullName: "o/a|b<x>",
      referrers: {
        date: "2026-10-27",
        referrers: [{ referrer: "[x](http://evil)|<b>", count: 1, uniques: 1 }],
        paths: [{ path: "/a|b", title: "<img src=x>\n[t](u)", count: 1, uniques: 1 }],
      },
      releases: {
        asOf: "2026-10-27",
        baseDate: null,
        rows: [{ tag: "v|1", name: "<i>", publishedDate: null, total: 1, change: null }],
      },
    });
    expect(s).toContain("# o/a\\|b\\<x\\>");
    expect(s).not.toMatch(/(^|[^\\])</m);
    expect(s).not.toContain("[x](");
    expect(s).not.toContain("[t](");
    expect(s).toContain("[GitHub](https://github.com/o/a%7Cb%3Cx%3E)");
    for (const line of s.split("\n").filter((l) => l.startsWith("| ") && l.includes("evil"))) {
      expect(line.replace(/\\\|/g, "").split("|").length).toBe(5);
    }
  });

  it("toggles the sample label", () => {
    expect(render(pages["100001"]!, true)).toContain("*Sample data*");
    expect(render(pages["100001"]!)).not.toContain("Sample data");
  });

  it("renders a model with no data as — and still references both images", () => {
    const row = dashboard.rows.find((r) => r.id === "100001")!;
    const s = render(buildRepoPageModel(row, new Map(), null, {}));
    expect(s).toContain("No traffic data stored yet");
    expect(s).toContain("| Views | — | — | — | — |");
    expect(s).toContain("| Clones | — | — | — | — |");
    expect(s).toContain("](img/views.svg)");
    expect(s).toContain("](img/clones.svg)");
  });

  it("carries no timestamps and is deterministic", () => {
    const m = pages["100001"]!;
    expect(render(m)).toBe(render(m));
    expect(render(m)).not.toMatch(/\d\d:\d\d:\d\d/);
  });
});
