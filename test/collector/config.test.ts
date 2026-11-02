import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseConfig } from "../../src/collector/config.js";

const defaults = {
  repositories: {
    include: ["*"],
    exclude: [],
    include_private: false,
    include_forks: false,
    include_archived: false,
    include_self: false,
  },
  public_mode: false,
  pages: false,
};

describe("parseConfig", () => {
  it("applies defaults for a minimal file", () => {
    expect(parseConfig("repositories: {}\n")).toEqual(defaults);
  });

  it("applies defaults for an empty file or missing repositories", () => {
    expect(parseConfig("")).toEqual(defaults);
    expect(parseConfig("{}")).toEqual(defaults);
  });

  it("rejects an unknown nested key, naming its path", () => {
    expect(() => parseConfig("repositories:\n  includ: ['a']\n")).toThrow(
      /repositories\.includ/,
    );
  });

  it("rejects an unknown top-level key", () => {
    expect(() => parseConfig("repos: {}\n")).toThrow(ConfigError);
  });

  it("rejects wrong types, naming the path", () => {
    expect(() => parseConfig("repositories:\n  include_forks: 'yes'\n")).toThrow(
      /repositories\.include_forks/,
    );
    expect(() => parseConfig("repositories:\n  include: '*'\n")).toThrow(ConfigError);
  });

  it("parses include: [] (selects nothing)", () => {
    expect(parseConfig("repositories:\n  include: []\n").repositories.include).toEqual([]);
  });

  it("parses public_mode and rejects a non-boolean", () => {
    expect(parseConfig("public_mode: true\n").public_mode).toBe(true);
    expect(() => parseConfig("public_mode: 'yes'\n")).toThrow(/public_mode/);
  });

  it("parses pages and rejects a non-boolean", () => {
    expect(parseConfig("pages: true\n").pages).toBe(true);
    expect(() => parseConfig("pages: 'yes'\n")).toThrow(/pages/);
  });

  it("surfaces YAML syntax errors as ConfigError", () => {
    expect(() => parseConfig("repositories: [unclosed")).toThrow(ConfigError);
  });
});

describe("loadConfig", () => {
  it("reports a missing file clearly", async () => {
    await expect(loadConfig("/nonexistent/traffolio.config.yml")).rejects.toThrow(
      /not found/,
    );
  });

  // Only that it parses: instances edit this file, so its values can't be asserted here.
  it("parses the repository's traffolio.config.yml", async () => {
    const config = await loadConfig("traffolio.config.yml");
    expect(parseConfig(await readFile("traffolio.config.yml", "utf8"))).toEqual(config);
  });
});
