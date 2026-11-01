/*
 * DOM-free part of the dashboard's inline script (see client.ts). Tests
 * evaluate it in Node and check it against src/reporter/aggregate.ts.
 * String.raw template: no backticks, no "${", never "</script".
 */

export const CLIENT_LOGIC = String.raw`
// Mirrors src/reporter/aggregate.ts: a date with no stored key is "no data"
// (null), never 0; a multi-repo date where only some repos have a key is
// "partial"; days before tracking began are neither; sums cover present days
// only and are flagged when incomplete.
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90, all: "all" };
const DAY_MS = 86400000;

function shiftDate(date, delta) {
  return new Date(Date.parse(date + "T00:00:00Z") + delta * DAY_MS).toISOString().slice(0, 10);
}

function enumerateDates(start, end) {
  const dates = [];
  for (let d = start; d <= end; d = shiftDate(d, 1)) dates.push(d);
  return dates;
}

function earliestDate(repos) {
  let min = null;
  for (const repo of repos) {
    for (const d in repo.days) if (min === null || d < min) min = d;
  }
  return min;
}

/**
 * Each repo's tracking start: its earliest key, or "" when it has none (its
 * first collection failed), so it is expected on every date of the scope's
 * range. Days before a repo's start are "not tracked yet": never missing,
 * never partial.
 */
const trackingStarts = new Map();
function trackingStart(repo) {
  if (!trackingStarts.has(repo)) trackingStarts.set(repo, earliestDate([repo]) || "");
  return trackingStarts.get(repo);
}

/**
 * Inclusive range ending at end, starting no earlier than the scope's earliest
 * key ("all" starts there).
 */
function periodRange(period, end, repos) {
  if (end === null) return null;
  const first = earliestDate(repos);
  if (first === null) return null;
  const length = PERIOD_DAYS[period];
  let start = length === "all" ? first : shiftDate(end, 1 - length);
  if (start < first) start = first;
  if (start > end) return null;
  return { start: start, end: end };
}

/** Sums over the repos that have the key; null when none do. total = repos already tracked on that date. */
function dayPoint(repos, date) {
  let views = 0, uniqueViews = 0, clones = 0, uniqueCloners = 0, present = 0, total = 0;
  for (const repo of repos) {
    if (trackingStart(repo) > date) continue;
    total++;
    const m = repo.days[date];
    if (!m) continue;
    views += m[0];
    uniqueViews += m[1];
    clones += m[2];
    uniqueCloners += m[3];
    present++;
  }
  if (present === 0) {
    return { date: date, views: null, uniqueViews: null, clones: null, uniqueCloners: null, present: 0, total: total, partial: false };
  }
  return { date: date, views: views, uniqueViews: uniqueViews, clones: clones, uniqueCloners: uniqueCloners, present: present, total: total, partial: present < total };
}

function buildSeries(repos, range) {
  if (range === null) return [];
  return enumerateDates(range.start, range.end).map(function (d) { return dayPoint(repos, d); });
}

function sumSeries(series) {
  let views = 0, clones = 0, presentDays = 0, missingDays = 0, partialDays = 0;
  for (const p of series) {
    if (p.views === null) { missingDays++; continue; }
    views += p.views;
    clones += p.clones;
    presentDays++;
    if (p.partial) partialDays++;
  }
  if (presentDays === 0) return { views: null, clones: null, presentDays: 0, missingDays: missingDays, partialDays: 0 };
  return { views: views, clones: clones, presentDays: presentDays, missingDays: missingDays, partialDays: partialDays };
}

/** README's "*": some days lack data (or some repos), but there is a sum. */
function isIncomplete(sum) {
  return sum.presentDays > 0 && (sum.missingDays > 0 || sum.partialDays > 0);
}

/** Same labels as the README table (src/reporter/readme.ts). */
function statusLabel(repo) {
  if (repo.tracking === "tracked") {
    return repo.lastError ? repo.lastError.kind + " since " + repo.lastError.date : "ok";
  }
  if (repo.tracking === "missing") return "missing";
  return "excluded (" + repo.tracking.slice("excluded:".length) + ")";
}

/** Smallest 1/2/5x10^k step giving at most 4 intervals (as in svg.ts). */
function niceScale(maxValue) {
  const raw = Math.max(maxValue, 4) / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(function (m) { return m * magnitude; }).find(function (s) { return s >= raw; });
  return { step: step, max: step * Math.ceil(Math.max(maxValue, 4) / step) };
}

// ---- stars & forks (data/growth) ------------------------------------------
// History is rebuilt from GitHub's star history and the fork list, so it goes back
// before the traffic history; "all" therefore starts at the earliest star.

/** First day of the period ending at end; null for "all" (unbounded). */
function periodStart(period, end) {
  const length = PERIOD_DAYS[period];
  return length === "all" ? null : shiftDate(end, 1 - length);
}

/** Stars or forks ("stars" | "forks") added from start (null: ever) to end; null when no repo has history. */
function growthAdded(repos, kind, start, end) {
  let total = 0, any = false;
  for (const repo of repos) {
    if (!repo.growth) continue;
    any = true;
    const added = repo.growth[kind];
    for (const d in added) if ((start === null || d >= start) && d <= end) total += added[d];
  }
  return any ? total : null;
}

/** Chart range for stars: the period, or from the earliest star for "all". */
function starRange(period, end, repos) {
  if (end === null) return null;
  let start = periodStart(period, end);
  if (start === null) {
    for (const repo of repos) {
      if (!repo.growth) continue;
      for (const d in repo.growth.stars) if (start === null || d < start) start = d;
    }
  }
  if (start === null || start > end) return null;
  return { start: start, end: end };
}

/** Cumulative stars per day (stars before range.start included) and stars added that day. */
function starSeries(repos, range) {
  if (range === null) return [];
  const added = {};
  let total = 0;
  for (const repo of repos) {
    if (!repo.growth) continue;
    for (const d in repo.growth.stars) {
      const n = repo.growth.stars[d];
      if (d < range.start) total += n;
      else if (d <= range.end) added[d] = (added[d] || 0) + n;
    }
  }
  return enumerateDates(range.start, range.end).map(function (d) {
    const n = added[d] || 0;
    total += n;
    return { date: d, total: total, added: n };
  });
}

// ---- referrers & popular paths (data/referrers) ---------------------------
const TOP_ENTRIES = 10;

function byCountThenKey(a, b) {
  return b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Mirrors src/reporter/referrers.ts: only snapshots from the newest run date
 * among repos count (a repo that failed lately drops out instead of adding
 * stale numbers); counts are summed. Uniques can't be added across repos, so
 * they are null unless repos is a single repo. Snapshots are GitHub's top 10
 * over the 14 days before the run date, never daily values.
 */
function latestReferrers(repos) {
  let date = null;
  for (const repo of repos) {
    if (repo.referrers && (date === null || repo.referrers.date > date)) date = repo.referrers.date;
  }
  if (date === null) return null;
  const single = repos.length === 1;
  const referrers = new Map(), paths = new Map();
  let included = 0;
  for (const repo of repos) {
    if (!repo.referrers || repo.referrers.date !== date) continue;
    included++;
    for (const r of repo.referrers.referrers) {
      const e = referrers.get(r[0]) || { key: r[0], referrer: r[0], count: 0, uniques: single ? r[2] : null };
      e.count += r[1];
      referrers.set(r[0], e);
    }
    for (const p of repo.referrers.paths) {
      const e = paths.get(p[0]) || { key: p[0], path: p[0], title: p[1], count: 0, uniques: single ? p[3] : null };
      e.count += p[2];
      paths.set(p[0], e);
    }
  }
  return {
    date: date,
    repos: included,
    referrers: Array.from(referrers.values()).sort(byCountThenKey).slice(0, TOP_ENTRIES),
    paths: Array.from(paths.values()).sort(byCountThenKey).slice(0, TOP_ENTRIES),
  };
}

// ---- release downloads (data/releases) ------------------------------------
// Snapshots are cumulative per run date. Run dates are later than the traffic
// data-through date, so release periods end at the newest snapshot date.

/** Newest release snapshot date across repos, or null. */
function releaseEnd(repos) {
  let max = null;
  for (const repo of repos) {
    if (!repo.releases) continue;
    for (const d in repo.releases.snapshots) if (max === null || d > max) max = d;
  }
  return max;
}

/** Newest key of sorted dates that is <= date, or null. */
function atOrBefore(dates, date) {
  let found = null;
  for (const d of dates) if (d <= date) found = d;
  return found;
}

/** Newest key of sorted dates that is < date, or null. */
function before(dates, date) {
  let found = null;
  for (const d of dates) if (d < date) found = d;
  return found;
}

/**
 * How a repository's newest snapshot (latest) relates to a period starting at start (null: all
 * time) and ending at relEnd: "current", "stale" (ends before relEnd, so the period is only
 * partly covered) or "missing" (ends before the period starts, so it has no data in it).
 */
function releaseCoverage(latest, start, relEnd) {
  if (latest === relEnd) return "current";
  return start !== null && latest < start ? "missing" : "stale";
}

/**
 * Downloads per release as of the newest snapshot <= relEnd (releases in that
 * snapshot, newest published first) and in the period. A period figure sums the
 * positive deltas between consecutive snapshots from the newest one before the
 * (inclusive) period start, like releaseDaily, so a drop (deleted asset) counts
 * as 0 without hiding later downloads, and releases deleted before the latest
 * snapshot still count in inPeriod (but get no row). A release published on/after
 * the start counts from 0; otherwise, with no snapshot that early, it counts
 * from the first snapshot and since is set to that date. "all" is the total.
 */
function releaseDownloads(rel, period, relEnd) {
  const dates = Object.keys(rel.snapshots).sort();
  const latest = atOrBefore(dates, relEnd);
  if (latest === null) return { latest: null, total: 0, inPeriod: 0, since: null, rows: [] };
  const start = periodStart(period, relEnd);
  const baseDate = start === null ? null : before(dates, start);
  const counts = rel.snapshots[latest];
  const first = baseDate !== null ? baseDate : dates[0];
  const chain = dates.filter(function (d) { return d >= first && d <= latest; });
  function gainedIn(id, published) {
    const fromZero = published !== null && published >= start;
    let prev = fromZero ? 0 : (rel.snapshots[chain[0]][id] || 0), gained = 0;
    for (let i = fromZero ? 0 : 1; i < chain.length; i++) {
      const cur = rel.snapshots[chain[i]][id] || 0;
      if (cur > prev) gained += cur - prev;
      prev = cur;
    }
    return gained;
  }
  let total = 0, inPeriod = 0, since = null;
  const rows = Object.keys(counts).map(function (id) {
    const info = rel.info[id] || ["#" + id, "", null];
    const published = info[2];
    const rowSince = start !== null && baseDate === null && !(published !== null && published >= start) ? dates[0] : null;
    const gained = start === null ? counts[id] : gainedIn(id, published);
    const row = { id: id, tag: info[0], name: info[1], published: published, total: counts[id], inPeriod: gained, since: rowSince };
    total += row.total;
    inPeriod += row.inPeriod;
    if (rowSince !== null) since = rowSince;
    return row;
  });
  if (start !== null) {
    const gone = new Set();
    chain.forEach(function (d) { for (const id in rel.snapshots[d]) if (!(id in counts)) gone.add(id); });
    gone.forEach(function (id) {
      const info = rel.info[id];
      inPeriod += gainedIn(id, info ? info[2] : null);
    });
  }
  rows.sort(function (a, b) {
    if (a.published !== b.published) {
      if (a.published === null) return 1;
      if (b.published === null) return -1;
      return a.published < b.published ? 1 : -1;
    }
    return Number(b.id) - Number(a.id);
  });
  return { latest: latest, total: total, inPeriod: inPeriod, since: since, rows: rows };
}

/**
 * Downloads between consecutive snapshots, all on the later date (from/days
 * give the interval; never split per day). Per release a missing count is 0
 * and a drop counts as 0 with clamped set. Other days are null; covered says
 * whether a later snapshot's interval spans them (otherwise: no data).
 */
function releaseDaily(rel, range) {
  if (range === null) return [];
  const dates = Object.keys(rel.snapshots).sort();
  const byDate = {};
  for (let i = 1; i < dates.length; i++) {
    const from = dates[i - 1], to = dates[i];
    if (to < range.start || to > range.end) continue;
    const prev = rel.snapshots[from], cur = rel.snapshots[to];
    let downloads = 0, clamped = false;
    const ids = new Set(Object.keys(prev).concat(Object.keys(cur)));
    ids.forEach(function (id) {
      const diff = (cur[id] || 0) - (prev[id] || 0);
      if (diff < 0) clamped = true;
      else downloads += diff;
    });
    byDate[to] = { from: from, days: Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS), downloads: downloads, clamped: clamped };
  }
  return enumerateDates(range.start, range.end).map(function (d) {
    const hit = byDate[d];
    if (hit) return { date: d, downloads: hit.downloads, from: hit.from, days: hit.days, clamped: hit.clamped, covered: true };
    return { date: d, downloads: null, from: null, days: 0, clamped: false, covered: dates.length > 1 && d > dates[0] && d <= dates[dates.length - 1] };
  });
}
`;
