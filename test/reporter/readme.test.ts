import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  buildDashboardModel,
  type DashboardModel,
} from "../../src/reporter/aggregate.js";
import {
  MARKER_END,
  MARKER_START,
  MarkerError,
  assertMarkers,
  renderSection,
  replaceSection,
} from "../../src/reporter/readme.js";
import { createStore } from "../../src/storage/store.js";
import type { MonthFile } from "../../src/types.js";

const demoRoot = fileURLToPath(new URL("../../fixtures/demo", import.meta.url));
let model: DashboardModel;

beforeAll(async () => {
  const store = createStore(demoRoot);
  const index = (await store.readIndex())!;
  const status = (await store.readStatus())!;
  const files: Record<string, MonthFile[]> = {};
  for (const id of Object.keys(index.repositories))
    files[id] = await store.readMonthFiles(id);
  model = buildDashboardModel(index, status, files);
});

const opts = {
  viewsSvgPath: "./views.svg",
  clonesSvgPath: "./clones.svg",
  sparklinePath: (id: string) => `./sparklines/${id}.svg`,
  repoPagePath: (id: string) => `repos/${id}.md`,
  sampleLabel: false,
};
const rowLine = (s: string, name: string) =>
  s.split("\n").find((l) => l.includes(`/${name}]`))!;

describe("renderSection", () => {
  it("links the repository cell to its page, then to GitHub", () => {
    const line = rowLine(renderSection(model, opts), "sample-cli");
    expect(line.split("|")[1]!.trim()).toBe(
      "[octo-sample/sample-cli](repos/100001.md) · [GitHub](https://github.com/octo-sample/sample-cli)",
    );
  });

  it("has the data-through heading, totals, failed line, image and notes", () => {
    const s = renderSection(model, opts);
    expect(s).toContain(`Data through ${model.dataThroughDate} (UTC)`);
    expect(s).toContain("| Views |");
    expect(s).toContain("| Clones |");
    expect(s).toContain(
      "1 repository could not be collected (see data/status.json)",
    );
    expect(s).toContain("not unique users");
    expect(s).toContain("(https://github.com/");
    expect(s).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("shows — for the forbidden repo's 7d cells and its status", () => {
    const line = rowLine(renderSection(model, opts), "Sample-Docs");
    const cells = line.split("|").map((c) => c.trim());
    // Repository, Trend, Visibility, Views 7d, Views 30d, Clones 7d, Clones 30d
    expect(cells[4]).toBe("—");
    expect(cells[6]).toBe("—");
    expect(line).toContain("forbidden since 2026-10-10");
  });

  it("puts a per-row trend sparkline right after the repository", () => {
    const s = renderSection(model, opts);
    expect(s).toContain(
      "| Repository | Views trend (30d) | Visibility | Views 7d |",
    );
    expect(s).toContain("| --- | --- | --- | ---: |");
    for (const row of model.rows) {
      const cells = rowLine(s, row.name).split("|").map((c) => c.trim());
      expect(cells[2]).toBe(`![trend](./sparklines/${row.id}.svg)`);
    }
  });

  it("marks sums over the gap window with * and adds a footnote", () => {
    const s = renderSection(model, opts);
    expect(s).toMatch(/\| Views \| [^|]*\| \d+\* \|/);
    expect(s).toContain("\\* Includes days with no stored data");
  });

  it("marks the 7d totals incomplete because one tracked repo lacks those dates", () => {
    expect(model.totals!.d7.missingDays).toBe(0);
    expect(renderSection(model, opts)).toMatch(/\| Views \| 380\* \|/);
    expect(renderSection(model, opts)).toMatch(/\| Clones \| 118\* \|/);
  });

  it("toggles the sample caption", () => {
    expect(renderSection(model, { ...opts, sampleLabel: true })).toContain(
      "Sample data",
    );
    expect(renderSection(model, opts)).not.toContain("Sample data");
  });

  it("embeds the image path verbatim", () => {
    const s = renderSection(model, {
      ...opts,
      viewsSvgPath: "docs/a b/v.svg",
      clonesSvgPath: "docs/a b/c.svg",
    });
    expect(s).toContain(
      "![Views over the last 30 days](docs/a b/v.svg)\n![Clones over the last 30 days](docs/a b/c.svg)",
    );
  });

  it("renders the no-data heading without a totals table", () => {
    const empty: DashboardModel = {
      ...model,
      dataThroughDate: null,
      totals: null,
      series: [],
      rows: model.rows.map((r) => ({
        ...r,
        d7: {
          views: null,
          clones: null,
          presentDays: 0,
          missingDays: 0,
          partialDays: 0,
        },
        d30: {
          views: null,
          clones: null,
          presentDays: 0,
          missingDays: 0,
          partialDays: 0,
        },
      })),
    };
    const s = renderSection(empty, opts);
    expect(s).toContain("No traffic data stored yet (UTC)");
    expect(s).not.toContain("| Views |");
    expect(s).not.toContain("Data through");
    expect(s).toContain("| Repository |");
    expect(s).toContain("could not be collected");
    expect(s).toContain("![");
    expect(rowLine(s, "Sample-Docs")).toContain("| — | — | — | — |");
  });

  it("renders the referrer table after the chart only when given", () => {
    const s = renderSection(model, {
      ...opts,
      topReferrers: { date: "2026-10-27", referrers: [{ referrer: "a|b.example", count: 7 }] },
    });
    expect(s).toContain("#### Top referrers (last 14 days as of 2026-10-27, UTC)");
    expect(s).toContain("| Referrer | Views from referrer |");
    expect(s).toContain("| a\\|b.example | 7 |");
    expect(s.indexOf("Top referrers")).toBeGreaterThan(s.indexOf("![Clones over the last 30 days]"));
    expect(renderSection(model, opts)).not.toContain("Top referrers");
    expect(renderSection(model, { ...opts, topReferrers: null })).not.toContain("Top referrers");
  });

  it("escapes pipes in repo names", () => {
    const m: DashboardModel = {
      ...model,
      rows: [{ ...model.rows[0]!, fullName: "o/a|b" }],
    };
    expect(renderSection(m, opts)).toContain("[o/a\\|b]");
  });
});

describe("markers", () => {
  let section: string;
  beforeAll(() => {
    section = renderSection(model, opts);
  });

  it("preserves text outside the markers byte-for-byte and is idempotent", () => {
    const before = "# Title\r\n\n  keep  \t\n";
    const after = "\n\nfooter ✓ \n";
    const readme = `${before}${MARKER_START}\nold\n${MARKER_END}${after}`;
    const once = replaceSection(readme, section);
    expect(once.startsWith(`${before}${MARKER_START}\n`)).toBe(true);
    expect(once.endsWith(`${MARKER_END}${after}`)).toBe(true);
    expect(replaceSection(once, section)).toBe(once);
  });

  it("throws MarkerError for missing, duplicated or misordered markers", () => {
    expect(() => assertMarkers("nothing")).toThrow(MarkerError);
    expect(() => assertMarkers(`${MARKER_START}\n`)).toThrow(MarkerError);
    expect(() => assertMarkers(`${MARKER_END}\n`)).toThrow(MarkerError);
    expect(() =>
      assertMarkers(`${MARKER_START}${MARKER_START}${MARKER_END}`),
    ).toThrow(MarkerError);
    expect(() => assertMarkers(`${MARKER_END}${MARKER_START}`)).toThrow(
      MarkerError,
    );
    expect(() => replaceSection("x", section)).toThrow(MarkerError);
  });

  // The template's own README is what new repositories start from and what its scheduled run checks.
  it("accepts the repository's own README", () => {
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(() => assertMarkers(readme)).not.toThrow();
  });
});
