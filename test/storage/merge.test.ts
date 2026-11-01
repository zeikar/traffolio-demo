import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stableStringify } from "../../src/storage/json.js";
import { upsertDays } from "../../src/storage/merge.js";
import type { DayMetrics } from "../../src/types.js";

const m = (n: number): DayMetrics => ({ views: n, uniqueViews: n, clones: n, uniqueCloners: n });

function window(): Record<string, DayMetrics> {
  const days: Record<string, DayMetrics> = {};
  const start = Date.UTC(2026, 8, 28);
  for (let i = 0; i < 14; i++) {
    days[new Date(start + i * 86400000).toISOString().slice(0, 10)] = m(i + 1);
  }
  return days;
}

describe("upsertDays", () => {
  it("is idempotent", () => {
    const once = upsertDays([], 1, window());
    expect(upsertDays(once, 1, window())).toEqual(once);
  });

  it("overwrites rather than sums", () => {
    const once = upsertDays([], 1, window());
    const twice = upsertDays(once, 1, { "2026-10-01": m(99) });
    expect(twice[1]!.days["2026-10-01"]).toEqual(m(99));
  });

  it("splits 2026-09-28..2026-10-11 into two month files", () => {
    const files = upsertDays([], 7, window());
    expect(files.map((f) => f.month)).toEqual(["2026-09", "2026-10"]);
    expect(Object.keys(files[0]!.days)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(Object.keys(files[1]!.days)).toHaveLength(11);
    expect(files[0]).toMatchObject({ schemaVersion: 1, repositoryId: 7 });
  });

  it("keeps keys outside the window and untouched months, without mutating input", () => {
    const existing = upsertDays([], 1, { "2026-08-15": m(5), "2026-09-01": m(6) });
    const snapshot = structuredClone(existing);
    const out = upsertDays(existing, 1, window());
    expect(existing).toEqual(snapshot);
    expect(out.map((f) => f.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(out[0]!.days["2026-08-15"]).toEqual(m(5));
    expect(out[1]!.days["2026-09-01"]).toEqual(m(6));
    expect(Object.keys(out[1]!.days)[0]).toBe("2026-09-01");
  });
});

describe("stableStringify", () => {
  it("is byte-identical regardless of key order", () => {
    const a = { b: 1, a: { y: 1, x: [{ q: 1, p: 2 }] } };
    const b = { a: { x: [{ p: 2, q: 1 }], y: 1 }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a).endsWith("}\n")).toBe(true);
  });

  it("reproduces a demo month file byte-for-byte", () => {
    const path = new URL("../../fixtures/demo/data/traffic/100001/2026-09.json", import.meta.url);
    const text = readFileSync(path, "utf8");
    expect(stableStringify(JSON.parse(text))).toBe(text);
  });
});
