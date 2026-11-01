import { describe, expect, it } from "vitest";
import type { ReleaseItem } from "../../src/collector/extras-api.js";
import {
  countByDate,
  countStarHistory,
  isCountedAsset,
  sortPaths,
  sortReferrers,
  summarizeReleases,
} from "../../src/collector/extras-normalize.js";

describe("countByDate", () => {
  it("buckets by UTC date, including offsets that cross midnight", () => {
    expect(
      countByDate([
        "2026-10-01T23:59:59Z",
        "2026-10-02T00:00:00Z",
        "2026-10-02T08:30:00+09:00", // 2026-10-01T23:30Z
        "2026-10-02T12:00:00Z",
      ]),
    ).toEqual({ "2026-10-01": 2, "2026-10-02": 2 });
    expect(countByDate([])).toEqual({});
  });
});

describe("countStarHistory", () => {
  const SUN_OCT_25 = 1792886400; // 2026-10-25T00:00:00Z
  const SUN_OCT_18 = SUN_OCT_25 - 7 * 86_400;

  it("dates day i as the week's UTC date plus i days and omits days without stars", () => {
    expect(countStarHistory([{ week: SUN_OCT_25, days: [1, 0, 3, 1, 0, 0, 2] }])).toEqual({
      "2026-10-25": 1,
      "2026-10-27": 3,
      "2026-10-28": 1,
      "2026-10-31": 2,
    });
  });

  it("concatenates weeks from several pages, crossing a month boundary", () => {
    const SUN_SEP_27 = SUN_OCT_25 - 4 * 7 * 86_400;
    const page1 = [
      { week: SUN_OCT_25, days: [0, 0, 0, 0, 0, 0, 1] },
      { week: SUN_OCT_18, days: [0, 0, 0, 0, 0, 0, 0] },
    ];
    const page2 = [{ week: SUN_SEP_27, days: [2, 0, 0, 0, 1, 0, 0] }];
    expect(countStarHistory([...page1, ...page2])).toEqual({
      "2026-09-27": 2,
      "2026-10-01": 1,
      "2026-10-31": 1,
    });
  });

  it("returns nothing for empty or all-zero history", () => {
    expect(countStarHistory([])).toEqual({});
    expect(countStarHistory([{ week: SUN_OCT_25, days: [0, 0, 0, 0, 0, 0, 0] }])).toEqual({});
  });
});

describe("sorting", () => {
  it("orders referrers by count desc, then name asc", () => {
    const sorted = sortReferrers([
      { referrer: "news.ycombinator.com", count: 12, uniques: 10 },
      { referrer: "github.com", count: 64, uniques: 21 },
      { referrer: "Google", count: 12, uniques: 9 },
    ]);
    expect(sorted.map((r) => r.referrer)).toEqual(["github.com", "Google", "news.ycombinator.com"]);
  });

  it("orders paths by count desc, then path asc", () => {
    const sorted = sortPaths([
      { path: "/o/r/releases", title: "R", count: 18, uniques: 9 },
      { path: "/o/r", title: "Home", count: 140, uniques: 52 },
      { path: "/o/r/blob/main/README.md", title: "Readme", count: 18, uniques: 7 },
    ]);
    expect(sorted.map((p) => p.path)).toEqual(["/o/r", "/o/r/blob/main/README.md", "/o/r/releases"]);
  });
});

describe("isCountedAsset", () => {
  it.each([
    "latest.yml",
    "latest-mac.yml",
    "latest-linux.YAML",
    "app.exe.sig",
    "app.tar.gz.asc",
    "app.dmg.blockmap",
    "app.zip.sha256",
    "app.zip.sha1",
    "app.zip.SHA512",
    "app.zip.md5",
    "latest.json",
    "latest-linux-arm64.yml",
    "app.zip.minisig",
    "checksums.txt",
    "sample-cli_2.0.0_checksums.txt",
    "SHA256SUMS",
    "SHA256SUMS.txt",
    "sha512sums",
    "MD5SUMS",
  ])("excludes %s", (name) => {
    expect(isCountedAsset(name)).toBe(false);
  });

  it.each(["app-1.0.0-x64.exe", "app.dmg", "app_linux_amd64.tar.gz", "app.AppImage", "notes.txt", "jsonfmt.zip", "dataset.json", "rules.yaml", "manifest.json", "latest-notes.txt"])(
    "counts %s",
    (name) => {
      expect(isCountedAsset(name)).toBe(true);
    },
  );
});

describe("summarizeReleases", () => {
  const release = (over: Partial<ReleaseItem>): ReleaseItem => ({
    id: 1,
    tag: "v1",
    name: "One",
    draft: false,
    publishedAt: "2026-10-01T12:00:00Z",
    assets: [],
    ...over,
  });

  it("drops drafts, keeps prereleases, sums counted assets and dates in UTC", () => {
    const summary = summarizeReleases([
      release({ id: 4, draft: true, publishedAt: null, assets: [{ name: "a.dmg", downloadCount: 3 }] }),
      release({
        id: 3,
        tag: "v2-beta",
        name: "Beta",
        publishedAt: "2026-10-20T23:30:00-02:00",
        assets: [
          { name: "a.dmg", downloadCount: 15 },
          { name: "latest-mac.yml", downloadCount: 300 },
        ],
      }),
      release({ id: 1, name: null, publishedAt: null }),
    ]);
    expect(summary).toEqual({
      releases: {
        "3": { tag: "v2-beta", name: "Beta", publishedDate: "2026-10-21" },
        "1": { tag: "v1", name: "", publishedDate: null },
      },
      downloads: { "3": 15, "1": 0 },
      hasCountedAssets: true,
    });
  });

  it("reports no counted assets when only metadata or drafts have them", () => {
    const summary = summarizeReleases([
      release({ id: 2, draft: true, assets: [{ name: "a.dmg", downloadCount: 3 }] }),
      release({ id: 1, assets: [{ name: "latest.yml", downloadCount: 50 }] }),
    ]);
    expect(summary.hasCountedAssets).toBe(false);
    expect(summary.downloads).toEqual({ "1": 0 });
    expect(summarizeReleases([]).hasCountedAssets).toBe(false);
  });
});
