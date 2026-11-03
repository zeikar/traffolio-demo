import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderOutputs } from "../reporter/outputs.js";
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
  const { section, files } = await renderOutputs({
    store: demo,
    index,
    status,
    monthFilesByRepo,
    computed: { growth: [], referrers: [], releases: [] },
    sampleLabel: true,
  });

  const out = createStore(repoRoot);
  for (const [path, text] of [["README-section.md", section], ...files]) {
    const target = `docs/demo/${path}`;
    const changed = await out.writeTextFile(target, text);
    console.log(`${changed ? "wrote" : "unchanged"} ${target}`);
  }
}

main().catch((err: unknown) => {
  console.error(`demo failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
