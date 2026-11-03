/*
 * Dashboard chart drawing: the daily chart (lines, bars, gaps, tooltip, keyboard
 * navigation) and the table sparkline. Concatenated after CLIENT_UI (client.ts)
 * into the same inline script, so it uses its helpers (h, svg, fmt, shortDate,
 * rangeText) and the pure math in client-logic.ts (niceScale). Function
 * declarations hoist, so the order relative to CLIENT_UI does not matter.
 * String.raw template: no backticks, no "${", never "</script".
 */

export const CLIENT_CHART = String.raw`
function runs(series, key) {
  const result = [];
  let current = [];
  series.forEach(function (p, i) {
    if (p[key] === null) {
      if (current.length) result.push(current);
      current = [];
    } else current.push(i);
  });
  if (current.length) result.push(current);
  return result;
}

function pathData(run, xAt, yAt, valueAt) {
  return run.map(function (i, k) {
    return (k === 0 ? "M" : "L") + xAt(i).toFixed(1) + " " + yAt(valueAt(i)).toFixed(1);
  }).join(" ");
}

/**
 * Daily chart: opts.lines ({ key, cls }) as lines, opts.bars as bars. Days
 * where opts.isGap(p) get a shaded band and break the lines; partial days get
 * hollow markers. Hover or arrow keys show opts.fill(tooltip, point).
 */
function renderChart(container, series, opts) {
  const lines = opts.lines || [];
  const bars = opts.bars || [];
  const keys = lines.concat(bars).map(function (m) { return m.key; });
  container.textContent = "";
  if (!series.some(function (p) { return keys.some(function (k) { return p[k] !== null; }); })) {
    container.appendChild(h("p", "empty", opts.empty));
    return;
  }
  const width = Math.max(container.clientWidth, 280);
  const height = opts.compact ? (width < 600 ? 180 : 200) : (width < 600 ? 220 : 300);
  const pad = { left: 48, right: 12, top: 12, bottom: 30 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const n = series.length;
  const max = Math.max.apply(null, series.map(function (p) { return Math.max.apply(null, keys.map(function (k) { return p[k] || 0; })); }));
  const scale = niceScale(max);
  const xAt = function (i) { return n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1); };
  const yAt = function (v) { return pad.top + plotH - (v / scale.max) * plotH; };
  const slot = n === 1 ? plotW : plotW / (n - 1);

  const root = svg("svg", {
    width: String(width), height: String(height), viewBox: "0 0 " + width + " " + height,
    role: "img", tabindex: "0",
    "aria-label": opts.label + ", " + rangeText({ start: series[0].date, end: series[n - 1].date }) + ". Use the arrow keys to read daily values.",
  });

  // One band per run of no-data days (adjacent rects would leave seams).
  let gapStart = -1;
  series.forEach(function (p, i) {
    const gap = opts.isGap(p);
    if (gap && gapStart < 0) gapStart = i;
    if (gapStart < 0 || (gap && i < n - 1)) return;
    const last = gap ? i : i - 1;
    const x0 = Math.max(pad.left, xAt(gapStart) - slot / 2);
    const x1 = Math.min(pad.left + plotW, xAt(last) + slot / 2);
    root.appendChild(svg("rect", { class: "c-nodata", x: x0, y: pad.top, width: x1 - x0, height: plotH }));
    gapStart = -1;
  });

  for (let v = 0; v <= scale.max; v += scale.step) {
    const y = yAt(v);
    root.appendChild(svg("line", { class: v === 0 ? "c-axis" : "c-grid", x1: pad.left, x2: pad.left + plotW, y1: y, y2: y }));
    root.appendChild(svg("text", { x: pad.left - 8, y: y + 4, "text-anchor": "end" }, fmt.format(v)));
  }

  // Label backwards from the last day so the data-through date always shows;
  // ranges over a year (e.g. star history) need the year instead of the day.
  const longRange = n > 370;
  const tickLabel = function (d) { return longRange ? MONTHS[Number(d.slice(5, 7)) - 1] + " " + d.slice(0, 4) : shortDate(d); };
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / (longRange ? 72 : 64)))));
  for (let i = n - 1; i >= 0; i -= every) {
    const x = xAt(i);
    const anchor = n > 1 && i === n - 1 ? "end" : n > 1 && x - pad.left < 20 ? "start" : "middle";
    root.appendChild(svg("line", { class: "c-axis", x1: x, x2: x, y1: pad.top + plotH, y2: pad.top + plotH + 4 }));
    root.appendChild(svg("text", { x: anchor === "end" ? x + 4 : x, y: height - 10, "text-anchor": anchor }, tickLabel(series[i].date)));
  }

  const barW = Math.max(1, Math.min(14, slot * 0.7));
  bars.forEach(function (m) {
    series.forEach(function (p, i) {
      if (!p[m.key]) return;
      const y = yAt(p[m.key]);
      root.appendChild(svg("rect", { class: "c-bar " + m.cls, x: xAt(i) - barW / 2, y: y, width: barW, height: pad.top + plotH - y }));
    });
  });

  lines.forEach(function (m) {
    const valueAt = function (i) { return series[i][m.key]; };
    const parts = runs(series, m.key);
    if (parts.length) {
      root.appendChild(svg("path", { class: "c-line " + m.cls, d: parts.map(function (r) { return pathData(r, xAt, yAt, valueAt); }).join(" ") }));
    }
    parts.forEach(function (r) {
      if (r.length === 1) root.appendChild(svg("circle", { class: "c-solo " + m.cls, cx: xAt(r[0]), cy: yAt(valueAt(r[0])), r: 2.5 }));
    });
    series.forEach(function (p, i) {
      if (p.partial && p[m.key] !== null) {
        root.appendChild(svg("circle", { class: "c-partial " + m.cls, cx: xAt(i), cy: yAt(p[m.key]), r: 3.5 }));
      }
    });
  });

  const guide = svg("line", { class: "c-guide", y1: pad.top, y2: pad.top + plotH, visibility: "hidden" });
  const dots = lines.map(function (m) { return svg("circle", { class: "c-dot " + m.cls, r: 4, visibility: "hidden" }); });
  const overlay = svg("rect", { class: "c-overlay", x: pad.left - slot / 2, y: pad.top, width: plotW + slot, height: plotH });
  root.appendChild(guide);
  dots.forEach(function (d) { root.appendChild(d); });
  root.appendChild(overlay);

  const tip = h("div", "tooltip");
  tip.hidden = true;
  container.appendChild(root);
  container.appendChild(tip);

  let active = -1;
  function show(i) {
    active = i;
    const p = series[i];
    const x = xAt(i);
    guide.setAttribute("x1", x.toFixed(1));
    guide.setAttribute("x2", x.toFixed(1));
    guide.setAttribute("visibility", "visible");
    lines.forEach(function (m, k) {
      if (p[m.key] === null) { dots[k].setAttribute("visibility", "hidden"); return; }
      dots[k].setAttribute("cx", x.toFixed(1));
      dots[k].setAttribute("cy", yAt(p[m.key]).toFixed(1));
      dots[k].setAttribute("visibility", "visible");
    });
    opts.fill(tip, p);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = (x + 14 + tw > width ? Math.max(0, x - 14 - tw) : x + 14) + "px";
    tip.style.top = pad.top + "px";
  }
  function hide() {
    active = -1;
    guide.setAttribute("visibility", "hidden");
    dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); });
    tip.hidden = true;
  }
  overlay.addEventListener("pointermove", function (e) {
    const x = e.clientX - root.getBoundingClientRect().left;
    const i = n === 1 ? 0 : Math.round(((x - pad.left) / plotW) * (n - 1));
    show(Math.min(n - 1, Math.max(0, i)));
  });
  overlay.addEventListener("pointerleave", hide);
  root.addEventListener("blur", hide);
  root.addEventListener("keydown", function (e) {
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key === "Escape") { hide(); return; }
    if (!(e.key in moves) && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    // Home/End jump regardless of focus state; an arrow on a fresh focus starts at the newest day
    const to = e.key === "Home" ? 0 : e.key === "End" || active < 0 ? n - 1 : active + moves[e.key];
    show(Math.min(n - 1, Math.max(0, to)));
  });
}

function sparkline(series) {
  const w = 96, ht = 24;
  const root = svg("svg", { class: "spark", width: String(w), height: String(ht), viewBox: "0 0 " + w + " " + ht, "aria-hidden": "true" });
  root.appendChild(svg("line", { class: "base", x1: 0, x2: w, y1: ht - 1.5, y2: ht - 1.5 }));
  const n = series.length;
  const max = Math.max(1, Math.max.apply(null, series.map(function (p) { return p.views || 0; })));
  const xAt = function (i) { return n === 1 ? w / 2 : 1.5 + (i * (w - 3)) / (n - 1); };
  const yAt = function (v) { return ht - 1.5 - (v / max) * (ht - 4); };
  const valueAt = function (i) { return series[i].views; };
  const parts = runs(series, "views");
  if (parts.length) {
    root.appendChild(svg("path", { class: "c-line views", d: parts.map(function (r) { return pathData(r, xAt, yAt, valueAt); }).join(" ") }));
  }
  parts.forEach(function (r) {
    if (r.length === 1) root.appendChild(svg("circle", { class: "c-solo views", cx: xAt(r[0]), cy: yAt(valueAt(r[0])), r: 1.5 }));
  });
  return root;
}
`;
