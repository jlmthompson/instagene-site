// Layout maths for the chart graphics. Pure functions, no DOM: each returns coordinates in the
// chart's own viewBox, or null when the input cannot be drawn honestly (graphics.js then shows an
// empty art panel).

const finite = (...xs) => xs.every((x) => typeof x === "number" && Number.isFinite(x));
const round = (x) => Math.round(x * 10) / 10;

// Split a label into at most `maxLines` lines of roughly `perLine` characters, on spaces.
export function wrapLabel(text, perLine, maxLines = 2) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last != null && (last + " " + w).length <= perLine) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  if (lines.length > maxLines) lines.splice(maxLines - 1, lines.length, lines.slice(maxLines - 1).join(" "));
  return lines;
}

// ---------- forest: dot and whisker against a reference line ----------

export const FOREST = { plotLeft: 136, plotRight: 12, rowTop: 18, rowGap: 34, axisGap: 34 };

const FRACTIONS = { 1: "1", 2: "½", 4: "¼", 8: "⅛", 16: "1/16" };

function niceStep(span) {
  const raw = span / 3;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

const trim = (x) => String(Number(x.toPrecision(6)));

export function forestLayout(g, w = 326) {
  const rows = g?.rows;
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 4 || !finite(g.ref)) return null;
  for (const r of rows) {
    if (!r || !finite(r.est, r.lo, r.hi) || r.lo > r.est || r.est > r.hi) return null;
  }
  const log = g.ref > 0 && rows.every((r) => r.lo > 0);
  const t = log ? Math.log : (v) => v;
  let lo = Math.min(t(g.ref), ...rows.map((r) => t(r.lo)));
  let hi = Math.max(t(g.ref), ...rows.map((r) => t(r.hi)));
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const left = FOREST.plotLeft, right = w - FOREST.plotRight;
  const X = (v) => round(left + ((t(v) - lo) / (hi - lo)) * (right - left));

  const refX = X(g.ref);
  const ticks = [{ x: refX, text: "no change" }];
  const room = (x, gap) => x >= left - 4 && x <= right + 4 && ticks.every((k) => Math.abs(k.x - x) >= (k.text === "no change" ? 52 : gap));
  if (log) {
    // Doublings and halvings of the reference: ½×, 2×, 4× ...
    for (let k = 1; k <= 6; k++) {
      for (const v of [g.ref * 2 ** k, g.ref / 2 ** k]) {
        const x = X(v);
        if (!room(x, 34)) continue;
        const text = g.ref === 1 ? (v > 1 ? `${2 ** k}×` : `${FRACTIONS[2 ** k] ?? `1/${2 ** k}`}×`) : trim(v);
        ticks.push({ x, text });
      }
    }
  } else {
    const step = niceStep(hi - lo);
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
      const x = X(v);
      if (room(x, 34)) ticks.push({ x, text: trim(v) });
    }
  }
  ticks.sort((a, b) => a.x - b.x);

  return {
    rows: rows.map((r, i) => ({ label: r.label, y: FOREST.rowTop + i * FOREST.rowGap, x: X(r.est), x0: X(r.lo), x1: X(r.hi) })),
    refX,
    ticks,
    log,
  };
}

// ---------- pedigree: a small family tree ----------

// Each couple owns a block of slots wide enough for its children; parents sit at the block's
// outer slots, so every child lands between its parents. A couple where both partners have
// parents in the chart (two sets of grandparents) sits across the join of the two blocks.
export function pedigreeLayout(g, w = 326, h = 126) {
  const people = g?.people;
  if (!Array.isArray(people) || people.length < 2 || people.length > 8) return null;
  const byId = new Map();
  for (const p of people) {
    if (!p || typeof p.id !== "string" || byId.has(p.id)) return null;
    if (!Number.isInteger(p.gen) || p.gen < 1 || p.gen > 3 || !Array.isArray(p.parents)) return null;
    byId.set(p.id, p);
  }
  const couples = new Map(); // key -> {a, b, kids: []}
  const coupleOf = new Map(); // person id -> couple key
  for (const p of people) {
    if (!p.parents.length) continue;
    const [a, b] = p.parents;
    if (p.parents.length !== 2 || a === b) return null;
    for (const id of p.parents) {
      const q = byId.get(id);
      if (!q || q.gen !== p.gen - 1) return null;
    }
    const [m1, m2] = people.indexOf(byId.get(a)) < people.indexOf(byId.get(b)) ? [a, b] : [b, a];
    const key = `${m1}\u0000${m2}`;
    for (const id of [m1, m2]) {
      if (coupleOf.has(id) && coupleOf.get(id) !== key) return null; // children with two partners
      coupleOf.set(id, key);
    }
    if (!couples.has(key)) couples.set(key, { a: m1, b: m2, kids: [] });
    couples.get(key).kids.push(p.id);
  }

  const parentKey = (id) => {
    const p = byId.get(id);
    return p.parents.length ? coupleOf.get(p.parents[0]) : null;
  };
  const descended = (c) => [c.a, c.b].filter((id) => byId.get(id).parents.length);

  // Bridges: both partners have parents in the chart. Put one partner last among its siblings and
  // the other first, and remember that the two parent blocks must sit side by side.
  const bridges = [];
  for (const c of couples.values()) {
    const d = descended(c);
    if (d.length !== 2) continue;
    const [left, right] = d;
    const lk = parentKey(left), rk = parentKey(right);
    if (lk === rk) return null; // siblings as partners: not drawn
    const lKids = couples.get(lk).kids, rKids = couples.get(rk).kids;
    lKids.splice(lKids.indexOf(left), 1); lKids.push(left);
    rKids.splice(rKids.indexOf(right), 1); rKids.unshift(right);
    bridges.push({ couple: c, lk, rk });
  }
  const bridged = new Set(bridges.flatMap((b) => [b.couple.a, b.couple.b]));

  // The couple a person heads as the descended partner (not a bridge).
  const ownCouple = (id) => {
    const key = coupleOf.get(id);
    if (!key || bridged.has(id)) return null;
    const c = couples.get(key);
    return descended(c).length === 1 ? c : null;
  };
  const coupleWidth = (c) => Math.max(2, c.kids.reduce((s, k) => s + childWidth(k), 0));
  const childWidth = (id) => {
    const c = ownCouple(id);
    return c ? coupleWidth(c) : 1;
  };

  const slot = new Map(); // id -> slot centre
  const placeCouple = (c, left, outer) => {
    const W = coupleWidth(c);
    // In a descended couple the married-in partner goes on the outer side.
    let [a, b] = [c.a, c.b];
    const d = descended(c);
    if (d.length === 1) {
      const self = d[0], spouse = self === a ? b : a;
      [a, b] = outer === "left" ? [spouse, self] : [self, spouse];
    }
    slot.set(a, left + 0.5);
    slot.set(b, left + W - 0.5);
    let x = left + (W - c.kids.reduce((s, k) => s + childWidth(k), 0)) / 2;
    c.kids.forEach((k, i) => {
      const own = ownCouple(k);
      if (own) {
        const side = i === 0 && c.kids.length > 1 ? "left" : "right";
        placeCouple(own, x, side);
      } else {
        slot.set(k, x + 0.5);
      }
      x += childWidth(k);
    });
    return W;
  };

  // Root units, top generation first, in input order.
  const roots = [];
  const seen = new Set();
  for (const p of [...people].sort((x, y) => x.gen - y.gen)) {
    if (seen.has(p.id) || p.parents.length) continue;
    const key = coupleOf.get(p.id);
    const c = key && couples.get(key);
    if (c && descended(c).length === 0) {
      roots.push({ couple: c, key });
      seen.add(c.a).add(c.b);
    } else if (!c) {
      roots.push({ single: p.id });
      seen.add(p.id);
    }
    // Married-in partners are placed with their partner's block.
  }
  // Keep bridged parent blocks adjacent: move each right block to just after its left block.
  for (const b of bridges) {
    const ri = roots.findIndex((r) => r.key === b.rk);
    if (ri < 0) return null;
    const [r] = roots.splice(ri, 1);
    const li = roots.findIndex((x) => x.key === b.lk);
    if (li < 0) return null;
    r.gapBefore = Math.max(0, b.couple.kids.length - 1);
    roots.splice(li + 1, 0, r);
  }
  let cursor = 0;
  for (const r of roots) {
    cursor += r.gapBefore ?? 0;
    if (r.single) { slot.set(r.single, cursor + 0.5); cursor += 1; }
    else cursor += placeCouple(r.couple, cursor, "right");
  }
  // Children of a bridge sit evenly between the two partners.
  for (const b of bridges) {
    const xa = slot.get(b.couple.a), xb = slot.get(b.couple.b);
    const [l, r] = xa < xb ? [xa, xb] : [xb, xa];
    b.couple.kids.forEach((k, i) => slot.set(k, l + ((r - l) * (i + 1)) / (b.couple.kids.length + 1)));
  }
  if (slot.size !== people.length) return null;

  // Slots to coordinates.
  const total = cursor;
  const pad = 30;
  const unit = Math.min(70, (w - 2 * pad) / Math.max(total - 1, 1));
  const span = unit * (total - 1);
  const x0 = (w - span) / 2;
  const X = (s) => round(x0 + (s - 0.5) * unit);
  const gens = [...new Set(people.map((p) => p.gen))].sort();
  const top = 12, bottom = h - 26;
  const step = gens.length > 1 ? Math.min(52, (bottom - top) / (gens.length - 1)) : 0;
  const Y = (gen) => round(top + gens.indexOf(gen) * step);

  const nodes = people.map((p) => ({ id: p.id, label: p.label, sex: p.sex, status: p.status, x: X(slot.get(p.id)), y: Y(p.gen) }));
  const at = new Map(nodes.map((n) => [n.id, n]));

  // Guard: every child between its parents and no two people on one spot.
  const spots = new Set(nodes.map((n) => `${n.x},${n.y}`));
  if (spots.size !== nodes.length) return null;

  const lines = [];
  for (const c of couples.values()) {
    const A = at.get(c.a), B = at.get(c.b);
    const [l, r] = A.x < B.x ? [A, B] : [B, A];
    lines.push([l.x, l.y, r.x, r.y]);
    const mid = round((l.x + r.x) / 2);
    const kids = c.kids.map((k) => at.get(k));
    for (const k of kids) if (k.x < l.x || k.x > r.x) return null;
    const ky = kids[0].y;
    const sib = round(ky - Math.min(18, (ky - l.y) / 2));
    lines.push([mid, l.y, mid, sib]);
    const xs = kids.map((k) => k.x).concat(mid);
    lines.push([Math.min(...xs), sib, Math.max(...xs), sib]);
    for (const k of kids) lines.push([k.x, sib, k.x, k.y]);
  }
  return { nodes, lines };
}

// ---------- timeline: three or four dated steps ----------

export function timelineLayout(g, w = 326) {
  const ev = g?.events;
  if (!Array.isArray(ev) || ev.length < 3 || ev.length > 4) return null;
  if (!ev.every((e) => e && typeof e.when === "string" && typeof e.label === "string")) return null;
  const col = (w - 8) / ev.length;
  return {
    points: ev.map((e, i) => ({ x: round(16 + i * col), when: e.when, label: e.label, last: i === ev.length - 1 })),
    col: round(col),
  };
}

// ---------- slope: before and after ----------

export function slopeLayout(g, h = 110) {
  const s = g?.series;
  if (!Array.isArray(s) || s.length < 1 || s.length > 4) return null;
  if (!s.every((x) => x && finite(x.before, x.after))) return null;
  const vals = s.flatMap((x) => [x.before, x.after]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const top = 8, bottom = h - 8;
  const Y = (v) => round(hi === lo ? (top + bottom) / 2 : top + ((hi - v) / (hi - lo)) * (bottom - top));
  const lines = s.map((x) => ({ label: x.label, before: x.before, after: x.after, y0: Y(x.before), y1: Y(x.after) }));
  // Text positions pushed apart so close values do not print on top of each other.
  const spread = (key, out) => {
    const order = lines.map((l, i) => i).sort((a, b) => lines[a][key] - lines[b][key]);
    let prev = -Infinity;
    for (const i of order) {
      const y = Math.max(lines[i][key], prev + 15);
      lines[i][out] = round(y);
      prev = y;
    }
    // If pushing ran off the bottom, slide the whole column back up.
    const over = prev - (h - 4);
    if (over > 0) for (const i of order) lines[i][out] = round(lines[i][out] - over);
  };
  spread("y0", "ty0");
  spread("y1", "ty1");
  return { lines };
}

// ---------- ring: one percentage ----------

export function ringArc(value, r = 48) {
  if (!finite(value, r) || value < 0 || value > 100) return null;
  const circumference = 2 * Math.PI * r;
  return { dash: (value / 100) * circumference, circumference };
}
