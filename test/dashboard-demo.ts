import { fileURLToPath } from "node:url";
import type { DashboardInput } from "../src/dashboard/html.js";
import { type DayMap, daysFromMonthFiles } from "../src/reporter/aggregate.js";
import { createStore } from "../src/storage/store.js";
import type { GrowthFile, ReferrerMonthFile, ReleasesFile } from "../src/types.js";

export const demoRoot = fileURLToPath(new URL("../fixtures/demo", import.meta.url));

/** The demo store, read the way runDashboard reads it. */
export async function loadDemoInput(): Promise<DashboardInput> {
  const store = createStore(demoRoot);
  const index = (await store.readIndex())!;
  const status = (await store.readStatus())!;
  const days: Record<string, DayMap> = {};
  const growth: Record<string, GrowthFile> = {};
  const referrers: Record<string, ReferrerMonthFile> = {};
  const releases: Record<string, ReleasesFile> = {};
  for (const id of Object.keys(index.repositories)) {
    days[id] = daysFromMonthFiles(await store.readMonthFiles(id));
    const g = await store.readGrowth(id);
    if (g) growth[id] = g;
    const r = await store.readLatestReferrerMonth(id);
    if (r) referrers[id] = r;
    const rel = await store.readReleases(id);
    if (rel) releases[id] = rel;
  }
  return { index, status, days, growth, referrers, releases, source: "/somewhere/data" };
}
