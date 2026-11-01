import type { SeriesPoint } from "./aggregate.js";

export interface TrafficSvgOptions {
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
const TITLE = "Daily views & clones · last 30 days";

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

/** Fixed one-decimal coordinates keep the output byte-stable. */
const n = (value: number): string => value.toFixed(1);

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

function header(sampleLabel: boolean): string[] {
  const parts = [text(24, 32, TITLE, ' class="title"')];
  if (sampleLabel) {
    parts.push(
      `<rect x="660" y="14" width="116" height="26" rx="6" fill="#fff8c5" stroke="#d4a72c"/>`,
      text(718, 31.5, "SAMPLE DATA", ' class="banner" text-anchor="middle"'),
    );
  }
  return parts;
}

function legend(): string[] {
  const y = 56;
  const parts: string[] = [];
  let x = 24;
  for (const metric of METRICS) {
    parts.push(
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + 18)}" y2="${n(y)}" stroke="${metric.color}" stroke-width="2.5" stroke-linecap="round"/>`,
      text(x + 24, y + 4, metric.label),
    );
    x += 84;
  }
  parts.push(
    `<circle cx="${n(x + 5)}" cy="${n(y)}" r="3.5" fill="#ffffff" stroke="#57606a" stroke-width="1.5"/>`,
    text(x + 14, y + 4, "partial day — one or more tracked repos have no data for that date"),
  );
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

/** Contiguous runs of indices whose value for `key` is non-null. */
export function runs(series: SeriesPoint[], key: "views" | "clones"): number[][] {
  const result: number[][] = [];
  let current: number[] = [];
  series.forEach((point, i) => {
    if (point[key] === null) {
      if (current.length > 0) result.push(current);
      current = [];
    } else {
      current.push(i);
    }
  });
  if (current.length > 0) result.push(current);
  return result;
}

/**
 * Daily views/clones line chart. Each contiguous run of non-null days is its
 * own `M…L…` subpath so missing days show as a break, never as 0. An isolated
 * day is a zero-length `L` (dot via round caps) plus a filled `circle.solo`
 * so it stays visible in renderers that drop zero-length segments.
 */
export function renderTrafficSvg(series: SeriesPoint[], options: TrafficSvgOptions): string {
  const head = header(options.sampleLabel);

  if (series.length === 0) {
    return svgDocument(`Traffolio: ${TITLE} — no traffic data stored yet`, [
      ...head,
      ...axes(),
      text(
        (PLOT.left + PLOT.right) / 2,
        (PLOT.top + PLOT.bottom) / 2,
        "No traffic data stored yet",
        ' class="empty" text-anchor="middle"',
      ),
      text(24, FOOTER_Y, "Dates in UTC · daily totals across tracked repos"),
    ]);
  }

  const lastDate = series[series.length - 1]!.date;
  const values = series.flatMap((p) => [p.views ?? 0, p.clones ?? 0]);
  const { max, step } = yScale(Math.max(...values));
  const plotWidth = PLOT.right - PLOT.left;
  const xAt = (i: number): number =>
    series.length === 1
      ? PLOT.left + plotWidth / 2
      : PLOT.left + (i * plotWidth) / (series.length - 1);
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

  const xTicks: string[] = [];
  for (let i = 0; i < series.length; i += 7) {
    const x = xAt(i);
    xTicks.push(
      `<line x1="${n(x)}" y1="${n(PLOT.bottom)}" x2="${n(x)}" y2="${n(PLOT.bottom + 4)}" stroke="#8c959f" stroke-width="1"/>`,
      text(x, PLOT.bottom + 18, shortDate(series[i]!.date), ' text-anchor="middle"'),
    );
  }

  const lines: string[] = [];
  const markers: string[] = [];
  for (const metric of METRICS) {
    const value = (i: number): number => series[i]![metric.key]!;
    const subpaths = runs(series, metric.key).map((run) => {
      const [first, ...rest] = run.map((i) => `${n(xAt(i))} ${n(yAt(value(i)))}`);
      if (run.length === 1) {
        const i = run[0]!;
        markers.push(
          `<circle class="solo" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="2.5" fill="${metric.color}"/>`,
        );
        return `M${first} L${first}`;
      }
      return `M${first} ${rest.map((p) => `L${p}`).join(" ")}`;
    });
    if (subpaths.length > 0) {
      lines.push(
        `<path class="line ${metric.key}" d="${subpaths.join(" ")}" fill="none" stroke="${metric.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
    series.forEach((point, i) => {
      if (!point.partial || point[metric.key] === null) return;
      markers.push(
        `<circle class="partial" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="3.5" fill="#ffffff" stroke="${metric.color}" stroke-width="1.5"/>`,
      );
    });
  }

  return svgDocument(`Traffolio: ${TITLE}, data through ${lastDate} (UTC)`, [
    ...head,
    ...legend(),
    ...grid,
    ...axes(),
    ...xTicks,
    ...lines,
    ...markers,
    text(24, FOOTER_Y, `Data through ${lastDate} (UTC) · daily totals across tracked repos`),
  ]);
}
