import type { RepoSeriesPoint, SeriesPoint } from "./aggregate.js";

/** Series a chart line can show; each has a light and a dark color in THEME. */
export type LineKey = "views" | "uniqueViews" | "clones" | "uniqueCloners" | "stars";

export interface ChartLine {
  /** Picks the themed color and the path's class: `class="line <key>"`. */
  key: LineKey;
  label: string;
  /** One value per date; `null` is a missing day and breaks the line. */
  values: (number | null)[];
  dashed?: boolean;
  /** Soft fill under the line, for the chart's main series. */
  area?: boolean;
}

export interface ChartSpec {
  /** Small heading, e.g. "Views · last 30 days". */
  title: string;
  /** Big number under the title (a period total or a latest total); not shown without data. */
  headline: number;
  /** The headline total has missing or partial days: marked `*`, like the README table. */
  incomplete?: boolean;
  dates: string[];
  lines: ChartLine[];
  /** Per date: some tracked repos have no data. Omit for charts without partial days. */
  partial?: boolean[];
  /** Top right, e.g. "Data through 2026-10-25 (UTC)". */
  asOf: string;
  /** Bottom right context, e.g. "Daily totals across tracked repos". */
  note?: string;
  emptyText: string;
  /** Adds a `SAMPLE DATA` banner (demo output). */
  sampleLabel: boolean;
}

const WIDTH = 800;
const HEIGHT = 320;
const PLOT = { left: 64, right: 776, top: 100, bottom: 250 };
const LEGEND_Y = 296;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// GitHub shows these SVGs through <img>. Chromium and Firefox evaluate the media
// query against the <img>'s color-scheme, which GitHub sets from the viewer's
// theme; Safari uses the OS setting. Either way the card draws its own
// background, so text stays legible. Base colors match the local dashboard's tokens.
const LIGHT =
  "--surface:#ffffff;--border:#d0d7de;--text:#1f2328;--muted:#59636e;--grid:#eaeef2;--axis:#8c959f;" +
  "--views:#0969da;--uniqueViews:#54aeff;--clones:#bc4c00;--uniqueCloners:#fb8f44;--stars:#bf8700;" +
  "--warn:#7d4e00;--warn-bg:#fff8c5;--warn-border:#d4a72c";
const DARK =
  "--surface:#151b23;--border:#3d444d;--text:#f0f6fc;--muted:#9198a1;--grid:#262c36;--axis:#656c76;" +
  "--views:#4493f8;--uniqueViews:#1f6feb;--clones:#f0883e;--uniqueCloners:#bd561d;--stars:#e3b341;" +
  "--warn:#d29922;--warn-bg:rgba(187,128,9,.15);--warn-border:rgba(187,128,9,.45)";
const LINE_KEYS: LineKey[] = ["views", "uniqueViews", "clones", "uniqueCloners", "stars"];

/** Light card where a renderer drops `var()` declarations; the .card rule overrides it in browsers. */
export const CARD_FALLBACK = 'fill="#ffffff" stroke="#d0d7de"';

/** Theme variables plus the classes every Traffolio SVG uses; system fonts only (no external resources). */
export const THEME =
  `svg{${LIGHT}}@media (prefers-color-scheme:dark){svg{${DARK}}}` +
  ".card{fill:var(--surface);stroke:var(--border)}" +
  ".grid{stroke:var(--grid)}.axis{stroke:var(--axis)}" +
  LINE_KEYS.map((key) => `.k-${key}{color:var(--${key})}`).join("");

const STYLE =
  THEME +
  "text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;fill:var(--muted);font-size:11px}" +
  ".title{font-size:13px}" +
  ".headline{font-size:28px;font-weight:600;fill:var(--text)}" +
  ".partial{fill:var(--surface)}.partial-key{fill:var(--surface);stroke:var(--muted)}" +
  ".banner-box{fill:var(--warn-bg);stroke:var(--warn-border)}" +
  ".banner{font-size:11px;font-weight:700;fill:var(--warn);letter-spacing:1px}" +
  ".empty{font-size:14px}";

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Integer coordinates keep the output byte-stable and small; sub-pixel precision is invisible. */
const n = (value: number): string => String(Math.round(value));

const groupDigits = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function shortDate(date: string): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1];
  return month === undefined ? date : `${month} ${Number(date.slice(8, 10))}`;
}

/** Smallest 1/2/5×10^k step giving at most 4 intervals; max 0 still gets a 0–4 axis. */
function yScale(maxValue: number): { max: number; step: number } {
  const raw = Math.max(maxValue, 4) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  return { step, max: step * Math.ceil(Math.max(maxValue, 4) / step) };
}

function text(x: number, y: number, content: string, attrs = ""): string {
  return `<text x="${n(x)}" y="${n(y)}"${attrs}>${escapeXml(content)}</text>`;
}

const headlineText = (spec: ChartSpec): string => groupDigits(spec.headline) + (spec.incomplete ? "*" : "");

function header(spec: ChartSpec, withHeadline: boolean): string[] {
  const parts = [
    text(24, 32, spec.title, ' class="title"'),
    text(PLOT.right, 32, spec.asOf, ' text-anchor="end"'),
  ];
  if (withHeadline) parts.push(text(24, 70, headlineText(spec), ' class="headline"'));
  if (spec.sampleLabel) {
    parts.push(
      `<rect class="banner-box" x="660" y="46" width="116" height="24" rx="6"/>`,
      text(718, 62, "SAMPLE DATA", ' class="banner" text-anchor="middle"'),
    );
  }
  return parts;
}

/** Bottom row: line keys (only when there's more than one line), the partial-day and `*` keys, and the note. */
function footer(lines: ChartLine[], showPartial: boolean, incomplete: boolean, note: string | undefined): string[] {
  const y = LEGEND_Y;
  const parts: string[] = [];
  let x = 24;
  if (lines.length > 1) {
    for (const line of lines) {
      const dash = line.dashed ? ' stroke-dasharray="4 3"' : "";
      parts.push(
        `<line class="k-${line.key}" x1="${n(x)}" y1="${n(y)}" x2="${n(x + 18)}" y2="${n(y)}" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"${dash}/>`,
        text(x + 24, y + 4, line.label),
      );
      x += 40 + line.label.length * 6;
    }
  }
  if (showPartial) {
    parts.push(
      `<circle class="partial-key" cx="${n(x + 5)}" cy="${n(y)}" r="3.5" stroke-width="1.5"/>`,
      text(x + 14, y + 4, "partial day"),
    );
    x += 90;
  }
  if (incomplete) parts.push(text(x, y + 4, "* total has missing or partial days"));
  if (note !== undefined) parts.push(text(PLOT.right, y + 4, note, ' text-anchor="end"'));
  return parts;
}

function axes(): string[] {
  return [
    `<line class="axis" x1="${n(PLOT.left)}" y1="${n(PLOT.top)}" x2="${n(PLOT.left)}" y2="${n(PLOT.bottom)}" stroke-width="1"/>`,
    `<line class="axis" x1="${n(PLOT.left)}" y1="${n(PLOT.bottom)}" x2="${n(PLOT.right)}" y2="${n(PLOT.bottom)}" stroke-width="1"/>`,
  ];
}

function svgDocument(label: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
    `<style>${STYLE}</style>`,
    `<rect class="card" x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="8" ${CARD_FALLBACK}/>`,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

function valueRuns(values: (number | null)[]): number[][] {
  const result: number[][] = [];
  let current: number[] = [];
  values.forEach((value, i) => {
    if (value === null) {
      if (current.length > 0) result.push(current);
      current = [];
    } else {
      current.push(i);
    }
  });
  if (current.length > 0) result.push(current);
  return result;
}

/** Contiguous runs of indices whose value for `key` is non-null. */
export function runs(series: SeriesPoint[], key: "views" | "clones"): number[][] {
  return valueRuns(series.map((point) => point[key]));
}

/**
 * Generic single-axis line chart. Each contiguous run of non-null days is its
 * own `M…L…` subpath so missing days show as a break, never as 0. An isolated
 * day is a zero-length `L` (dot via round caps) plus a filled `circle.solo`
 * so it stays visible in renderers that drop zero-length segments.
 */
export function renderChartSvg(spec: ChartSpec): string {
  const { dates, lines } = spec;
  const allValues = lines.flatMap((line) => line.values.filter((v) => v !== null));

  if (dates.length === 0 || allValues.length === 0) {
    return svgDocument(`Traffolio: ${spec.title} — ${spec.emptyText.toLowerCase()}`, [
      ...header(spec, false),
      ...axes(),
      text(
        (PLOT.left + PLOT.right) / 2,
        (PLOT.top + PLOT.bottom) / 2,
        spec.emptyText,
        ' class="empty" text-anchor="middle"',
      ),
      ...footer([], false, false, spec.note),
    ]);
  }

  const { max, step } = yScale(Math.max(...allValues));
  const plotWidth = PLOT.right - PLOT.left;
  const xAt = (i: number): number =>
    dates.length === 1
      ? PLOT.left + plotWidth / 2
      : PLOT.left + (i * plotWidth) / (dates.length - 1);
  const yAt = (v: number): number => PLOT.bottom - (v / max) * (PLOT.bottom - PLOT.top);

  const grid: string[] = [];
  for (let v = 0; v <= max; v += step) {
    const y = yAt(v);
    if (v > 0) {
      grid.push(
        `<line class="grid" x1="${n(PLOT.left)}" y1="${n(y)}" x2="${n(PLOT.right)}" y2="${n(y)}" stroke-width="1"/>`,
      );
    }
    grid.push(text(PLOT.left - 8, y + 4, groupDigits(v), ' text-anchor="end"'));
  }

  const tickEvery = dates.length <= 35 ? 7 : 14;
  const xTicks: string[] = [];
  for (let i = 0; i < dates.length; i += tickEvery) {
    const x = xAt(i);
    xTicks.push(
      `<line class="axis" x1="${n(x)}" y1="${n(PLOT.bottom)}" x2="${n(x)}" y2="${n(PLOT.bottom + 4)}" stroke-width="1"/>`,
      text(x, PLOT.bottom + 18, shortDate(dates[i]!), ' text-anchor="middle"'),
    );
  }

  const paths: string[] = [];
  const markers: string[] = [];
  let partialShown = false;
  for (const line of lines) {
    const value = (i: number): number => line.values[i]!;
    const point = (i: number): string => `${n(xAt(i))} ${n(yAt(value(i)))}`;
    const lineMarkers: string[] = [];
    const areas: string[] = [];
    const subpaths = valueRuns(line.values).map((run) => {
      const [first, ...rest] = run.map(point);
      if (run.length === 1) {
        const i = run[0]!;
        lineMarkers.push(
          `<circle class="solo" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="2.5" fill="currentColor"/>`,
        );
        return `M${first} L${first}`;
      }
      const base = n(PLOT.bottom);
      areas.push(
        `M${n(xAt(run[0]!))} ${base} ${run.map((i) => `L${point(i)}`).join(" ")} L${n(xAt(run[run.length - 1]!))} ${base} Z`,
      );
      return `M${first} ${rest.map((p) => `L${p}`).join(" ")}`;
    });
    spec.partial?.forEach((isPartial, i) => {
      if (!isPartial || line.values[i] === null || line.values[i] === undefined) return;
      partialShown = true;
      lineMarkers.push(
        `<circle class="partial" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="3.5" stroke="currentColor" stroke-width="1.5"/>`,
      );
    });

    const group: string[] = [];
    if (line.area && areas.length > 0) {
      // currentColor in the stops resolves against the gradient's parent, this group.
      group.push(
        `<linearGradient id="fill-${line.key}" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="currentColor" stop-opacity="0.22"/>` +
          `<stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient>`,
        `<path class="area" d="${areas.join(" ")}" fill="url(#fill-${line.key})"/>`,
      );
    }
    const dash = line.dashed ? ' stroke-dasharray="4 3"' : "";
    group.push(
      `<path class="line ${line.key}" d="${subpaths.join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash}/>`,
    );
    paths.push(`<g class="k-${line.key}">`, ...group, "</g>");
    if (lineMarkers.length > 0) markers.push(`<g class="k-${line.key}">`, ...lineMarkers, "</g>");
  }

  return svgDocument(`Traffolio: ${spec.title}: ${headlineText(spec)}. ${spec.asOf}`, [
    ...header(spec, true),
    ...grid,
    ...axes(),
    ...xTicks,
    ...paths,
    ...markers,
    ...footer(lines, partialShown, spec.incomplete === true, spec.note),
  ]);
}

const sum = (values: (number | null)[]): number => values.reduce<number>((total, v) => total + (v ?? 0), 0);

function asOf(dates: string[]): string {
  const last = dates[dates.length - 1];
  return last === undefined ? "Dates in UTC" : `Data through ${last} (UTC)`;
}

function readmeChart(
  series: SeriesPoint[],
  key: "views" | "clones",
  label: string,
  incomplete: boolean,
  sampleLabel: boolean,
): string {
  const dates = series.map((p) => p.date);
  const values = series.map((p) => p[key]);
  return renderChartSvg({
    title: `${label} · last 30 days`,
    headline: sum(values),
    incomplete,
    dates,
    lines: [{ key, label, values, area: true }],
    partial: series.map((p) => p.partial),
    asOf: asOf(dates),
    note: "Daily totals across tracked repos",
    emptyText: "No traffic data stored yet",
    sampleLabel,
  });
}

/** `incomplete`: the 30-day total has missing or partial days (`isIncomplete` of the 30d period). */
export function viewsChart(series: SeriesPoint[], incomplete: boolean, sampleLabel: boolean): string {
  return readmeChart(series, "views", "Views", incomplete, sampleLabel);
}

export function clonesChart(series: SeriesPoint[], incomplete: boolean, sampleLabel: boolean): string {
  return readmeChart(series, "clones", "Clones", incomplete, sampleLabel);
}

type Series<K extends LineKey> = { key: K; label: string };

function repoChart(
  points: RepoSeriesPoint[],
  [main, unique]: [Series<"views" | "clones">, Series<"uniqueViews" | "uniqueCloners">],
  incomplete: boolean,
  sampleLabel: boolean,
): string {
  const dates = points.map((p) => p.date);
  const values = points.map((p) => p[main.key]);
  return renderChartSvg({
    title: `${main.label} · last 90 days`,
    headline: sum(values),
    incomplete,
    dates,
    lines: [
      { ...main, values, area: true },
      { ...unique, values: points.map((p) => p[unique.key]), dashed: true },
    ],
    asOf: asOf(dates),
    note: "Daily counts",
    emptyText: "No traffic data stored yet",
    sampleLabel,
  });
}

/** `incomplete`: the 90-day total has missing days (`isIncomplete` of the d90 period). */
export function repoViewsChart(points: RepoSeriesPoint[], incomplete: boolean, sampleLabel: boolean): string {
  return repoChart(
    points,
    [
      { key: "views", label: "Views" },
      { key: "uniqueViews", label: "Unique visitors" },
    ],
    incomplete,
    sampleLabel,
  );
}

export function repoClonesChart(points: RepoSeriesPoint[], incomplete: boolean, sampleLabel: boolean): string {
  return repoChart(
    points,
    [
      { key: "clones", label: "Clones" },
      { key: "uniqueCloners", label: "Unique cloners" },
    ],
    incomplete,
    sampleLabel,
  );
}

export function repoStarsChart(stars: { date: string; total: number }[], sampleLabel: boolean): string {
  const dates = stars.map((s) => s.date);
  return renderChartSvg({
    title: "Stars",
    headline: stars[stars.length - 1]?.total ?? 0,
    dates,
    lines: [{ key: "stars", label: "Stars", values: stars.map((s) => s.total), area: true }],
    asOf: asOf(dates),
    note: "Last 90 days",
    emptyText: "No star history stored",
    sampleLabel,
  });
}
