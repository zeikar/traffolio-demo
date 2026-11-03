import { describe, expect, it } from "vitest";
import { daysFromMonthFiles } from "../../src/reporter/aggregate.js";
import { renderOutputs } from "../../src/reporter/outputs.js";
import type { OutputsInput } from "../../src/reporter/outputs.js";
import { createStore } from "../../src/storage/store.js";
import type { MonthFile, ReferrerMonthFile } from "../../src/types.js";
import { demoRoot } from "../dashboard-demo.js";

async function demoInput(referrers: ReferrerMonthFile[] = []): Promise<OutputsInput> {
  const store = createStore(demoRoot);
  const index = (await store.readIndex())!;
  const status = (await store.readStatus())!;
  const monthFilesByRepo: Record<string, MonthFile[]> = {};
  for (const id of Object.keys(index.repositories)) monthFilesByRepo[id] = await store.readMonthFiles(id);
  return { store, index, status, monthFilesByRepo, computed: { growth: [], referrers, releases: [] }, sampleLabel: true };
}

describe("renderOutputs", () => {
  it("returns the two charts, then one sparkline per row in row order", async () => {
    const { files } = await renderOutputs(await demoInput());
    expect(files.map(([path]) => path)).toEqual([
      "assets/views.svg",
      "assets/clones.svg",
      "assets/sparklines/100001.svg",
      "assets/sparklines/100003.svg",
      "assets/sparklines/100002.svg",
      ...["100001", "100003", "100002"].flatMap((id) => [
        `repos/${id}.md`,
        `assets/repos/${id}/views.svg`,
        `assets/repos/${id}/clones.svg`,
        `assets/repos/${id}/stars.svg`,
      ]),
    ]);
  });

  it("writes no stars chart for a repository without a growth file", async () => {
    const input = await demoInput();
    const store = { ...input.store, readGrowth: async () => undefined } as typeof input.store;
    const { files } = await renderOutputs({ ...input, store });
    expect(files.some(([path]) => path.endsWith("stars.svg"))).toBe(false);
    expect(files.some(([path]) => path === "repos/100001.md")).toBe(true);
  });

  it("links the section to the same paths", async () => {
    const { section } = await renderOutputs(await demoInput());
    expect(section).toContain("](assets/sparklines/100001.svg)");
    expect(section).toContain("](assets/views.svg)");
    expect(section).toContain("](repos/100001.md)");
  });

  it("is deterministic", async () => {
    const input = await demoInput();
    expect(await renderOutputs(input)).toEqual(await renderOutputs(input));
  });

  it("prefers this run's referrer files over stored ones", async () => {
    const computed: ReferrerMonthFile = {
      schemaVersion: 1,
      repositoryId: 100001,
      month: "2026-10",
      snapshots: { "2026-10-28": { referrers: [{ referrer: "new.example", count: 3, uniques: 1 }], paths: [] } },
    };
    const stored = (await renderOutputs(await demoInput())).section;
    const { section } = await renderOutputs(await demoInput([computed]));
    expect(stored).toContain("as of 2026-10-27");
    expect(section).toContain("as of 2026-10-28");
  });
});
