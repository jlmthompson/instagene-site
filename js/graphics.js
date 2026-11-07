// The "simple graphic" on paper and blog cards, drawn from structured fields. No external images.
// Charts are printed like a two-colour Riso pass: the key ink (currentColor, the topic's --on)
// on top, and a second plate (--plate) a couple of pixels off register underneath.

import { forestLayout, pedigreeLayout, ringArc, slopeLayout, timelineLayout, wrapLabel, FOREST } from "./charts.js";
import { illustration as drawIllustration } from "./illustrations.js";

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVG = "http://www.w3.org/2000/svg";

function svg(tag, attrs, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

// "61%" -> 61, "0.58" -> 0.58, "5 yrs" -> 5, "n/a" -> NaN
const number = (s) => parseFloat(String(s).replace(/[^0-9.\-]/g, ""));

const root = (type, ...children) => h("div", { class: `g g-${type}`, "data-graphic": type }, ...children);
const empty = () => h("div", { class: "g g-empty" });

function stat(g) {
  return root("stat",
    h("span", { class: "g-stat-value" }, g.value),
    h("span", { class: "g-stat-label" }, g.label));
}

function compare(g) {
  const a = number(g.left.value);
  const b = number(g.right.value);
  const scaled = a > 0 && b > 0;
  const max = Math.max(a, b);
  // Bars scale to the larger value with a floor so a small value still reads as a bar.
  const share = (v) => (scaled ? Math.max(0.18, v / max) : 0.7);
  const side = (s, v, cls) =>
    h("div", { class: `g-compare-side ${cls}` },
      h("span", { class: "g-compare-value" }, s.value),
      h("div", { class: "g-compare-bar", style: `--share:${share(v).toFixed(3)}` }),
      h("span", { class: "g-compare-label" }, s.label));
  return root("compare",
    h("div", { class: "g-compare-bars" }, side(g.left, a, "is-left"), side(g.right, b, "is-right")),
    h("p", { class: "g-compare-caption" }, g.caption));
}

function chevron() {
  return svg("svg", { class: "g-step-arrow", viewBox: "0 0 12 20", width: "10", height: "18", "aria-hidden": "true" },
    svg("path", { d: "M2 2l8 8-8 8", fill: "none", stroke: "currentColor", "stroke-width": "3", "stroke-linecap": "round", "stroke-linejoin": "round" }));
}

function icons(g) {
  const steps = [];
  g.steps.forEach((s, i) => {
    if (i) steps.push(chevron());
    steps.push(h("div", { class: "g-step" },
      h("span", { class: "g-step-emoji", "aria-hidden": "true" }, s.emoji),
      h("span", { class: "g-step-label" }, s.label)));
  });
  return root("icons", steps);
}

// ---------- illustration ----------

function illustration(g) {
  const art = drawIllustration(g.name, "il g-ill");
  return art ? root("illustration", art) : empty();
}

// ---------- charts ----------

const heading = (text) => h("p", { class: "g-chart-k" }, text);
const chart = (w, height, ...children) =>
  svg("svg", { class: "g-chart-svg", viewBox: `0 0 ${w} ${height}` }, ...children);

// One text element per line, as text nodes (card data never goes through innerHTML).
function lines(x, y, rows, lineHeight, attrs = {}) {
  return rows.map((t, i) => svg("text", { x, y: y + i * lineHeight, ...attrs }, t));
}

// The same marks twice: second plate offset underneath, key ink on top.
const printed = (make, dx = 2, dy = 2) => [
  svg("g", { class: "plate", transform: `translate(${dx} ${dy})` }, ...make()),
  svg("g", { class: "key" }, ...make()),
];

function forest(g) {
  const W = 326;
  const f = forestLayout(g, W);
  if (!f) return empty();
  const last = f.rows[f.rows.length - 1].y;
  const axisY = last + FOREST.axisGap;
  const marks = () => f.rows.flatMap((r) => [
    svg("path", { d: `M${r.x0} ${r.y}H${r.x1}`, class: "stroke" }),
    svg("circle", { cx: r.x, cy: r.y, r: 6, class: "fill" }),
  ]);
  const labelPerLine = Math.floor((FOREST.plotLeft - 10) / 6.4);
  return root("forest",
    heading(g.heading),
    chart(W, axisY + 6,
      svg("g", { class: "t-label" }, ...f.rows.flatMap((r) => {
        const rows = wrapLabel(r.label, labelPerLine, 2);
        return lines(0, rows.length > 1 ? r.y - 3 : r.y + 4.5, rows, 14);
      })),
      svg("path", { d: `M${f.refX} 2V${last + 16}`, class: "ref" }),
      ...printed(marks),
      svg("g", { class: "t-tick" }, ...f.ticks.map((t) => svg("text", { x: t.x, y: axisY, "text-anchor": "middle" }, t.text)))));
}

const STATUS_TEXT = { affected: "Has it", carrier: "Carries it", unaffected: "Doesn't" };

function personShape(n, r = 9) {
  const cls = n.status === "affected" ? "p-affected" : "p-open";
  if (n.sex === "m") return svg("rect", { x: n.x - r, y: n.y - r, width: 2 * r, height: 2 * r, rx: 1.5, class: cls });
  if (n.sex === "f") return svg("circle", { cx: n.x, cy: n.y, r, class: cls });
  return svg("path", { d: `M${n.x} ${n.y - r - 2}l${r + 2} ${r + 2}l${-r - 2} ${r + 2}l${-r - 2} ${-r - 2}z`, class: cls });
}

function legendGlyph(status) {
  const n = { x: 7, y: 7, sex: "f", status };
  return svg("svg", { class: "g-key-glyph", viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true" },
    personShape(n, 5.5),
    status === "carrier" ? svg("circle", { cx: 7, cy: 7, r: 2.2, class: "p-dot" }) : "");
}

function pedigree(g) {
  const W = 326;
  const p = pedigreeLayout(g, W, 136);
  if (!p) return empty();
  const height = Math.max(...p.nodes.map((n) => n.y)) + 26;
  const statuses = ["affected", "carrier", "unaffected"].filter((s) => p.nodes.some((n) => n.status === s));
  return root("pedigree",
    heading(g.heading),
    chart(W, height,
      svg("g", { class: "lines" }, ...p.lines.map(([x1, y1, x2, y2]) => svg("path", { d: `M${x1} ${y1}L${x2} ${y2}` }))),
      svg("g", { class: "plate", transform: "translate(2 -1.5)" },
        ...p.nodes.filter((n) => n.status === "affected").map((n) => personShape(n))),
      svg("g", { class: "key" }, ...p.nodes.map((n) => personShape(n))),
      ...p.nodes.filter((n) => n.status === "carrier").map((n) => svg("circle", { cx: n.x, cy: n.y, r: 3.5, class: "p-dot" })),
      svg("g", { class: "t-name" }, ...p.nodes.map((n) => svg("text", { x: n.x, y: n.y + 23, "text-anchor": "middle" }, n.label)))),
    h("p", { class: "g-key" }, statuses.map((s) => h("span", {}, legendGlyph(s), STATUS_TEXT[s]))));
}

function timeline(g) {
  const W = 326;
  const t = timelineLayout(g, W);
  if (!t) return empty();
  const pts = t.points;
  const y = 22;
  const perLine = Math.max(8, Math.floor((t.col - 10) / 6));
  const wrapped = pts.map((pt) => wrapLabel(pt.label, perLine, 3));
  const height = 80 + 15 * Math.max(...wrapped.map((r) => r.length)) - 4;
  const lastPt = pts[pts.length - 1];
  return root("timeline",
    heading(g.heading),
    chart(W, height,
      svg("path", { d: `M${pts[0].x - 4} ${y}H${lastPt.x}`, class: "stroke rule" }),
      svg("g", { class: "plate", transform: "translate(2 -2)" },
        ...pts.map((pt) => svg("circle", { cx: pt.x, cy: y, r: pt.last ? 11 : 7, class: "fill" }))),
      svg("g", { class: "key" }, ...pts.filter((pt) => !pt.last).map((pt) => svg("circle", { cx: pt.x, cy: y, r: 7, class: "fill" }))),
      svg("circle", { cx: lastPt.x, cy: y, r: 11, class: "t-end" }),
      svg("path", { d: `M${lastPt.x - 5} ${y}l3.5 3.5 6.5-7`, class: "t-check" }),
      ...pts.flatMap((pt, i) => [
        svg("text", { x: pt.x - 8, y: 62, class: pt.when.length > 5 ? "t-when t-when-long" : "t-when" }, pt.when),
        svg("g", { class: "t-label" }, ...lines(pt.x - 8, 80, wrapped[i], 15)),
      ])));
}

function slope(g) {
  const W = 326, H = 110, X0 = 70, X1 = 196;
  const s = slopeLayout(g, H);
  if (!s) return empty();
  const fmt = (v) => (g.unit === "%" ? `${v}%` : String(v));
  const top = s.lines.reduce((a, b) => (b.ty0 < a.ty0 ? b : a));
  const marks = () => s.lines.flatMap((l) => [
    svg("path", { d: `M${X0} ${l.y0}L${X1} ${l.y1}`, class: "stroke" }),
    svg("circle", { cx: X0, cy: l.y0, r: 5, class: "fill" }),
    svg("circle", { cx: X1, cy: l.y1, r: 5, class: "fill" }),
  ]);
  return root("slope",
    heading(g.heading),
    chart(W, H + 22,
      ...printed(marks),
      svg("g", { class: "t-value" }, ...s.lines.map((l) =>
        svg("text", { x: X0 - 12, y: l.ty0 + 5, "text-anchor": "end" },
          l === top && g.unit && g.unit !== "%" ? `${fmt(l.before)} ${g.unit}` : fmt(l.before)))),
      svg("g", { class: "t-value" }, ...s.lines.map((l) =>
        svg("text", { x: X1 + 12, y: l.ty1 + 5 }, fmt(l.after), svg("tspan", { class: "t-series", dx: 8 }, l.label)))),
      svg("g", { class: "t-axis" },
        svg("text", { x: X0, y: H + 18, "text-anchor": "middle" }, g.before_label),
        svg("text", { x: X1, y: H + 18, "text-anchor": "middle" }, g.after_label))));
}

function ring(g) {
  const a = ringArc(g.value);
  if (!a) return empty();
  const dash = `${a.dash.toFixed(1)} ${a.circumference.toFixed(1)}`;
  return root("ring",
    svg("svg", { class: "g-ring-svg", viewBox: "0 0 120 120", "aria-hidden": "true" },
      svg("circle", { cx: 60, cy: 60, r: 48, class: "ring-track" }),
      svg("circle", { cx: 60, cy: 60, r: 48, class: "ring-plate", "stroke-dasharray": dash, transform: "translate(2.5 -2) rotate(-90 60 60)" }),
      svg("circle", { cx: 60, cy: 60, r: 48, class: "ring-arc", "stroke-dasharray": dash, transform: "rotate(-90 60 60)" })),
    h("div", {},
      h("span", { class: "g-stat-value g-ring-value" }, `${g.value}%`),
      h("span", { class: "g-stat-label" }, g.label)));
}

const RENDERERS = { stat, compare, icons, illustration, forest, pedigree, timeline, slope, ring };

export function renderGraphic(graphic) {
  const fn = graphic && RENDERERS[graphic.type];
  if (!fn) return empty();
  try {
    return fn(graphic);
  } catch (e) {
    // A malformed graphic in the bundle must never take the feed down. No card text in the log.
    console.warn(`instagene: could not draw a ${graphic.type} graphic`, e?.name ?? "Error");
    return empty();
  }
}
const ICONS = {
  heart: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z"/>',
  feed: '<rect x="3.5" y="3.5" width="10" height="8" rx="2.5"/><rect x="15.5" y="3.5" width="5" height="8" rx="2.5"/><rect x="3.5" y="13.5" width="5" height="7" rx="2.5"/><rect x="10.5" y="13.5" width="10" height="7" rx="2.5"/>',
  settings: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5"/>',
};

export function icon(name) {
  const span = h("span", { class: `icon icon-${name}`, "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24">${ICONS[name]}</svg>`;
  return span;
}
