import { describe, expect, it } from "vitest";
import { parseConfig } from "../../src/collector/config.js";
import { checkPublicMode, listsPrivateRepository } from "../../src/collector/public-mode.js";
import type { IndexEntry, IndexFile } from "../../src/types.js";

const config = (yaml = "") => parseConfig(`public_mode: true\n${yaml}`);

function index(...entries: Partial<IndexEntry>[]): IndexFile {
  const repositories: Record<string, IndexEntry> = {};
  entries.forEach((over, i) => {
    repositories[String(i + 1)] = {
      name: `r${i}`,
      fullName: `me/r${i}`,
      private: false,
      fork: false,
      archived: false,
      stars: 0,
      forks: 0,
      tracking: "tracked",
      ...over,
    };
  });
  return { schemaVersion: 1, repositories };
}

describe("listsPrivateRepository", () => {
  it("is true only when an entry is private", () => {
    expect(listsPrivateRepository(undefined)).toBe(false);
    expect(listsPrivateRepository(index({}, { tracking: "missing" }))).toBe(false);
    expect(listsPrivateRepository(index({}, { private: true }))).toBe(true);
  });
});

describe("checkPublicMode", () => {
  it("passes with the defaults and no or only public stored data", () => {
    expect(checkPublicMode(config(), undefined)).toBeUndefined();
    expect(checkPublicMode(config(), index({}, { tracking: "missing" }))).toBeUndefined();
  });

  it("rejects include_private as a config error", () => {
    const violation = checkPublicMode(config("repositories:\n  include_private: true\n"), undefined);
    expect(violation).toEqual({ reason: "config", message: expect.stringContaining("include_private cannot be used with public_mode") });
  });

  it("rejects stored data that contains a private repository, whatever its tracking", () => {
    for (const tracking of ["tracked", "missing", "excluded:private"] as const) {
      const violation = checkPublicMode(config(), index({}, { private: true, tracking }));
      expect(violation?.reason).toBe("public_private_data");
      expect(violation?.message).toContain("already contains data about private repositories");
      expect(violation?.message).toContain("nothing was written");
    }
  });
});
