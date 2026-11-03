import { createHash } from "node:crypto";
import type {
  DayMetrics,
  GrowthFile,
  IndexFile,
  ReferrerMonthFile,
  ReleasesFile,
  RepoStatus,
  StatusFile,
  Tracking,
} from "../types.js";
import { CLIENT_SCRIPT } from "./client.js";
import { STYLES } from "./styles.js";

export interface DashboardInput {
  index: IndexFile;
  status: StatusFile;
  /** Stored days per repository id; repos without traffic may be absent. */
  days: Record<string, ReadonlyMap<string, DayMetrics>>;
  /**
   * Where the data was read from, shown in the header of a local build. `null`
   * for a published page, which must carry no local information.
   */
  source: string | null;
  /** Per repository id; repos without the file are absent. */
  growth: Record<string, GrowthFile>;
  /** Each repository's newest referrer month file. */
  referrers: Record<string, ReferrerMonthFile>;
  releases: Record<string, ReleasesFile>;
}

/** [views, uniqueViews, clones, uniqueCloners] */
export type DayTuple = [number, number, number, number];

export interface DashboardRepo {
  name: string;
  fullName: string;
  private: boolean;
  tracking: Tracking;
  stars: number;
  forks: number;
  lastError: RepoStatus["lastError"];
  /** Keyed by YYYY-MM-DD, ascending. */
  days: Record<string, DayTuple>;
  /** Stars and forks added per date (ascending); null without a growth file. */
  growth: { stars: Record<string, number>; forks: Record<string, number> } | null;
  /** Latest referrer snapshot: [referrer, count, uniques] and [path, title, count, uniques]. */
  referrers: { date: string; referrers: [string, number, number][]; paths: [string, string, number, number][] } | null;
  /** Release id -> [tag, name, publishedDate]; run date (ascending) -> release id -> cumulative downloads. */
  releases: {
    info: Record<string, [string, string, string | null]>;
    snapshots: Record<string, Record<string, number>>;
  } | null;
}

export interface DashboardData {
  dataThroughDate: string | null;
  /** See DashboardInput.source. */
  source: string | null;
  /** Keyed by repository id. */
  repos: Record<string, DashboardRepo>;
}

function sortedRecord<T, U>(record: Record<string, T>, map: (value: T) => U): Record<string, U> {
  const out: Record<string, U> = {};
  for (const key of Object.keys(record).sort()) out[key] = map(record[key]!);
  return out;
}

const same = <T>(value: T): T => value;

function latestSnapshot(file: ReferrerMonthFile | undefined): DashboardRepo["referrers"] {
  const date = Object.keys(file?.snapshots ?? {}).sort().at(-1);
  if (file === undefined || date === undefined) return null;
  const snap = file.snapshots[date]!;
  return {
    date,
    referrers: snap.referrers.map((r) => [r.referrer, r.count, r.uniques]),
    paths: snap.paths.map((p) => [p.path, p.title, p.count, p.uniques]),
  };
}

/** Compact, key-ordered snapshot of everything the page needs. */
export function toDashboardData(input: DashboardInput): DashboardData {
  const repos: Record<string, DashboardRepo> = {};
  const ids = Object.keys(input.index.repositories).sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const entry = input.index.repositories[id]!;
    const days: Record<string, DayTuple> = {};
    const stored = input.days[id];
    if (stored) {
      for (const date of [...stored.keys()].sort()) {
        const m = stored.get(date)!;
        days[date] = [m.views, m.uniqueViews, m.clones, m.uniqueCloners];
      }
    }
    repos[id] = {
      name: entry.name,
      fullName: entry.fullName,
      private: entry.private,
      tracking: entry.tracking,
      stars: entry.stars,
      forks: entry.forks,
      lastError: input.status.repositories[id]?.lastError ?? null,
      days,
      growth: input.growth[id]
        ? { stars: sortedRecord(input.growth[id].stars, same), forks: sortedRecord(input.growth[id].forks, same) }
        : null,
      referrers: latestSnapshot(input.referrers[id]),
      releases: input.releases[id]
        ? {
            info: sortedRecord(input.releases[id].releases, (r) => [r.tag, r.name, r.publishedDate] as [string, string, string | null]),
            snapshots: sortedRecord(input.releases[id].snapshots, (s) => sortedRecord(s, same)),
          }
        : null,
    };
  }
  return { dataThroughDate: input.status.dataThroughDate, source: input.source, repos };
}

const JSON_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * JSON safe to place inside a <script> element: these characters only occur
 * inside JSON strings, where the \u escapes parse back to the same text, so
 * no repo name can close the element or start a comment.
 */
function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (c) => JSON_ESCAPES[c]!);
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("base64");

// Hash-pinned CSP: the page can't load anything or run any script but ours,
// even if escaping ever failed.
const CSP = [
  "default-src 'none'",
  `script-src 'sha256-${sha256(CLIENT_SCRIPT)}'`,
  `style-src 'sha256-${sha256(STYLES)}'`,
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const LOCAL_NOTE =
  '<p class="note">Generated locally from <code id="source"></code> &middot; contains private traffic data &mdash; don&rsquo;t commit or publish this file.</p>';
const PUBLISHED_NOTE =
  '<p class="note">Published by Traffolio in public mode. Every number here is public data, also stored as JSON in the publishing repository.</p>';

/**
 * Self-contained page: static shell + embedded JSON + inline client script
 * that renders everything via textContent. No timestamps, so the same data
 * always yields the same bytes.
 */
export function renderDashboardHtml(input: DashboardInput): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>Traffolio dashboard</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<header class="top">
<h1>Traffolio</h1>
<p class="meta" id="meta"></p>
${input.source === null ? PUBLISHED_NOTE : LOCAL_NOTE}
</header>
<noscript><p class="panel">Enable JavaScript to view the dashboard.</p></noscript>
<section class="scopebar">
<div class="scope"><h2 id="scope-title"></h2><p id="scope-sub"></p></div>
<div class="actions">
<button type="button" class="btn" id="close" hidden>&times; Back to all repositories</button>
<div class="seg" role="group" aria-label="Period">
<button type="button" data-period="7d">7d</button><button type="button" data-period="30d">30d</button><button type="button" data-period="90d">90d</button><button type="button" data-period="all">All</button>
</div>
</div>
</section>
<section class="cards" id="cards" aria-live="polite"></section>
<section class="panel">
<div class="panelhead"><h2>Views</h2></div>
<div class="legend" id="views-legend"></div>
<div class="chart" id="views-chart"></div>
</section>
<section class="panel">
<div class="panelhead"><h2>Clones</h2></div>
<div class="legend" id="clones-legend"></div>
<div class="chart" id="clones-chart"></div>
</section>
<section class="panel" id="stars-panel" hidden>
<div class="panelhead"><h2>Stars over time</h2><p id="stars-sub"></p></div>
<div class="chart" id="stars-chart"></div>
<p class="foot">Based on current stars; un-stars aren&rsquo;t counted, and a star&rsquo;s date may be off by a day.</p>
</section>
<section class="panel" id="ref-panel" hidden>
<div class="panelhead"><h2>Top referrers &amp; pages</h2><p id="ref-sub"></p></div>
<div class="split">
<div><h3>Top referrers</h3><table class="mini" aria-label="Top referrers"><thead><tr id="ref-head"></tr></thead><tbody id="ref-body"></tbody></table></div>
<div><h3>Top pages</h3><table class="mini" aria-label="Top pages"><thead><tr id="path-head"></tr></thead><tbody id="path-body"></tbody></table></div>
</div>
</section>
<section class="panel" id="rel-panel" hidden>
<div class="panelhead"><h2>Release downloads</h2><p id="rel-sub"></p></div>
<div class="chart" id="rel-chart"></div>
<table class="mini" aria-label="Release downloads"><thead><tr id="rel-head"></tr></thead><tbody id="rel-body"></tbody></table>
<p class="foot">Counts GitHub Release asset downloads only (updater metadata excluded); source archives and package registries aren&rsquo;t included.</p>
</section>
<section class="panel">
<div class="tablebar">
<div class="tabletitle"><h2>Repositories</h2><span id="row-count"></span></div>
<div class="controls">
<input type="search" id="filter" placeholder="Filter by name" aria-label="Filter repositories by name" autocomplete="off">
<label class="check"><input type="checkbox" id="show-all"> <span id="show-all-label"></span></label>
</div>
</div>
<div class="tablewrap">
<table>
<caption class="sr-only">Repositories. Select a row to show its daily charts.</caption>
<thead><tr id="head"></tr></thead>
<tbody id="body"></tbody>
</table>
</div>
<p class="foot"><span class="mark">*</span> Includes days with no stored data, or where some repositories have none; the sum covers only the data we have. &mdash; means no stored data for the period. Select a row to see its daily charts.</p>
</section>
<footer>All dates and windows are UTC. Views and clones are event counts, not unique users.</footer>
</main>
<script type="application/json" id="data">${scriptSafeJson(toDashboardData(input))}</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}
