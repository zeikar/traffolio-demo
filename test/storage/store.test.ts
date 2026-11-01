import { mkdtemp, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "../../src/storage/store.js";
import type { GrowthFile, IndexFile, MonthFile, ReferrerMonthFile, ReleasesFile, StatusFile } from "../../src/types.js";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "traffolio-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const month = (mo: string): MonthFile => ({
  schemaVersion: 1,
  repositoryId: 42,
  month: mo,
  days: { [`${mo}-01`]: { views: 1, uniqueViews: 1, clones: 2, uniqueCloners: 1 } },
});

describe("store", () => {
  it("reads missing data as empty/undefined", async () => {
    const s = createStore(root);
    expect(await s.readMonthFiles(42)).toEqual([]);
    expect(await s.readIndex()).toBeUndefined();
    expect(await s.readStatus()).toBeUndefined();
    expect(await s.readTextFile("README.md")).toBeUndefined();
  });

  it("round-trips month files sorted by month", async () => {
    const s = createStore(root);
    expect(await s.writeMonthFile(month("2026-10"))).toBe(true);
    expect(await s.writeMonthFile(month("2026-09"))).toBe(true);
    expect(await s.readMonthFiles(42)).toEqual([month("2026-09"), month("2026-10")]);
  });

  it("round-trips index, status and text files", async () => {
    const s = createStore(root);
    const index: IndexFile = { schemaVersion: 1, repositories: {} };
    const status: StatusFile = { schemaVersion: 1, dataThroughDate: null, repositories: {} };
    await s.writeIndex(index);
    await s.writeStatus(status);
    await s.writeTextFile("assets/traffic.svg", "<svg/>");
    expect(await s.readIndex()).toEqual(index);
    expect(await s.readStatus()).toEqual(status);
    expect(await s.readTextFile("assets/traffic.svg")).toBe("<svg/>");
  });

  it("round-trips growth, referrer and release files", async () => {
    const s = createStore(root);
    const growth: GrowthFile = { schemaVersion: 1, repositoryId: 42, stars: { "2026-10-01": 2 }, forks: {} };
    const referrers = (mo: string): ReferrerMonthFile => ({
      schemaVersion: 1,
      repositoryId: 42,
      month: mo,
      snapshots: { [`${mo}-02`]: { referrers: [], paths: [] } },
    });
    const releases: ReleasesFile = {
      schemaVersion: 1,
      repositoryId: 42,
      releases: { "7": { tag: "v1", name: "", publishedDate: null } },
      snapshots: { "2026-10-02": { "7": 3 } },
    };
    expect(await s.readGrowth(42)).toBeUndefined();
    expect(await s.readLatestReferrerMonth(42)).toBeUndefined();
    expect(await s.readReleases(42)).toBeUndefined();

    expect(await s.writeGrowth(growth)).toBe(true);
    expect(await s.writeReferrerMonth(referrers("2026-10"))).toBe(true);
    expect(await s.writeReferrerMonth(referrers("2026-09"))).toBe(true);
    expect(await s.writeReleases(releases)).toBe(true);
    expect(await s.writeGrowth(growth)).toBe(false);

    expect(await s.readGrowth(42)).toEqual(growth);
    expect(await s.readReferrerMonth(42, "2026-09")).toEqual(referrers("2026-09"));
    expect(await s.readReferrerMonth(42, "2026-11")).toBeUndefined();
    expect(await s.readLatestReferrerMonth(42)).toEqual(referrers("2026-10"));
    expect(await s.readReleases(42)).toEqual(releases);
    expect((await stat(join(root, "data/referrers/42/2026-10.json"))).isFile()).toBe(true);
    expect((await stat(join(root, "data/growth/42.json"))).isFile()).toBe(true);
    expect((await stat(join(root, "data/releases/42.json"))).isFile()).toBe(true);
  });

  it("returns false and leaves mtime alone on identical content", async () => {
    const s = createStore(root);
    expect(await s.writeMonthFile(month("2026-09"))).toBe(true);
    const path = join(root, "data/traffic/42/2026-09.json");
    const before = (await stat(path)).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    expect(await s.writeMonthFile(month("2026-09"))).toBe(false);
    expect((await stat(path)).mtimeMs).toBe(before);
    expect(await s.writeTextFile("a.txt", "x")).toBe(true);
    expect(await s.writeTextFile("a.txt", "x")).toBe(false);
    expect(await s.writeTextFile("a.txt", "y")).toBe(true);
  });

  it("throws on malformed JSON instead of treating it as empty", async () => {
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data/index.json"), "{oops");
    await expect(createStore(root).readIndex()).rejects.toThrow(/Malformed JSON/);
  });
});
