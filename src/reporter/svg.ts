import type { RepoSeriesPoint, SeriesPoint } from "./aggregate.js";

export interface ChartLine {
  /** CSS class suffix: the path gets `class="line <key>"`. */
  key: string;
  label: string;
  color: string;
  /** One value per date; `null` is a missing day and breaks the line. */
  values: (number | null)[];
  dashed?: boolean;
}

export interface ChartSpec {
  title: string;
  dates: string[];
  lines: ChartLine[];
  /** Per date: some tracked repos have no data. Omit for charts without partial days. */
  partial?: boolean[];
  footer: string;
  emptyText: string;
  /** Adds a `SAMPLE DATA` banner (demo output). */
  sampleLabel: boolean;
}

const WIDTH = 800;
const HEIGHT = 320;
const PLOT = { left: 64, right: 776, top: 76, bottom: 262 };
const FOOTER_Y = 304;
export const METRICS = [
  { key: "views", label: "Views", color: "#0969da" },
  { key: "clones", label: "Clones", color: "#bc4c00" },
] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Explicit light card + system fonts only: the SVG is shown through <img> on
// GitHub, which blocks external resources and doesn't follow the page theme.
const STYLE =
  "text{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;fill:#57606a;font-size:11px}" +
  ".title{font-size:14px;font-weight:600;fill:#1f2328}" +
  ".banner{font-size:12px;font-weight:700;fill:#7d4e00;letter-spacing:1px}" +
  ".empty{font-size:14px;fill:#57606a}";

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

function header(title: string, sampleLabel: boolean): string[] {
  const parts = [text(24, 32, title, ' class="title"')];
  if (sampleLabel) {
    parts.push(
      `<rect x="660" y="14" width="116" height="26" rx="6" fill="#fff8c5" stroke="#d4a72c"/>`,
      text(718, 31.5, "SAMPLE DATA", ' class="banner" text-anchor="middle"'),
    );
  }
  return parts;
}

function legend(lines: ChartLine[], showPartial: boolean): string[] {
  const y = 56;
  const parts: string[] = [];
  let x = 24;
  for (const line of lines) {
    const dash = line.dashed ? ' stroke-dasharray="4 3"' : "";
    parts.push(
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + 18)}" y2="${n(y)}" stroke="${line.color}" stroke-width="2.5" stroke-linecap="round"${dash}/>`,
      text(x + 24, y + 4, line.label),
    );
    x += 40 + line.label.length * 6;
  }
  if (showPartial) {
    parts.push(
      `<circle cx="${n(x + 5)}" cy="${n(y)}" r="3.5" fill="#ffffff" stroke="#57606a" stroke-width="1.5"/>`,
      text(x + 14, y + 4, "partial day — one or more tracked repos have no data for that date"),
    );
  }
  return parts;
}

function axes(): string[] {
  const stroke = 'stroke="#8c959f" stroke-width="1"';
  return [
    `<line x1="${n(PLOT.left)}" y1="${n(PLOT.top)}" x2="${n(PLOT.left)}" y2="${n(PLOT.bottom)}" ${stroke}/>`,
    `<line x1="${n(PLOT.left)}" y1="${n(PLOT.bottom)}" x2="${n(PLOT.right)}" y2="${n(PLOT.bottom)}" ${stroke}/>`,
  ];
}

function svgDocument(label: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeXml(label)}">`,
    `<title>${escapeXml(label)}</title>`,
    `<style>${STYLE}</style>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="8" fill="#ffffff" stroke="#d0d7de"/>`,
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
  const head = header(spec.title, spec.sampleLabel);
  const allValues = lines.flatMap((line) => line.values.filter((v) => v !== null));

  if (dates.length === 0 || allValues.length === 0) {
    return svgDocument(`Traffolio: ${spec.title} — ${spec.emptyText.toLowerCase()}`, [
      ...head,
      ...axes(),
      text(
        (PLOT.left + PLOT.right) / 2,
        (PLOT.top + PLOT.bottom) / 2,
        spec.emptyText,
        ' class="empty" text-anchor="middle"',
      ),
      text(24, FOOTER_Y, spec.footer),
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
        `<line x1="${n(PLOT.left)}" y1="${n(y)}" x2="${n(PLOT.right)}" y2="${n(y)}" stroke="#eaeef2" stroke-width="1"/>`,
      );
    }
    grid.push(text(PLOT.left - 8, y + 4, groupDigits(v), ' text-anchor="end"'));
  }

  const tickEvery = dates.length <= 35 ? 7 : 14;
  const xTicks: string[] = [];
  for (let i = 0; i < dates.length; i += tickEvery) {
    const x = xAt(i);
    xTicks.push(
      `<line x1="${n(x)}" y1="${n(PLOT.bottom)}" x2="${n(x)}" y2="${n(PLOT.bottom + 4)}" stroke="#8c959f" stroke-width="1"/>`,
      text(x, PLOT.bottom + 18, shortDate(dates[i]!), ' text-anchor="middle"'),
    );
  }

  const paths: string[] = [];
  const markers: string[] = [];
  for (const line of lines) {
    const value = (i: number): number => line.values[i]!;
    const subpaths = valueRuns(line.values).map((run) => {
      const [first, ...rest] = run.map((i) => `${n(xAt(i))} ${n(yAt(value(i)))}`);
      if (run.length === 1) {
        const i = run[0]!;
        markers.push(
          `<circle class="solo" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="2.5" fill="${line.color}"/>`,
        );
        return `M${first} L${first}`;
      }
      return `M${first} ${rest.map((p) => `L${p}`).join(" ")}`;
    });
    if (subpaths.length > 0) {
      const dash = line.dashed ? ' stroke-dasharray="4 3"' : "";
      paths.push(
        `<path class="line ${line.key}" d="${subpaths.join(" ")}" fill="none" stroke="${line.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${dash}/>`,
      );
    }
    spec.partial?.forEach((isPartial, i) => {
      if (!isPartial || line.values[i] === null || line.values[i] === undefined) return;
      markers.push(
        `<circle class="partial" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="3.5" fill="#ffffff" stroke="${line.color}" stroke-width="1.5"/>`,
      );
    });
  }

  return svgDocument(`Traffolio: ${spec.title}, ${spec.footer}`, [
    ...head,
    ...legend(lines, spec.partial !== undefined),
    ...grid,
    ...axes(),
    ...xTicks,
    ...paths,
    ...markers,
    text(24, FOOTER_Y, spec.footer),
  ]);
}

function readmeChart(
  series: SeriesPoint[],
  metric: (typeof METRICS)[number],
  title: string,
  sampleLabel: boolean,
): string {
  const lastDate = series[series.length - 1]?.date;
  return renderChartSvg({
    title,
    dates: series.map((p) => p.date),
    lines: [{ ...metric, values: series.map((p) => p[metric.key]) }],
    partial: series.map((p) => p.partial),
    footer:
      lastDate === undefined
        ? "Dates in UTC · daily totals across tracked repos"
        : `Data through ${lastDate} (UTC) · daily totals across tracked repos`,
    emptyText: "No traffic data stored yet",
    sampleLabel,
  });
}

export function viewsChart(series: SeriesPoint[], sampleLabel: boolean): string {
  return readmeChart(series, METRICS[0], "Daily views · last 30 days", sampleLabel);
}

export function clonesChart(series: SeriesPoint[], sampleLabel: boolean): string {
  return readmeChart(series, METRICS[1], "Daily clones · last 30 days", sampleLabel);
}

const REPO_FOOTER_EMPTY = "Dates in UTC";

type Style = { label: string; color: string };

function repoChart(
  points: RepoSeriesPoint[],
  title: string,
  [main, unique]: [Style & { key: "views" | "clones" }, Style & { key: "uniqueViews" | "uniqueCloners" }],
  sampleLabel: boolean,
): string {
  const lastDate = points[points.length - 1]?.date;
  return renderChartSvg({
    title,
    dates: points.map((p) => p.date),
    lines: [
      { ...main, values: points.map((p) => p[main.key]) },
      { ...unique, values: points.map((p) => p[unique.key]), dashed: true },
    ],
    footer: lastDate === undefined ? REPO_FOOTER_EMPTY : `Data through ${lastDate} (UTC)`,
    emptyText: "No traffic data stored yet",
    sampleLabel,
  });
}

export function repoViewsChart(points: RepoSeriesPoint[], sampleLabel: boolean): string {
  return repoChart(
    points,
    "Daily views · last 90 days",
    [
      { key: "views", label: "Views", color: "#0969da" },
      { key: "uniqueViews", label: "Unique visitors", color: "#54aeff" },
    ],
    sampleLabel,
  );
}

export function repoClonesChart(points: RepoSeriesPoint[], sampleLabel: boolean): string {
  return repoChart(
    points,
    "Daily clones · last 90 days",
    [
      { key: "clones", label: "Clones", color: "#bc4c00" },
      { key: "uniqueCloners", label: "Unique cloners", color: "#fb8f44" },
    ],
    sampleLabel,
  );
}

export function repoStarsChart(stars: { date: string; total: number }[], sampleLabel: boolean): string {
  const lastDate = stars[stars.length - 1]?.date;
  return renderChartSvg({
    title: "Stars · last 90 days",
    dates: stars.map((s) => s.date),
    lines: [{ key: "stars", label: "Stars", color: "#bf8700", values: stars.map((s) => s.total) }],
    footer: lastDate === undefined ? REPO_FOOTER_EMPTY : `Data through ${lastDate} (UTC)`,
    emptyText: "No star history stored",
    sampleLabel,
  });
}
