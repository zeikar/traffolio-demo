import type { PeriodSum } from "./aggregate.js";
import type { RepoCounts, RepoPageModel } from "./repo-model.js";
import { escapeCell, formatCell, statusLabel } from "./readme.js";

export interface RepoPageOptions {
  imagePath: (name: "views" | "clones" | "stars") => string;
  sampleLabel: boolean;
}

const DASH = "—";

/** Names are untrusted text; encoding keeps one from closing the link early or adding another. */
function githubUrl(fullName: string): string {
  return `https://github.com/${encodeURI(fullName).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`)}`;
}

const PERIOD_HEADER = ["| | 7d | 30d | 90d | All |", "| --- | ---: | ---: | ---: | ---: |"];

function totalsRow(label: string, totals: RepoCounts<PeriodSum>, key: "views" | "clones"): string {
  const cells = [totals.d7, totals.d30, totals.d90, totals.all].map((p) => formatCell(p[key], p));
  return `| ${label} | ${cells.join(" | ")} |`;
}

function countsRow(label: string, counts: RepoCounts<number>): string {
  return `| ${label} | ${[counts.d7, counts.d30, counts.d90, counts.all].join(" | ")} |`;
}

/**
 * Markdown page of one repository. Carries dates, never timestamps, so reruns on the same data are
 * byte-identical.
 */
export function renderRepoPage(model: RepoPageModel, opts: RepoPageOptions): string {
  const out: string[] = [`# ${escapeCell(model.fullName)}`, ""];
  const through =
    model.dataThroughDate === null ? "No traffic data stored yet" : `Data through ${model.dataThroughDate} (UTC)`;
  out.push(
    `[GitHub](${githubUrl(model.fullName)}) · ${model.visibility} · Status: ${escapeCell(statusLabel(model))} · ${through}`,
    "",
  );
  if (opts.sampleLabel) out.push("*Sample data*", "");

  const rows = [totalsRow("Views", model.totals, "views"), totalsRow("Clones", model.totals, "clones")];
  out.push(...PERIOD_HEADER, ...rows, "");
  if (rows.some((r) => r.includes("*"))) {
    out.push("\\* Includes days with no stored data; the sum covers only the data we have.", "");
  }

  out.push("## Views", "", `![Views over the last 90 days](${opts.imagePath("views")})`, "");
  out.push("## Clones", "", `![Clones over the last 90 days](${opts.imagePath("clones")})`, "");

  if (model.growth) {
    out.push(
      "## Stars and forks",
      "",
      `![Stars over the last 90 days](${opts.imagePath("stars")})`,
      "",
      ...PERIOD_HEADER,
      countsRow("New stars", model.growth.newStars),
      countsRow("New forks", model.growth.newForks),
      "",
    );
  }

  if (model.referrers) {
    const { date, referrers, paths } = model.referrers;
    out.push(`## Top referrers and pages (last 14 days as of ${date}, UTC)`, "");
    if (referrers.length > 0) {
      out.push(
        "| Referrer | Views | Unique visitors |",
        "| --- | ---: | ---: |",
        ...referrers.map((r) => `| ${escapeCell(r.referrer)} | ${r.count} | ${r.uniques} |`),
        "",
      );
    }
    if (paths.length > 0) {
      out.push(
        "| Page | Title | Views | Unique visitors |",
        "| --- | --- | ---: | ---: |",
        ...paths.map((p) => `| ${escapeCell(p.path)} | ${escapeCell(p.title)} | ${p.count} | ${p.uniques} |`),
        "",
      );
    }
  }

  if (model.releases) {
    const { asOf, baseDate, rows: releases } = model.releases;
    out.push(`## Release downloads (as of ${asOf})`, "");
    const change = baseDate !== null;
    out.push(
      `| Release | Published | Downloads |${change ? ` Change since ${baseDate} |` : ""}`,
      `| --- | --- | ---: |${change ? " ---: |" : ""}`,
      ...releases.map((r) => {
        const label = r.name !== "" && r.name !== r.tag ? `${r.tag} — ${r.name}` : r.tag;
        const delta = change ? ` ${r.change ?? DASH} |` : "";
        return `| ${escapeCell(label)} | ${r.publishedDate ?? DASH} | ${r.total} |${delta}`;
      }),
      "",
    );
  }

  out.push(
    "All dates and windows are UTC.  ",
    "Daily unique counts are per day and are never summed.",
    "",
  );
  return out.join("\n");
}
