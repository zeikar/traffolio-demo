import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { GrowthFile, IndexFile, MonthFile, ReferrerMonthFile, ReleasesFile, StatusFile } from "../types.js";
import { stableStringify } from "./json.js";

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export interface Store {
  readMonthFiles(repoId: number | string): Promise<MonthFile[]>;
  writeMonthFile(file: MonthFile): Promise<boolean>;
  readIndex(): Promise<IndexFile | undefined>;
  writeIndex(index: IndexFile): Promise<boolean>;
  readStatus(): Promise<StatusFile | undefined>;
  writeStatus(status: StatusFile): Promise<boolean>;
  readGrowth(repoId: number | string): Promise<GrowthFile | undefined>;
  writeGrowth(file: GrowthFile): Promise<boolean>;
  readReferrerMonth(repoId: number | string, month: string): Promise<ReferrerMonthFile | undefined>;
  /** The newest month file of a repo, if any. */
  readLatestReferrerMonth(repoId: number | string): Promise<ReferrerMonthFile | undefined>;
  writeReferrerMonth(file: ReferrerMonthFile): Promise<boolean>;
  readReleases(repoId: number | string): Promise<ReleasesFile | undefined>;
  writeReleases(file: ReleasesFile): Promise<boolean>;
  readTextFile(relPath: string): Promise<string | undefined>;
  writeTextFile(relPath: string, text: string): Promise<boolean>;
}

export function createStore(rootDir: string): Store {
  async function readText(relPath: string): Promise<string | undefined> {
    try {
      return await readFile(join(rootDir, relPath), "utf8");
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  /** Writes only when bytes differ; returns whether the file changed. */
  async function writeIfChanged(relPath: string, text: string): Promise<boolean> {
    if ((await readText(relPath)) === text) return false;
    const path = join(rootDir, relPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, "utf8");
    return true;
  }

  async function readJson<T>(relPath: string): Promise<T | undefined> {
    const text = await readText(relPath);
    if (text === undefined) return undefined;
    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new Error(`Malformed JSON in ${relPath}: ${(err as Error).message}`);
    }
  }

  /** `YYYY-MM.json` names in `dir`, sorted; empty when the directory does not exist. */
  async function monthFileNames(dir: string): Promise<string[]> {
    let names: string[];
    try {
      names = await readdir(join(rootDir, dir));
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
    return names.filter((n) => /^\d{4}-\d{2}\.json$/.test(n)).sort();
  }

  return {
    async readMonthFiles(repoId) {
      const dir = `data/traffic/${repoId}`;
      const files: MonthFile[] = [];
      for (const name of await monthFileNames(dir)) {
        const file = await readJson<MonthFile>(`${dir}/${name}`);
        if (file) files.push(file);
      }
      return files;
    },
    writeMonthFile(file) {
      return writeIfChanged(
        `data/traffic/${file.repositoryId}/${file.month}.json`,
        stableStringify(file),
      );
    },
    readIndex: () => readJson<IndexFile>("data/index.json"),
    writeIndex: (index) => writeIfChanged("data/index.json", stableStringify(index)),
    readStatus: () => readJson<StatusFile>("data/status.json"),
    writeStatus: (status) => writeIfChanged("data/status.json", stableStringify(status)),
    readGrowth: (repoId) => readJson<GrowthFile>(`data/growth/${repoId}.json`),
    writeGrowth: (file) => writeIfChanged(`data/growth/${file.repositoryId}.json`, stableStringify(file)),
    readReferrerMonth: (repoId, month) => readJson<ReferrerMonthFile>(`data/referrers/${repoId}/${month}.json`),
    async readLatestReferrerMonth(repoId) {
      const latest = (await monthFileNames(`data/referrers/${repoId}`)).at(-1);
      return latest === undefined ? undefined : readJson<ReferrerMonthFile>(`data/referrers/${repoId}/${latest}`);
    },
    writeReferrerMonth: (file) =>
      writeIfChanged(`data/referrers/${file.repositoryId}/${file.month}.json`, stableStringify(file)),
    readReleases: (repoId) => readJson<ReleasesFile>(`data/releases/${repoId}.json`),
    writeReleases: (file) => writeIfChanged(`data/releases/${file.repositoryId}.json`, stableStringify(file)),
    readTextFile: readText,
    writeTextFile: writeIfChanged,
  };
}
