import { CLIENT_CHART } from "./client-chart.js";
import { CLIENT_EXTRAS } from "./client-extras.js";
import { CLIENT_LOGIC } from "./client-logic.js";

/*
 * Inline browser script for the dashboard: plain ES2020, no build step, no
 * external resources. Kept as String.raw templates, so the code must not use
 * backticks or "${", and must never contain "</script". The pure period/series
 * math lives in client-logic.ts; chart drawing in client-chart.ts; stars,
 * referrers and releases UI in client-extras.ts.
 */

export const CLIENT_UI = String.raw`
const data = JSON.parse(document.getElementById("data").textContent);
const fmt = new Intl.NumberFormat("en-US");
const SVG_NS = "http://www.w3.org/2000/svg";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const METRICS = [
  { key: "views", label: "Views", unique: "uniqueViews", uniqueLabel: "Unique visitors" },
  { key: "clones", label: "Clones", unique: "uniqueCloners", uniqueLabel: "Unique cloners" },
];
const end = data.dataThroughDate;
const repos = Object.keys(data.repos).map(function (id) { return Object.assign({ id: id }, data.repos[id]); });
const tracked = repos.filter(function (r) { return r.tracking === "tracked"; });
// Without any growth file (data collected before star history existed) the page looks as before.
const anyGrowth = repos.some(function (r) { return r.growth; });
const STAR_NOTE = "Based on current stars; un-stars aren't counted, and a star's date may be off by a day.";

/** "#repo=<id>" deep link to one repository. */
function repoFromHash() {
  const m = /^#repo=(\d+)$/.exec(location.hash);
  return m && data.repos[m[1]] ? m[1] : null;
}

const state = { period: "30d", sortKey: "views", sortDir: "desc", filter: "", showAll: false, selected: repoFromHash() };

function byId(id) { return document.getElementById(id); }

function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function svg(tag, attrs, text) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, typeof attrs[k] === "number" ? attrs[k].toFixed(1) : attrs[k]);
  if (text !== undefined) e.textContent = text;
  return e;
}

function shortDate(d) { return MONTHS[Number(d.slice(5, 7)) - 1] + " " + Number(d.slice(8, 10)); }
function longDate(d) { return WEEKDAYS[new Date(d + "T00:00:00Z").getUTCDay()] + ", " + shortDate(d) + ", " + d.slice(0, 4); }
function rangeText(range) {
  if (range === null) return "No data in range";
  const sameYear = range.start.slice(0, 4) === range.end.slice(0, 4);
  return shortDate(range.start) + (sameYear ? "" : ", " + range.start.slice(0, 4)) + " – " + shortDate(range.end) + ", " + range.end.slice(0, 4);
}
function plural(n, one, many) { return fmt.format(n) + " " + (n === 1 ? one : many); }

function incompleteText(sum) {
  const parts = [];
  if (sum.missingDays > 0) parts.push(plural(sum.missingDays, "day", "days") + " with no data");
  if (sum.partialDays > 0) parts.push(plural(sum.partialDays, "partial day", "partial days"));
  return parts.join(", ");
}

/** "1,234", "1,234*" (incomplete) or "—" (no stored days), as a DOM node. */
function valueNode(value, sum) {
  const span = h("span");
  if (value === null) {
    span.textContent = "—";
    span.title = "No stored data for this period";
    return span;
  }
  span.textContent = fmt.format(value);
  if (isIncomplete(sum)) {
    const mark = h("span", "mark", "*");
    span.title = "Incomplete: " + incompleteText(sum);
    span.appendChild(mark);
  }
  return span;
}

// ---- header -------------------------------------------------------------

function renderHeader() {
  const meta = byId("meta");
  const through = h("span");
  if (end === null) through.textContent = "No traffic data stored yet";
  else {
    through.appendChild(document.createTextNode("Data through "));
    through.appendChild(h("strong", "", end));
    through.appendChild(document.createTextNode(" (UTC)"));
  }
  meta.appendChild(through);
  meta.appendChild(h("span", "", plural(tracked.length, "tracked repository", "tracked repositories")));
  const failed = tracked.filter(function (r) { return r.lastError; }).length;
  if (failed > 0) {
    const badge = h("span", "badge danger", plural(failed, "repository", "repositories") + " failing");
    badge.title = "Could not be collected on the last run (see data/status.json)";
    meta.appendChild(badge);
  }
  // A published page (source null) has no source element.
  if (data.source !== null) byId("source").textContent = data.source;
  byId("show-all-label").textContent =
    "Show excluded & missing (" + fmt.format(repos.length - tracked.length) + ")";
}

// ---- chart --------------------------------------------------------------

function renderLegend(container, metric, showUnique, scopeIsOverall) {
  container.textContent = "";
  const entries = [{ cls: metric.key, label: metric.label }];
  if (showUnique) entries.push({ cls: "unique", label: metric.uniqueLabel });
  entries.forEach(function (e) {
    const item = h("span");
    const icon = svg("svg", { width: "18", height: "10", "aria-hidden": "true" });
    icon.appendChild(svg("path", { class: "c-line " + e.cls, d: "M2 5 L16 5" }));
    item.appendChild(icon);
    item.appendChild(document.createTextNode(e.label));
    container.appendChild(item);
  });
  if (scopeIsOverall) {
    const item = h("span");
    const icon = svg("svg", { width: "12", height: "12", "aria-hidden": "true" });
    icon.appendChild(svg("circle", { class: "c-partial legend-only", cx: "6", cy: "6", r: "3.5" }));
    item.appendChild(icon);
    item.appendChild(document.createTextNode("Partial day — some tracked repos have no data"));
    container.appendChild(item);
  }
  const gap = h("span");
  const box = svg("svg", { width: "12", height: "12", "aria-hidden": "true" });
  box.appendChild(svg("rect", { class: "c-nodata", x: "0", y: "0", width: "12", height: "12", rx: "2" }));
  gap.appendChild(box);
  gap.appendChild(document.createTextNode("No data stored"));
  container.appendChild(gap);
}

function tooltipRow(className, label, value, swatch) {
  const row = h("div", "t-row" + (className ? " " + className : ""));
  const left = h("span");
  if (swatch) left.appendChild(h("span", "swatch " + swatch));
  left.appendChild(document.createTextNode(label));
  row.appendChild(left);
  row.appendChild(h("span", "", value));
  return row;
}

function fillTooltip(tip, p, metric, showUnique) {
  tip.textContent = "";
  tip.appendChild(h("div", "t-date", longDate(p.date)));
  if (p[metric.key] === null) {
    tip.appendChild(h("div", "t-none", "No data stored for this day"));
    return;
  }
  tip.appendChild(tooltipRow("", metric.label, fmt.format(p[metric.key]), metric.key));
  if (showUnique) tip.appendChild(tooltipRow("t-sub", metric.uniqueLabel, fmt.format(p[metric.unique])));
  if (p.partial) {
    tip.appendChild(h("div", "t-note", "Partial: " + p.present + " of " + p.total + " repos have data"));
  }
}

// ---- scope (overall or one repo): title, cards, chart --------------------

function selectedRepo() {
  return repos.find(function (r) { return r.id === state.selected; }) || null;
}

function card(kind, label, value, sum, sub) {
  const c = h("div", "card " + kind);
  const top = h("div", "label");
  top.appendChild(h("span", "", label));
  if (sum && isIncomplete(sum)) {
    const badge = h("span", "badge warn", "incomplete");
    badge.title = incompleteText(sum) + "; the sum covers only the data we have";
    top.appendChild(badge);
  }
  c.appendChild(top);
  const v = h("div", "value");
  if (sum) v.appendChild(valueNode(value, sum)); else v.textContent = value;
  c.appendChild(v);
  c.appendChild(h("div", "sub", sub));
  return c;
}

function renderScope() {
  const repo = selectedRepo();
  const scope = repo ? [repo] : tracked;
  const range = periodRange(state.period, end, scope);
  const series = buildSeries(scope, range);
  const sum = sumSeries(series);

  byId("scope-title").textContent = repo ? repo.fullName : "All tracked repositories";
  byId("scope-sub").textContent = rangeText(range) + (repo
    ? (repo.tracking === "tracked" ? "" : " · " + statusLabel(repo) + ", not in totals")
    : " · daily totals");
  byId("close").hidden = !repo;
  document.querySelectorAll(".seg button").forEach(function (b) {
    b.setAttribute("aria-pressed", String(b.getAttribute("data-period") === state.period));
  });

  const cards = byId("cards");
  cards.textContent = "";
  const days = series.length;
  cards.appendChild(card("views", "Views", sum.views, sum, rangeText(range)));
  cards.appendChild(card("clones", "Clones", sum.clones, sum, rangeText(range)));
  cards.appendChild(card("coverage", "Days with data", days ? fmt.format(sum.presentDays) + " of " + fmt.format(days) : "—", null,
    sum.presentDays === 0 ? "Nothing stored in this period" : isIncomplete(sum) ? incompleteText(sum) : "Complete"));
  if (anyGrowth) {
    [["stars", "Stars"], ["forks", "Forks"]].forEach(function (k) {
      const total = scope.reduce(function (n, r) { return n + r[k[0]]; }, 0);
      const start = end === null ? null : periodStart(state.period, end);
      const added = end === null ? null : growthAdded(scope, k[0], start, end);
      const sub = added === null ? "No " + k[0].slice(0, -1) + " history stored"
        : "+" + fmt.format(added) + (start === null ? " all time" : " · " + rangeText({ start: start, end: end }));
      const c = card(k[0], k[1], fmt.format(total), null, sub);
      c.title = "Current total, which can include " + k[0] + " dated after " + end + "; the change counts " + k[0] + " dated in the period. " +
        (k[0] === "stars" ? STAR_NOTE : "Deleted forks aren't counted.");
      cards.appendChild(c);
    });
  }

  METRICS.forEach(function (m) {
    const lines = [{ key: m.key, cls: m.key }];
    if (repo) lines.push({ key: m.unique, cls: "unique" });
    renderLegend(byId(m.key + "-legend"), m, Boolean(repo), !repo);
    renderChart(byId(m.key + "-chart"), series, {
      label: "Daily " + m.key + (repo ? " for " + repo.fullName : " across tracked repositories"),
      lines: lines,
      isGap: function (p) { return p[m.key] === null; },
      fill: function (tip, p) { fillTooltip(tip, p, m, Boolean(repo)); },
      empty: end === null ? "No traffic data stored yet." : "No traffic data stored for this period.",
    });
  });
  renderExtras(repo, scope);
}

// ---- table --------------------------------------------------------------

const COLUMNS = [
  { key: "name", label: "Repository" },
  { key: "visibility", label: "Visibility" },
  { key: "views", label: "Views", num: true },
  { key: "clones", label: "Clones", num: true },
  { key: "trend", label: "Daily views", sortable: false },
  { key: "stars", label: "Stars", num: true },
  { key: "newStars", label: "New stars", num: true, title: "Stars dated in the selected period. " + STAR_NOTE },
  { key: "forks", label: "Forks", num: true },
  { key: "status", label: "Status" },
].filter(function (col) { return anyGrowth || col.key !== "newStars"; });

function rowModels() {
  const sparkRange = periodRange(state.period, end, repos);
  return repos.map(function (repo) {
    return {
      repo: repo,
      sum: sumSeries(buildSeries([repo], periodRange(state.period, end, [repo]))),
      spark: buildSeries([repo], sparkRange),
      newStars: end === null ? null : growthAdded([repo], "stars", periodStart(state.period, end), end),
      status: statusLabel(repo),
    };
  });
}

function sortValue(row, key) {
  switch (key) {
    case "name": return row.repo.fullName.toLowerCase();
    case "visibility": return row.repo.private ? "private" : "public";
    case "views": return row.sum.views;
    case "clones": return row.sum.clones;
    case "stars": return row.repo.stars;
    case "newStars": return row.newStars;
    case "forks": return row.repo.forks;
    default: return row.status;
  }
}

/** null (no stored data) sorts last in both directions; ties by name. */
function compareRows(a, b) {
  const x = sortValue(a, state.sortKey), y = sortValue(b, state.sortKey);
  if (x !== y) {
    if (x === null) return 1;
    if (y === null) return -1;
    return (x < y ? -1 : 1) * (state.sortDir === "asc" ? 1 : -1);
  }
  const p = a.repo.fullName.toLowerCase(), q = b.repo.fullName.toLowerCase();
  return p < q ? -1 : p > q ? 1 : 0;
}

function renderHead() {
  const head = byId("head");
  head.textContent = "";
  COLUMNS.forEach(function (col) {
    const th = h("th", col.num ? "num" : "");
    th.scope = "col";
    if (col.title) th.title = col.title;
    if (col.sortable === false) {
      th.textContent = col.label;
    } else {
      const sorted = state.sortKey === col.key;
      th.setAttribute("aria-sort", sorted ? (state.sortDir === "asc" ? "ascending" : "descending") : "none");
      const btn = h("button");
      btn.type = "button";
      // Arrow on the inner side so right-aligned labels line up with their numbers.
      const arrow = h("span", sorted ? "arrow" : "arrow idle", sorted && state.sortDir === "asc" ? "▲" : "▼");
      arrow.setAttribute("aria-hidden", "true");
      if (col.num) btn.appendChild(arrow);
      btn.appendChild(document.createTextNode(col.label));
      if (!col.num) btn.appendChild(arrow);
      btn.addEventListener("click", function () {
        if (state.sortKey === col.key) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        else { state.sortKey = col.key; state.sortDir = col.num ? "desc" : "asc"; }
        renderHead();
        renderBody();
        head.querySelector("[aria-sort]:not([aria-sort=none]) button").focus();
      });
      th.appendChild(btn);
    }
    head.appendChild(th);
  });
}

function syncHash() {
  history.replaceState(null, "", state.selected ? "#repo=" + state.selected : location.pathname + location.search);
}

function toggleRepo(id) {
  state.selected = state.selected === id ? null : id;
  syncHash();
  renderScope();
  renderBody();
  const bar = document.querySelector(".scopebar");
  if (state.selected && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: "start" });
}

function renderBody() {
  const body = byId("body");
  const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : undefined;
  body.textContent = "";
  const filter = state.filter.trim().toLowerCase();
  const all = rowModels().sort(compareRows);
  const visible = all.filter(function (row) {
    if (!state.showAll && row.repo.tracking !== "tracked" && row.repo.id !== state.selected) return false;
    return !filter || row.repo.fullName.toLowerCase().includes(filter);
  });
  byId("row-count").textContent = fmt.format(visible.length) + " of " + plural(all.length, "repository", "repositories");

  if (!visible.length) {
    const tr = h("tr", "norows");
    const td = h("td", "", "No repositories match.");
    td.colSpan = COLUMNS.length;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  visible.forEach(function (row) {
    const repo = row.repo;
    const selected = repo.id === state.selected;
    const tr = h("tr", selected ? "selected" : "");
    tr.tabIndex = 0;
    tr.dataset.id = repo.id;
    tr.setAttribute("aria-selected", String(selected));
    tr.title = selected ? "Back to all repositories" : "Show daily chart for " + repo.fullName;

    const name = h("td", "name");
    const link = h("a", "", repo.fullName);
    link.href = "https://github.com/" + repo.fullName.split("/").map(encodeURIComponent).join("/");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.addEventListener("click", function (e) { e.stopPropagation(); });
    name.appendChild(link);
    tr.appendChild(name);

    const vis = h("td");
    vis.appendChild(h("span", "pill", repo.private ? "private" : "public"));
    tr.appendChild(vis);

    METRICS.forEach(function (m) {
      const td = h("td", "num");
      td.appendChild(valueNode(row.sum[m.key], row.sum));
      tr.appendChild(td);
    });

    const trend = h("td");
    trend.appendChild(sparkline(row.spark));
    tr.appendChild(trend);

    tr.appendChild(h("td", "num", fmt.format(repo.stars)));
    if (anyGrowth) {
      const td = h("td", "num" + (row.newStars ? "" : " dim"), row.newStars === null ? "—" : row.newStars ? "+" + fmt.format(row.newStars) : "0");
      if (row.newStars === null) td.title = "No star history stored";
      tr.appendChild(td);
    }
    tr.appendChild(h("td", "num", fmt.format(repo.forks)));

    const st = h("td");
    const kind = repo.tracking !== "tracked" ? "off" : repo.lastError ? "err" : "ok";
    st.appendChild(h("span", "status " + kind, row.status));
    tr.appendChild(st);

    tr.addEventListener("click", function () { toggleRepo(repo.id); });
    tr.addEventListener("keydown", function (e) {
      if (e.target !== tr || (e.key !== "Enter" && e.key !== " ")) return;
      e.preventDefault();
      toggleRepo(repo.id);
    });
    body.appendChild(tr);
  });

  if (focusedId !== undefined) {
    const again = body.querySelector("tr[data-id=\"" + focusedId + "\"]");
    if (again) again.focus();
  }
}

// ---- wiring -------------------------------------------------------------

document.querySelectorAll(".seg button").forEach(function (b) {
  b.addEventListener("click", function () {
    state.period = b.getAttribute("data-period");
    renderScope();
    renderBody();
  });
});
byId("close").addEventListener("click", function () {
  const id = state.selected;
  state.selected = null;
  syncHash();
  renderScope();
  renderBody();
  const row = byId("body").querySelector("tr[data-id=\"" + id + "\"]");
  if (row) row.focus();
});
byId("filter").addEventListener("input", function (e) { state.filter = e.target.value; renderBody(); });
byId("show-all").addEventListener("change", function (e) { state.showAll = e.target.checked; renderBody(); });
window.addEventListener("hashchange", function () {
  state.selected = repoFromHash();
  renderScope();
  renderBody();
});

let lastWidth = byId("views-chart").clientWidth;
let resizeQueued = false;
window.addEventListener("resize", function () {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(function () {
    resizeQueued = false;
    const width = byId("views-chart").clientWidth;
    if (width !== lastWidth) { lastWidth = width; renderScope(); }
  });
});
`;

// Runs last, so every const in the UI and extras parts is initialized.
const CLIENT_INIT = "renderHeader();\nrenderHead();\nrenderScope();\nrenderBody();\n";

export const CLIENT_SCRIPT = `(function () {\n"use strict";\n${CLIENT_LOGIC}\n${CLIENT_UI}\n${CLIENT_CHART}\n${CLIENT_EXTRAS}\n${CLIENT_INIT}})();\n`;
