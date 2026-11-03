import type { ExtrasFiles } from "../collect-extras.js";
import type { Store } from "../storage/store.js";
import type { IndexFile, MonthFile, StatusFile } from "../types.js";
import { buildDashboardModel, daysFromMonthFiles } from "./aggregate.js";
import { renderSection } from "./readme.js";
import { buildRepoPageModel, loadRepoExtras } from "./repo-model.js";
import { renderRepoPage } from "./repo-page.js";
import { readTopReferrers } from "./referrers.js";
import { renderSparklineSvg } from "./sparkline.js";
import { clonesChart, repoClonesChart, repoStarsChart, repoViewsChart, viewsChart } from "./svg.js";

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

  const repoPagePath = (id: string): string => `repos/${id}.md`;
  const repoImagePath = (id: string, name: string): string => `assets/repos/${id}/${name}.svg`;

  const section = renderSection(model, {
    viewsSvgPath,
    clonesSvgPath,
    sparklinePath,
    repoPagePath,
    sampleLabel,
    topReferrers,
  });
  const files: [string, string][] = [
    [viewsSvgPath, viewsChart(model.series, sampleLabel)],
    [clonesSvgPath, clonesChart(model.series, sampleLabel)],
    ...model.rows.map((row): [string, string] => [sparklinePath(row.id), renderSparklineSvg(row.series)]),
  ];
  for (const row of model.rows) {
    const extras = await loadRepoExtras(store, row.id, computed);
    const page = buildRepoPageModel(
      row,
      daysFromMonthFiles(monthFilesByRepo[row.id] ?? []),
      model.dataThroughDate,
      extras,
    );
    files.push(
      [
        repoPagePath(row.id),
        renderRepoPage(page, { imagePath: (name) => `../${repoImagePath(row.id, name)}`, sampleLabel }),
      ],
      [repoImagePath(row.id, "views"), repoViewsChart(page.series, sampleLabel)],
      [repoImagePath(row.id, "clones"), repoClonesChart(page.series, sampleLabel)],
    );
    if (page.growth) files.push([repoImagePath(row.id, "stars"), repoStarsChart(page.growth.stars, sampleLabel)]);
  }
  return { section, files };
}
