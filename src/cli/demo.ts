import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDashboardModel } from "../reporter/aggregate.js";
import { renderSection } from "../reporter/readme.js";
import { readTopReferrers } from "../reporter/referrers.js";
import { renderSparklineSvg } from "../reporter/sparkline.js";
import { renderTrafficSvg } from "../reporter/svg.js";
import { createStore } from "../storage/store.js";
import type { MonthFile } from "../types.js";

// dist/cli/demo.js -> repo root
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function main(): Promise<void> {
  const demo = createStore(join(repoRoot, "fixtures", "demo"));
  const index = await demo.readIndex();
  const status = await demo.readStatus();
  if (!index || !status) {
    throw new Error("fixtures/demo/data is missing index.json or status.json");
  }

  const monthFilesByRepo: Record<string, MonthFile[]> = {};
  for (const id of Object.keys(index.repositories)) {
    monthFilesByRepo[id] = await demo.readMonthFiles(id);
  }
  const model = buildDashboardModel(index, status, monthFilesByRepo);
  const topReferrers = await readTopReferrers(demo, index, []);

  const out = createStore(repoRoot);
  const files: [string, string][] = [
    ["docs/demo/traffic.svg", renderTrafficSvg(model.series, { sampleLabel: true })],
    [
      "docs/demo/README-section.md",
      renderSection(model, {
        svgPath: "./traffic.svg",
        sparklinePath: (id) => `./sparklines/${id}.svg`,
        sampleLabel: true,
        topReferrers,
      }),
    ],
    ...model.rows.map((row): [string, string] => [
      `docs/demo/sparklines/${row.id}.svg`,
      renderSparklineSvg(row.series),
    ]),
  ];
  for (const [path, text] of files) {
    const changed = await out.writeTextFile(path, text);
    console.log(`${changed ? "wrote" : "unchanged"} ${path}`);
  }
}

main().catch((err: unknown) => {
  console.error(`demo failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
