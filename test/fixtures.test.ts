import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
const readJson = (rel: string): any => JSON.parse(readFileSync(join(root, rel), 'utf8'));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('API traffic fixtures', () => {
  for (const [file, key] of [
    ['api/traffic-views.json', 'views'],
    ['api/traffic-clones.json', 'clones'],
  ] as const) {
    it(`${file} has 14 contiguous UTC days with a zero day`, () => {
      const f = readJson(file);
      const entries: { timestamp: string; count: number; uniques: number }[] = f[key];
      expect(entries).toHaveLength(14);
      entries.forEach((e, i) => {
        expect(e.timestamp).toBe(`2026-10-${12 + i}T00:00:00Z`);
        expect(e.uniques).toBeLessThanOrEqual(e.count);
      });
      expect(entries.filter((e) => e.count === 0).length).toBeGreaterThanOrEqual(2);
      expect(f.count).toBe(entries.reduce((s, e) => s + e.count, 0));
    });
  }
});

describe('demo store', () => {
  const ids = ['100001', '100002', '100003'];
  const gap = ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'];

  it('has sorted date keys and the shared gap', () => {
    for (const id of ids) {
      const keys: string[] = [];
      for (const m of ['2026-09', '2026-10']) {
        const f = readJson(`demo/data/traffic/${id}/${m}.json`);
        const k = Object.keys(f.days);
        expect(k).toEqual([...k].sort());
        k.forEach((d) => expect(d.startsWith(m)).toBe(true));
        keys.push(...k);
      }
      for (const g of gap) expect(keys).not.toContain(g);
      expect(keys[0]).toBe('2026-09-20');
    }
  });

  it('forbidden repo has no days after 2026-10-09; others reach 2026-10-25', () => {
    const last = (id: string) => Object.keys(readJson(`demo/data/traffic/${id}/2026-10.json`).days).at(-1);
    expect(last('100001')).toBe('2026-10-25');
    expect(last('100002')).toBe('2026-10-25');
    expect(last('100003')).toBe('2026-10-09');
    expect(readJson('demo/data/status.json').repositories['100003'].lastError).toEqual({
      kind: 'forbidden',
      date: '2026-10-10',
    });
  });

  it('has zero days and unique <= total', () => {
    let zeros = 0;
    for (const id of ids) {
      for (const m of ['2026-09', '2026-10']) {
        for (const d of Object.values<any>(readJson(`demo/data/traffic/${id}/${m}.json`).days)) {
          expect(d.uniqueViews).toBeLessThanOrEqual(d.views);
          expect(d.uniqueCloners).toBeLessThanOrEqual(d.clones);
          if (d.views === 0) zeros++;
        }
      }
    }
    expect(zeros).toBeGreaterThan(0);
  });
});

describe('fixture hygiene', () => {
  it('contains no timestamps except API timestamp fields', () => {
    for (const file of walk(root).filter((p) => p.endsWith('.json'))) {
      const text = readFileSync(file, 'utf8').replace(/"(timestamp|created_at|published_at)": "[^"]*"/g, '');
      expect(text, file).not.toMatch(/T\d\d:\d\d/);
    }
  });
});
