/**
 * Inline stylesheet for the dashboard. System fonts only (no web fonts); the
 * palette matches the README SVG (views #0969da, clones #bc4c00) in light mode.
 */
export const STYLES = `
:root{--bg:#f6f8fa;--surface:#ffffff;--border:#d0d7de;--text:#1f2328;--muted:#59636e;--subtle:#eff2f5;--views:#0969da;--clones:#bc4c00;--grid:#eaeef2;--axis:#8c959f;--nodata:rgba(140,149,159,.14);--ok:#1a7f37;--err:#cf222e;--warn:#9a6700;--warn-bg:#fff8c5;--warn-border:#d4a72c;--accent:#0969da;--on-accent:#ffffff;--selected:#ddf4ff;--hover:#f6f8fa;--shadow:rgba(31,35,40,.12);--stars:#bf8700;--downloads:#8250df}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--surface:#151b23;--border:#3d444d;--text:#f0f6fc;--muted:#9198a1;--subtle:#212830;--views:#4493f8;--clones:#f0883e;--grid:#262c36;--axis:#656c76;--nodata:rgba(110,118,129,.18);--ok:#3fb950;--err:#f85149;--warn:#d29922;--warn-bg:rgba(187,128,9,.15);--warn-border:rgba(187,128,9,.45);--accent:#4493f8;--on-accent:#0d1117;--selected:rgba(56,139,253,.16);--hover:#1c232c;--shadow:rgba(1,4,9,.6);--stars:#e3b341;--downloads:#ab7df8}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html{color-scheme:light dark}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:1120px;margin:0 auto;padding:32px 24px 40px}
h1{font-size:26px;line-height:1.25;margin:0 0 6px;font-weight:650;letter-spacing:-.01em}
h2{font-size:16px;line-height:1.4;margin:0;font-weight:600}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
code{font:12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--subtle);padding:1px 5px;border-radius:4px;word-break:break-all}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;margin:0;color:var(--muted)}
.meta strong{color:var(--text);font-weight:600}
.note{margin:8px 0 0;color:var(--muted);font-size:12px}
.badge{display:inline-flex;align-items:center;gap:4px;padding:0 8px;border:1px solid;border-radius:999px;font-size:12px;font-weight:500;line-height:20px;white-space:nowrap}
.badge.danger{color:var(--err);border-color:currentColor}
.badge.warn{color:var(--warn);background:var(--warn-bg);border-color:var(--warn-border)}
.scopebar{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin:28px 0 12px;scroll-margin-top:12px}
.scope h2{font-size:18px;word-break:break-word}
.scope p{margin:2px 0 0;color:var(--muted);font-size:13px}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.btn{font:inherit;font-size:13px;color:var(--text);background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:4px 12px;cursor:pointer}
.btn:hover{background:var(--hover)}
.seg{display:inline-flex;background:var(--surface);border:1px solid var(--border);border-radius:6px;overflow:hidden}
.seg button{font:inherit;font-size:13px;color:var(--text);background:none;border:0;padding:4px 14px;cursor:pointer;font-variant-numeric:tabular-nums}
.seg button+button{border-left:1px solid var(--border)}
.seg button:hover{background:var(--hover)}
.seg button[aria-pressed=true]{background:var(--accent);color:var(--on-accent);font-weight:600}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.card,.panel{background:var(--surface);border:1px solid var(--border);border-radius:8px}
.card{padding:14px 16px}
.card .label{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted);font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
.card .value{margin-top:4px;font-size:28px;line-height:1.2;font-weight:600;font-variant-numeric:tabular-nums}
.card .sub{margin-top:4px;color:var(--muted);font-size:12px}
.card .label .badge{letter-spacing:0;text-transform:none}
.card.views .value{color:var(--views)}
.card.clones .value{color:var(--clones)}
.card.stars .value{color:var(--stars)}
.panel{margin-top:12px;padding:16px}
.legend{display:flex;flex-wrap:wrap;gap:4px 18px;margin-bottom:8px;color:var(--muted);font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.legend svg{display:block}
.chart{position:relative;min-height:120px}
.chart svg{display:block}
.chart svg text{fill:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
.empty{margin:0;padding:48px 0;color:var(--muted);text-align:center}
.c-grid{stroke:var(--grid);stroke-width:1}
.c-axis{stroke:var(--axis);stroke-width:1}
.c-nodata{fill:var(--nodata)}
.c-line{fill:none;stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.c-line.views{stroke:var(--views)}
.c-line.clones{stroke:var(--clones)}
.c-solo.views,.c-dot.views{fill:var(--views)}
.c-solo.clones,.c-dot.clones{fill:var(--clones)}
.c-line.stars{stroke:var(--stars)}
.c-solo.stars,.c-dot.stars{fill:var(--stars)}
.c-bar.downloads{fill:var(--downloads)}
.c-partial{fill:var(--surface);stroke-width:1.5}
.c-partial.views{stroke:var(--views)}
.c-partial.clones{stroke:var(--clones)}
.c-partial.legend-only{stroke:var(--muted)}
.c-dot{stroke:var(--surface);stroke-width:2}
.c-guide{stroke:var(--axis);stroke-width:1;stroke-dasharray:3 3}
.c-overlay{fill:transparent;pointer-events:all;cursor:crosshair}
.tooltip{position:absolute;z-index:2;min-width:160px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 6px 18px var(--shadow);font-size:12px;pointer-events:none}
.tooltip .t-date{margin-bottom:4px;font-weight:600}
.tooltip .t-row{display:flex;align-items:center;justify-content:space-between;gap:16px;font-variant-numeric:tabular-nums}
.tooltip .t-row span:first-child{display:inline-flex;align-items:center;gap:6px}
.tooltip .t-sub{color:var(--muted)}
.tooltip .t-sub span:first-child{padding-left:14px}
.tooltip .t-note{margin-top:4px;color:var(--warn)}
.tooltip .t-none{color:var(--muted)}
.swatch{display:inline-block;width:8px;height:8px;border-radius:2px}
.swatch.views{background:var(--views)}
.swatch.clones{background:var(--clones)}
.swatch.stars{background:var(--stars)}
.swatch.downloads{background:var(--downloads)}
.tooltip div.t-sub{margin-top:2px;max-width:240px}
.panelhead{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 16px;margin-bottom:10px}
.panelhead p{margin:0;color:var(--muted);font-size:12px}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px 28px}
h3{margin:0 0 2px;font-size:13px;font-weight:600}
.mini{table-layout:fixed}
.mini td{padding-top:6px;padding-bottom:6px}
.mini td.text{overflow:hidden}
.mini .line{display:block;overflow:hidden;text-overflow:ellipsis}
.mini .line.sub{color:var(--muted);font-size:12px}
.mini tbody tr{cursor:default}
.mini tbody tr:hover{background:none}
#rel-chart{margin-bottom:8px}
.since{margin-left:6px;color:var(--muted);font-size:12px}
.linkbtn{max-width:100%;padding:0;font:inherit;font-weight:600;color:var(--accent);text-align:left;background:none;border:0;cursor:pointer}
.linkbtn:hover{text-decoration:underline}
.tablebar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px;margin-bottom:10px}
.tabletitle{display:flex;align-items:baseline;gap:10px}
.tabletitle span{color:var(--muted);font-size:12px}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}
input[type=search]{width:240px;max-width:100%;padding:5px 10px;font:inherit;font-size:13px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:6px}
.check{display:inline-flex;align-items:center;gap:6px;color:var(--muted);font-size:13px;cursor:pointer;user-select:none}
.tablewrap{overflow-x:auto;margin:0 -16px;padding:0 16px}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:8px 10px;border-bottom:1px solid var(--border);text-align:left;white-space:nowrap;vertical-align:middle}
th{color:var(--muted);font-size:12px;font-weight:600}
th:first-child,td:first-child{padding-left:4px}
th:last-child,td:last-child{padding-right:4px}
.num{text-align:right}
th button{display:inline-flex;align-items:center;gap:4px;padding:0;font:inherit;color:inherit;background:none;border:0;cursor:pointer;white-space:nowrap}
th button:hover{color:var(--text)}
th .arrow{display:inline-block;width:10px;font-size:10px}
th .arrow.idle{visibility:hidden}
th button:hover .arrow.idle{visibility:visible;opacity:.4}
tbody tr{cursor:pointer}
tbody tr:hover{background:var(--hover)}
tbody tr.selected{background:var(--selected)}
tbody tr.selected td:first-child{box-shadow:inset 3px 0 var(--accent)}
tbody tr:focus-visible{outline-offset:-2px}
tbody tr:last-child td{border-bottom:0}
td.name a{font-weight:600}
td.dim{color:var(--muted)}
.mark{color:var(--warn);font-weight:600;margin-left:1px}
.pill{display:inline-block;padding:0 8px;border:1px solid var(--border);border-radius:999px;color:var(--muted);font-size:12px;line-height:20px}
.status{display:inline-flex;align-items:center;gap:6px;font-size:13px}
.status::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;flex:none}
.status.ok{color:var(--ok)}
.status.err{color:var(--err)}
.status.off{color:var(--muted)}
.spark{display:block}
.spark .c-line{stroke-width:1.5}
.spark .base{stroke:var(--grid)}
.norows td{padding:24px;color:var(--muted);text-align:center;cursor:default}
.norows:hover{background:none}
.foot{margin:12px 0 0;color:var(--muted);font-size:12px}
footer{margin-top:20px;color:var(--muted);font-size:12px;text-align:center}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media (max-width:640px){main{padding:20px 14px 32px}h1{font-size:22px}.card .value{font-size:24px}.scopebar{align-items:flex-start}input[type=search]{width:100%}.controls{width:100%}}
`;
