/*
 * Dashboard UI for the extras: stars over time, top referrers and pages,
 * release downloads. Concatenated after CLIENT_UI (client.ts) into the same
 * inline script, so it uses its helpers and state; the pure math lives in
 * client-logic.ts. String.raw template: no backticks, no "${", never "</script".
 */

export const CLIENT_EXTRAS = String.raw`
const anyReferrers = repos.some(function (r) { return r.referrers; });
const relEnd = releaseEnd(repos);
const PERIOD_LABELS = { "7d": "Last 7 days", "30d": "Last 30 days", "90d": "Last 90 days", all: "All time" };

function renderExtras(repo, scope) {
  renderStars(repo, scope);
  renderReferrers(scope);
  renderReleases(repo, scope);
}

/** columns: { label, num?, width? }; rows: arrays of strings or nodes. */
function fillMiniTable(prefix, columns, rows, emptyText) {
  const head = byId(prefix + "-head"), body = byId(prefix + "-body");
  head.textContent = "";
  body.textContent = "";
  columns.forEach(function (col) {
    const th = h("th", col.num ? "num" : "", col.label);
    th.scope = "col";
    if (col.width) th.style.width = col.width;
    head.appendChild(th);
  });
  if (!rows.length) {
    const tr = h("tr", "norows");
    const td = h("td", "", emptyText);
    td.colSpan = columns.length;
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  rows.forEach(function (cells) {
    const tr = h("tr");
    cells.forEach(function (cell, i) {
      const td = h("td", columns[i].num ? "num" : "text");
      if (typeof cell === "string") td.textContent = cell;
      else td.appendChild(cell);
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

/** Main text with a muted second line; full text on hover since cells truncate. */
function twoLine(main, sub) {
  const box = h("div");
  if (typeof main === "string") main = h("span", "line", main);
  box.appendChild(main);
  if (sub) box.appendChild(h("span", "line sub", sub));
  return box;
}

// ---- stars over time ------------------------------------------------------

function renderStars(repo, scope) {
  const panel = byId("stars-panel");
  panel.hidden = !anyGrowth;
  if (!anyGrowth) return;
  const has = scope.some(function (r) { return r.growth; });
  const range = has ? starRange(state.period, end, scope) : null;
  const what = repo ? "Cumulative stars" : "Cumulative stars, sum of tracked repositories";
  byId("stars-sub").textContent = range === null ? "" : state.period === "all"
    ? what + " since the first star, " + rangeText(range) + " (rebuilt from current stargazers, so it can start before the traffic history)"
    : what + ", " + rangeText(range);
  renderChart(byId("stars-chart"), starSeries(scope, range), {
    label: (repo ? "Cumulative stars for " + repo.fullName : "Cumulative stars across tracked repositories"),
    lines: [{ key: "total", cls: "stars" }],
    isGap: function () { return false; },
    compact: true,
    fill: function (tip, p) {
      tip.textContent = "";
      tip.appendChild(h("div", "t-date", longDate(p.date)));
      tip.appendChild(tooltipRow("", "Stars", fmt.format(p.total), "stars"));
      tip.appendChild(tooltipRow("t-sub", "New that day", "+" + fmt.format(p.added)));
    },
    empty: !has ? "No star history stored" + (repo ? " for this repository." : ".")
      : end === null ? "No data-through date yet." : "No stars yet.",
  });
}

// ---- top referrers & pages -------------------------------------------------

function renderReferrers(scope) {
  const panel = byId("ref-panel");
  panel.hidden = !anyReferrers;
  if (!anyReferrers) return;
  const top = latestReferrers(scope);
  const uniques = scope.length === 1;
  byId("ref-sub").textContent = top === null ? "No snapshot stored for this scope"
    : "Last 14 days as of " + top.date + " · GitHub's top 10 per repository" +
      (uniques ? "" : " · views summed over " + plural(top.repos, "repository", "repositories") + " (unique visitors can't be added up)");
  const num = function (label) { return { label: label, num: true, width: "72px" }; };
  const refCols = [{ label: "Referrer" }, num("Views")].concat(uniques ? [num("Unique")] : []);
  const pathCols = [{ label: "Page" }, num("Views")].concat(uniques ? [num("Unique")] : []);
  const refs = top === null ? [] : top.referrers;
  const paths = top === null ? [] : top.paths;
  fillMiniTable("ref", refCols, refs.map(function (r) {
    const name = h("span", "line", r.referrer);
    name.title = r.referrer;
    return [name, fmt.format(r.count)].concat(uniques ? [fmt.format(r.uniques)] : []);
  }), top === null ? "No referrer snapshot stored." : "No referrers in these 14 days.");
  fillMiniTable("path", pathCols, paths.map(function (p) {
    // GitHub paths start with "/"; anything else stays text so the link can't leave github.com.
    const link = h(p.path.charAt(0) === "/" ? "a" : "span", "line", p.path);
    if (link.tagName === "A") {
      link.href = "https://github.com" + p.path;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    const cell = twoLine(link, p.title);
    cell.title = p.title ? p.title + "\n" + p.path : p.path;
    return [cell, fmt.format(p.count)].concat(uniques ? [fmt.format(p.uniques)] : []);
  }), top === null ? "No page snapshot stored." : "No page views in these 14 days.");
}

// ---- release downloads ------------------------------------------------------

/** "1,234", plus a muted "since <date>" when there is no snapshot from before the period. */
function periodCell(value, since, through) {
  const box = h("span", "", fmt.format(value));
  if (through) {
    box.appendChild(h("span", "since", "through " + shortDate(through)));
    box.title = "This repository's newest snapshot is from " + through + ", before the period ends";
  }
  if (since !== null) {
    box.appendChild(h("span", "since", "since " + shortDate(since)));
    box.title = "No snapshot from before the period: counted from the first snapshot (" + since + ")";
  }
  return box;
}

/** A repository whose newest snapshot predates the overview's end date, so the gap is not shown as 0. */
function staleReleaseCells(d, start) {
  const coverage = releaseCoverage(d.latest, start, relEnd);
  const total = h("span", "", fmt.format(d.total));
  if (coverage !== "current") total.appendChild(h("span", "since", "as of " + shortDate(d.latest)));
  if (coverage === "missing") {
    const none = h("span", "", "—");
    none.title = "No snapshot in this period; the newest is from " + d.latest;
    return [total, none];
  }
  return [total, periodCell(d.inPeriod, d.since, coverage === "stale" ? d.latest : null)];
}

function fillReleaseTip(tip, p) {
  tip.textContent = "";
  tip.appendChild(h("div", "t-date", longDate(p.date)));
  if (p.downloads === null) {
    tip.appendChild(h("div", "t-none", p.covered ? "Counted on the next snapshot date" : "No snapshot data for this day"));
    return;
  }
  tip.appendChild(tooltipRow("", "Downloads", fmt.format(p.downloads), "downloads"));
  if (p.days > 1) {
    tip.appendChild(h("div", "t-sub", "Over " + p.days + " days since the " + p.from + " snapshot (not split per day)"));
  }
  if (p.clamped) tip.appendChild(h("div", "t-note", "A count dropped (asset deleted?); counted as 0"));
}

function renderReleases(repo, scope) {
  const panel = byId("rel-panel");
  const withReleases = scope.filter(function (r) { return r.releases; });
  panel.hidden = withReleases.length === 0;
  if (!withReleases.length) return;
  const start = periodStart(state.period, relEnd);
  const windowText = start === null ? "all time" : rangeText({ start: start, end: relEnd });
  const periodLabel = PERIOD_LABELS[state.period];
  const chart = byId("rel-chart");
  chart.hidden = !repo;

  if (!repo) {
    byId("rel-sub").textContent = "Total as of the latest snapshot (" + relEnd + ") · " + periodLabel.toLowerCase() + ": " + windowText;
    const rows = withReleases.map(function (r) { return { repo: r, d: releaseDownloads(r.releases, state.period, relEnd) }; });
    rows.sort(function (a, b) { return b.d.total - a.d.total || (a.repo.fullName < b.repo.fullName ? -1 : 1); });
    fillMiniTable("rel", [
      { label: "Repository" }, { label: "Total", num: true, width: "96px" }, { label: periodLabel, num: true, width: "150px" },
    ], rows.map(function (row) {
      const btn = h("button", "linkbtn line", row.repo.fullName);
      btn.type = "button";
      btn.title = "Show " + row.repo.fullName;
      btn.addEventListener("click", function () { toggleRepo(row.repo.id); });
      return [btn].concat(staleReleaseCells(row.d, start));
    }), "");
    return;
  }

  // The drill-down period ends at this repository's own newest snapshot, not another repository's.
  const dates = Object.keys(repo.releases.snapshots).sort();
  const repoEnd = dates[dates.length - 1];
  const repoStart = periodStart(state.period, repoEnd);
  const repoWindow = repoStart === null ? "all time" : rangeText({ start: repoStart, end: repoEnd });
  const d = releaseDownloads(repo.releases, state.period, repoEnd);
  byId("rel-sub").textContent = fmt.format(d.total) + " total as of " + d.latest + " · " + fmt.format(d.inPeriod) +
    (d.since !== null ? " since " + d.since : " in " + repoWindow) + " · periods end at the latest snapshot";
  // A window starting before the first snapshot shows those days as "no data".
  const range = { start: repoStart === null ? dates[0] : repoStart, end: repoEnd };
  renderChart(chart, releaseDaily(repo.releases, range), {
    label: "Daily release downloads for " + repo.fullName,
    bars: [{ key: "downloads", cls: "downloads" }],
    isGap: function (p) { return p.downloads === null && !p.covered; },
    compact: true,
    fill: fillReleaseTip,
    empty: dates.length < 2
      ? "Daily downloads need two snapshots; the first is from " + dates[0] + "."
      : "No snapshot intervals end in this period.",
  });
  fillMiniTable("rel", [
    { label: "Release" }, { label: "Published", width: "110px" },
    { label: "Downloads", num: true, width: "96px" }, { label: periodLabel, num: true, width: "150px" },
  ], d.rows.map(function (r) {
    const name = twoLine(r.tag, r.name && r.name !== r.tag ? r.name : "");
    name.title = r.name ? r.tag + " — " + r.name : r.tag;
    return [name, r.published || "—", fmt.format(r.total), periodCell(r.inPeriod, r.since)];
  }), "No releases in the latest snapshot.");
}
`;
