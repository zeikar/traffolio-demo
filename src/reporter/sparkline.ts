import type { SeriesPoint } from "./aggregate.js";
import { METRICS, runs } from "./svg.js";

const WIDTH = 120;
const HEIGHT = 28;
const PLOT = { left: 5, right: 115, top: 5, bottom: 23 };
// Generic on purpose: the file sits next to the README, so it must not carry a repo name.
const TITLE = "30-day views and clones";

const n = (value: number): string => value.toFixed(1);

/** Light card like the main chart: GitHub shows the SVG via <img>, ignoring the dark theme. */
function svgDocument(label: string, body: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${label}">`,
    `<title>${label}</title>`,
    `<rect x="0.5" y="0.5" width="${WIDTH - 1}" height="${HEIGHT - 1}" rx="4" fill="#ffffff" stroke="#d0d7de"/>`,
    ...body,
    "</svg>",
    "",
  ].join("\n");
}

/**
 * One repo's daily views/clones as a tiny two-line chart on a shared 0–max
 * scale (all-zero stays on the baseline). Missing days break the line as in
 * the main chart; a series with no stored day renders a "no data" dash.
 */
export function renderSparklineSvg(series: SeriesPoint[]): string {
  const values = series.flatMap((p) => [p.views, p.clones]).filter((v) => v !== null);
  if (values.length === 0) {
    const mid = HEIGHT / 2;
    return svgDocument(`${TITLE}: no data`, [
      `<line x1="${n(WIDTH / 2 - 6)}" y1="${n(mid)}" x2="${n(WIDTH / 2 + 6)}" y2="${n(mid)}" stroke="#8c959f" stroke-width="1.5" stroke-linecap="round"/>`,
    ]);
  }

  const max = Math.max(...values);
  const plotWidth = PLOT.right - PLOT.left;
  const xAt = (i: number): number =>
    series.length === 1 ? PLOT.left + plotWidth / 2 : PLOT.left + (i * plotWidth) / (series.length - 1);
  const yAt = (v: number): number =>
    max === 0 ? PLOT.bottom : PLOT.bottom - (v / max) * (PLOT.bottom - PLOT.top);

  const body = [
    `<line x1="${n(PLOT.left)}" y1="${n(PLOT.bottom)}" x2="${n(PLOT.right)}" y2="${n(PLOT.bottom)}" stroke="#eaeef2" stroke-width="1"/>`,
  ];
  const solos: string[] = [];
  for (const metric of METRICS) {
    const value = (i: number): number => series[i]![metric.key]!;
    const subpaths = runs(series, metric.key).map((run) => {
      const [first, ...rest] = run.map((i) => `${n(xAt(i))} ${n(yAt(value(i)))}`);
      if (run.length === 1) {
        const i = run[0]!;
        solos.push(`<circle class="solo" cx="${n(xAt(i))}" cy="${n(yAt(value(i)))}" r="1.5" fill="${metric.color}"/>`);
        return `M${first} L${first}`;
      }
      return `M${first} ${rest.map((p) => `L${p}`).join(" ")}`;
    });
    if (subpaths.length > 0) {
      body.push(
        `<path class="${metric.key}" d="${subpaths.join(" ")}" fill="none" stroke="${metric.color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
      );
    }
  }
  return svgDocument(TITLE, [...body, ...solos]);
}
