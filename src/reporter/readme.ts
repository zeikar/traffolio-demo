import type { DashboardModel, DashboardRow, PeriodSum } from "./aggregate.js";
import type { TopReferrers } from "./referrers.js";

export const MARKER_START = "<!-- TRAFFOLIO:START -->";
export const MARKER_END = "<!-- TRAFFOLIO:END -->";

export class MarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkerError";
  }
}

export interface RenderOptions {
  svgPath: string;
  /** Image path of a row's trend sparkline, by repo id. */
  sparklinePath: (id: string) => string;
  sampleLabel: boolean;
  /** Omitted or null: no referrer table. */
  topReferrers?: TopReferrers | null;
}

const DASH = "—";

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

export function assertMarkers(readme: string): void {
  for (const marker of [MARKER_START, MARKER_END]) {
    const n = count(readme, marker);
    if (n === 0) throw new MarkerError(`README is missing marker ${marker}`);
    if (n > 1) throw new MarkerError(`README has ${n} copies of marker ${marker}`);
  }
  if (readme.indexOf(MARKER_START) > readme.indexOf(MARKER_END)) {
    throw new MarkerError(`${MARKER_START} must come before ${MARKER_END}`);
  }
}

export function replaceSection(readme: string, section: string): string {
  assertMarkers(readme);
  const before = readme.slice(0, readme.indexOf(MARKER_START));
  const after = readme.slice(readme.indexOf(MARKER_END) + MARKER_END.length);
  return `${before}${MARKER_START}\n${section}${MARKER_END}${after}`;
}

/** `—` = no stored days at all (not zero); `*` = some days have no data, or lack some repositories. */
function cell(value: number | null, p: PeriodSum): string {
  if (value === null) return DASH;
  return p.missingDays > 0 || p.partialDays > 0 ? `${value}*` : String(value);
}

const views = (p: PeriodSum): string => cell(p.views, p);
const clones = (p: PeriodSum): string => cell(p.clones, p);

function escapeCell(text: string): string {
  return text.replace(/[\\`*_{}[\]<>|]/g, "\\$&").replace(/\r?\n/g, " ");
}

function status(row: DashboardRow): string {
  if (row.tracking === "tracked") {
    return row.lastError ? `${row.lastError.kind} since ${row.lastError.date}` : "ok";
  }
  if (row.tracking === "missing") return "missing";
  return `excluded (${row.tracking.slice("excluded:".length)})`;
}

function repoTable(rows: DashboardRow[], sparklinePath: (id: string) => string): string[] {
  const lines = [
    "| Repository | Trend (30d) | Visibility | Views 7d | Views 30d | Clones 7d | Clones 30d | Stars | Forks | Status |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ];
  for (const r of rows) {
    lines.push(
      `| [${escapeCell(r.fullName)}](https://github.com/${r.fullName}) | ![trend](${sparklinePath(r.id)}) | ${r.visibility} | ` +
        `${views(r.d7)} | ${views(r.d30)} | ${clones(r.d7)} | ${clones(r.d30)} | ` +
        `${r.stars} | ${r.forks} | ${escapeCell(status(r))} |`,
    );
  }
  return lines;
}

function referrerTable(top: TopReferrers): string[] {
  return [
    `#### Top referrers (last 14 days as of ${top.date}, UTC)`,
    "",
    "| Referrer | Views from referrer |",
    "| --- | ---: |",
    ...top.referrers.map((r) => `| ${escapeCell(r.referrer)} | ${r.count} |`),
    "",
    "Summed over the tracked repositories; GitHub reports only each repository's top 10 referrers.",
    "",
  ];
}

/**
 * The failed-repo line is rendered only when N > 0, to keep a healthy README
 * quiet. The output carries a date, never a timestamp, so reruns on the same
 * data are byte-identical.
 */
export function renderSection(model: DashboardModel, opts: RenderOptions): string {
  const out: string[] = [];
  const { totals } = model;

  if (model.dataThroughDate === null || totals === null) {
    out.push("### Traffic — No traffic data stored yet (UTC)", "");
  } else {
    out.push(`### Traffic — Data through ${model.dataThroughDate} (UTC)`, "");
  }
  if (opts.sampleLabel) out.push("*Sample data*", "");

  let needsFootnote = false;
  if (totals) {
    const periods = [totals.d7, totals.d30, totals.all];
    needsFootnote = periods.some((p) => (p.missingDays > 0 || p.partialDays > 0) && p.presentDays > 0);
    out.push(
      "| | 7d | 30d | All |",
      "| --- | ---: | ---: | ---: |",
      `| Views | ${periods.map(views).join(" | ")} |`,
      `| Clones | ${periods.map(clones).join(" | ")} |`,
      "",
    );
  }

  const rows = model.rows;
  if (rows.length > 0) {
    out.push(...repoTable(rows, opts.sparklinePath), "");
    needsFootnote ||= rows.some((r) =>
      [r.d7, r.d30].some((p) => (p.missingDays > 0 || p.partialDays > 0) && p.presentDays > 0),
    );
  }

  if (needsFootnote) {
    out.push("\\* Includes days with no stored data, or where some repositories have none; the sum covers only the data we have.", "");
  }
  if (model.failedCount > 0) {
    out.push(
      `${model.failedCount} ${model.failedCount === 1 ? "repository" : "repositories"} could not be collected (see data/status.json)`,
      "",
    );
  }

  out.push(`![Traffic over the last 30 days](${opts.svgPath})`, "");
  if (opts.topReferrers) out.push(...referrerTable(opts.topReferrers));
  out.push(
    "All dates and windows are UTC.  ",
    "Totals are event counts (views and clones), not unique users.",
    "",
  );
  return out.join("\n");
}
