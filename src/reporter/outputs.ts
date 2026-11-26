import type { ExtrasFiles } from "../collect-extras.js";
import type { Store } from "../storage/store.js";
import type { IndexFile, MonthFile, StatusFile } from "../types.js";
import { buildDashboardModel, daysFromMonthFiles, isIncomplete } from "./aggregate.js";
import { renderSection } from "./readme.js";
import { buildRepoPageModel, loadRepoExtras, totalStarSeries } from "./repo-model.js";
import { renderRepoPage } from "./repo-page.js";
import { readTopReferrers } from "./referrers.js";
import { renderSparklineSvg } from "./sparkline.js";
import {
  clonesChart,
  repoClonesChart,
  repoStarsChart,
  repoViewsChart,
  totalStarsChart,
  viewsChart,
} from "./svg.js";

export interface OutputsInput {
  store: Store;
  index: IndexFile;
  status: StatusFile;
  monthFilesByRepo: Record<string, MonthFile[]>;
  /** This run's extras files; they win over the stored ones. */
  computed: ExtrasFiles;
  sampleLabel: boolean;
}

export interface Outputs {
  /** The README section, links relative to the site root. */
  section: string;
  /** `[path, text]` pairs relative to the site root. */
  files: [string, string][];
}

/**
 * Renders everything the README links to. Shared by the collector and the demo so that both lay out
 * and link their files identically. Read-only: the caller decides where, and whether, to write.
 */
export async function renderOutputs(input: OutputsInput): Promise<Outputs> {
  const { store, index, status, monthFilesByRepo, computed, sampleLabel } = input;
  const model = buildDashboardModel(index, status, monthFilesByRepo);
  const topReferrers = await readTopReferrers(store, index, computed.referrers);
  const sparklinePath = (id: string): string => `assets/sparklines/${id}.svg`;
  const viewsSvgPath = "assets/views.svg";
  const clonesSvgPath = "assets/clones.svg";
  const starsSvgPath = "assets/stars.svg";

  const repoPagePath = (id: string): string => `repos/${id}.md`;
  const repoImagePath = (id: string, name: string): string => `assets/repos/${id}/${name}.svg`;

  const repoFiles: [string, string][] = [];
  const trackedStars: Record<string, number>[] = [];
  for (const row of model.rows) {
    const extras = await loadRepoExtras(store, row.id, computed);
    if (row.tracking === "tracked" && extras.growth) trackedStars.push(extras.growth.stars);
    const page = buildRepoPageModel(
      row,
      daysFromMonthFiles(monthFilesByRepo[row.id] ?? []),
      model.dataThroughDate,
      extras,
    );
    repoFiles.push(
      [
        repoPagePath(row.id),
        renderRepoPage(page, { imagePath: (name) => `../${repoImagePath(row.id, name)}`, sampleLabel }),
      ],
      [repoImagePath(row.id, "views"), repoViewsChart(page.series, isIncomplete(page.totals.d90), sampleLabel)],
      [repoImagePath(row.id, "clones"), repoClonesChart(page.series, isIncomplete(page.totals.d90), sampleLabel)],
    );
    if (page.growth) repoFiles.push([repoImagePath(row.id, "stars"), repoStarsChart(page.growth.stars, sampleLabel)]);
  }

  const end = model.dataThroughDate;
  const starsSvg =
    trackedStars.length > 0 && end !== null ? totalStarsChart(totalStarSeries(trackedStars, end), sampleLabel) : null;

  const section = renderSection(model, {
    viewsSvgPath,
    clonesSvgPath,
    starsSvgPath: starsSvg === null ? null : starsSvgPath,
    sparklinePath,
    repoPagePath,
    sampleLabel,
    topReferrers,
  });
  // The views and clones charts span the same 30 days as the table's 30d column.
  const readmeIncomplete = model.totals !== null && isIncomplete(model.totals.d30);
  const files: [string, string][] = [
    [viewsSvgPath, viewsChart(model.series, readmeIncomplete, sampleLabel)],
    [clonesSvgPath, clonesChart(model.series, readmeIncomplete, sampleLabel)],
    ...(starsSvg === null ? [] : [[starsSvgPath, starsSvg] as [string, string]]),
    ...model.rows.map((row): [string, string] => [sparklinePath(row.id), renderSparklineSvg(row.series)]),
    ...repoFiles,
  ];
  return { section, files };
}
