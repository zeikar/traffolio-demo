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
  it("returns the three charts, then one sparkline per row in row order", async () => {
    const { files } = await renderOutputs(await demoInput());
    expect(files.map(([path]) => path)).toEqual([
      "assets/views.svg",
      "assets/clones.svg",
      "assets/stars.svg",
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
    const { files, section } = await renderOutputs({ ...input, store });
    expect(files.some(([path]) => path.endsWith("stars.svg"))).toBe(false);
    expect(files.some(([path]) => path === "repos/100001.md")).toBe(true);
    expect(section).not.toContain("stars.svg");
  });

  describe("README stars chart", () => {
    const starsHeadline = async (input: OutputsInput): Promise<string | undefined> => {
      const svg = (await renderOutputs(input)).files.find(([path]) => path === "assets/stars.svg")?.[1];
      return svg?.match(/<text [^>]*class="headline">([^<]*)</)?.[1];
    };
    // The demo's star histories hold every star up to the data-through date: 42 + 17 + 8.
    const growthStars = async (input: OutputsInput, id: string): Promise<number> =>
      Object.values((await input.store.readGrowth(id))!.stars).reduce((a, b) => a + b, 0);

    it("headlines the summed stars of the tracked repositories", async () => {
      const input = await demoInput();
      const { files, section } = await renderOutputs(input);
      const ids = Object.keys(input.index.repositories);
      let total = 0;
      for (const id of ids) total += await growthStars(input, id);
      expect(await starsHeadline(input)).toBe(String(total));
      expect(files.find(([path]) => path === "assets/stars.svg")![1]).toContain("Tracked repos · last 90 days");
      expect(section).toContain("![Stars over the last 90 days](assets/stars.svg)");
    });

    it("leaves out repositories that are no longer tracked", async () => {
      const input = await demoInput();
      const all = Number(await starsHeadline(input));
      const repositories = { ...input.index.repositories };
      repositories["100002"] = { ...repositories["100002"]!, tracking: "excluded:archived" };
      repositories["100003"] = { ...repositories["100003"]!, tracking: "missing" };
      const headline = await starsHeadline({ ...input, index: { ...input.index, repositories } });
      expect(Number(headline)).toBe(all - (await growthStars(input, "100002")) - (await growthStars(input, "100003")));
    });

    it("is not drawn before there is a data-through date", async () => {
      const input = await demoInput();
      const { files, section } = await renderOutputs({ ...input, status: { ...input.status, dataThroughDate: null } });
      expect(files.some(([path]) => path === "assets/stars.svg")).toBe(false);
      expect(section).not.toContain("stars.svg");
    });
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
