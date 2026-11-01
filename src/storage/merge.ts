import type { DayMetrics, MonthFile } from "../types.js";

function sortDays(days: Record<string, DayMetrics>): Record<string, DayMetrics> {
  const out: Record<string, DayMetrics> = {};
  for (const date of Object.keys(days).sort()) out[date] = days[date]!;
  return out;
}

/**
 * Overwrites the given dates (never sums) and leaves all other dates intact.
 * Returns every month file for the repository, sorted by month. Pure.
 */
export function upsertDays(
  existing: MonthFile[],
  repositoryId: number,
  days: Record<string, DayMetrics>,
): MonthFile[] {
  const byMonth = new Map<string, MonthFile>();
  for (const file of existing) {
    byMonth.set(file.month, { ...file, days: { ...file.days } });
  }
  for (const [date, metrics] of Object.entries(days)) {
    const month = date.slice(0, 7);
    let file = byMonth.get(month);
    if (!file) {
      file = { schemaVersion: 1, repositoryId, month, days: {} };
      byMonth.set(month, file);
    }
    file.days[date] = { ...metrics };
  }
  return [...byMonth.values()]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map((f) => ({ ...f, days: sortDays(f.days) }));
}
