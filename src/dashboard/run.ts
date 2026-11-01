import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type DayMap, daysFromMonthFiles } from "../reporter/aggregate.js";
import { createStore } from "../storage/store.js";
import type { GrowthFile, ReferrerMonthFile, ReleasesFile } from "../types.js";
import { renderDashboardHtml } from "./html.js";

export interface DashboardIo {
  cwd: string;
  log: (line: string) => void;
  error: (line: string) => void;
}

const USAGE = "usage: node dist/cli/dashboard.js [--data <rootDir>] [--out <file>]";

function parseArgs(argv: string[]): { data?: string; out?: string; help?: true } | string {
  const args: { data?: string; out?: string; help?: true } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else if (arg === "--data" || arg === "--out") {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) return `${arg} needs a value`;
      args[arg === "--data" ? "data" : "out"] = value;
    } else {
      return `unknown argument: ${arg}`;
    }
  }
  return args;
}

/**
 * Reads the store under `--data` (default: cwd) and writes the self-contained
 * HTML to `--out` (default: <rootDir>/dashboard.html). Returns the exit code.
 */
export async function runDashboard(argv: string[], io: DashboardIo): Promise<number> {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.error(args);
    io.error(USAGE);
    return 1;
  }
  if (args.help) {
    io.log(USAGE);
    return 0;
  }

  const rootDir = resolve(io.cwd, args.data ?? ".");
  const out = args.out === undefined ? join(rootDir, "dashboard.html") : resolve(io.cwd, args.out);
  const store = createStore(rootDir);
  const index = await store.readIndex();
  const status = await store.readStatus();
  if (!index || !status) {
    io.error(`no data yet — run a collection first (no data/index.json or data/status.json in ${rootDir})`);
    return 1;
  }

  const days: Record<string, DayMap> = {};
  const growth: Record<string, GrowthFile> = {};
  const referrers: Record<string, ReferrerMonthFile> = {};
  const releases: Record<string, ReleasesFile> = {};
  for (const id of Object.keys(index.repositories)) {
    days[id] = daysFromMonthFiles(await store.readMonthFiles(id));
    const g = await store.readGrowth(id);
    if (g) growth[id] = g;
    const r = await store.readLatestReferrerMonth(id);
    if (r) referrers[id] = r;
    const rel = await store.readReleases(id);
    if (rel) releases[id] = rel;
  }
  const html = renderDashboardHtml({ index, status, days, growth, referrers, releases, source: join(rootDir, "data") });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, html, "utf8");
  io.log(pathToFileURL(out).href);
  return 0;
}
