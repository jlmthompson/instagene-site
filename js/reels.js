// The Bench: pure timing and casting rules for a reel frame, its play clock and its audio file.
// No DOM here, so node --test can import it. The drawing and the player are in reel-view.js and
// the sprite (ch-<id>, set-<name>) in index.html.

import { decryptReel } from "./crypto.js";

export const FRAME_MS = 50; // one loudness value (0 to 100) every 50 ms
export const OPEN_AT = 18; // loudness at or above this opens the mouth
export const WIDE_AT = 55; // and at or above this opens it wide
export const BLINK_MS = 120;

// Used only when the bundle has no cast. Mirrors state/reels/bible.json (name, short, role, ink).
export const DEFAULT_CAST = {
  priya: { name: "Priya Nair", short: "Priya", role: "Postdoc, year six", ink: "#3d5588" },
  graham: { name: "Prof. Graham Holt", short: "Graham", role: "PI", ink: "#f15060" },
  kemi: { name: "Kemi Adebayo", short: "Kemi", role: "First-year PhD student", ink: "#ffe800" },
  jun: { name: "Jun Park", short: "Jun", role: "Bioinformatician", ink: "#00a95c" },
  marcus: { name: "Dr Marcus Reyes", short: "Marcus", role: "Collaborator at another institute", ink: "#ff6c2f" },
  r2: { name: "Reviewer 2", short: "Reviewer 2", role: "Off-screen villain", ink: "#1b1f36" },
};

// Where each character's 240 x 284 symbol sits in the 390 x 844 frame, from the approved mockup.
export const SHOT_LAYOUT = {
  two_shot: { left: { x: -34, y: 334, w: 256 }, right: { x: 156, y: 340, w: 256 } },
  talking_head: { x: 40, y: 236, w: 370 },
};

// Index of the beat whose [start_ms, end_ms) holds ms, or -1 (before, after or in a gap).
export function beatAt(beats, ms) {
  return beats.findIndex((b) => ms >= b.start_ms && ms < b.end_ms);
}

// The loudness track's step from a reel file header: its frame_ms, or FRAME_MS when that is
// missing or not a positive number.
export function frameMsOf(header) {
  const f = header?.frame_ms;
  return Number.isFinite(f) && f > 0 ? f : FRAME_MS;
}

export function mouthAt(loud, ms, speaking, frameMs = FRAME_MS) {
  if (!speaking) return "closed";
  // No loudness track (audio missing or not decrypted): flap the mouth every 150 ms.
  if (!loud) return Math.floor(ms / 150) % 2 === 0 ? "open" : "closed";
  const step = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : FRAME_MS;
  const v = loud[Math.floor(ms / step)] ?? 0;
  if (v >= WIDE_AT) return "wide";
  return v >= OPEN_AT ? "open" : "closed";
}

// Who is on screen for beat i. A two-shot pairs the speaker with `partner`, else the nearest other
// speaker before, then after. The pair keeps its sides for the whole episode: whoever speaks first
// stands on the left. A card shot keeps the previous beat's cast.
export function shotCast(beats, i) {
  const b = beats[i];
  if (b.shot === "card") {
    return i > 0 ? { ...shotCast(beats, i - 1), shot: "card" } : { shot: "card", left: b.speaker, right: null };
  }
  if (b.shot !== "two_shot") return { shot: b.shot, left: b.speaker, right: null };
  const other = (list) => list.find((x) => x.speaker !== b.speaker)?.speaker;
  const partner = b.partner ?? other(beats.slice(0, i).reverse()) ?? other(beats.slice(i + 1)) ?? null;
  if (!partner) return { shot: "two_shot", left: b.speaker, right: null };
  const first = (id) => {
    const k = beats.findIndex((x) => x.speaker === id);
    return k === -1 ? Infinity : k;
  };
  const [left, right] = first(partner) < first(b.speaker) ? [partner, b.speaker] : [b.speaker, partner];
  return { shot: "two_shot", left, right };
}

// Text colour on a character's ink: white or navy, whichever has the higher WCAG contrast ratio.
const NAVY = "#1b1f36";

function luminance(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const six = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const lin = (i) => {
    const c = parseInt(six.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function onInk(hex) {
  if (luminance(hex) == null) return "#fff";
  return contrast(hex, NAVY) > contrast(hex, "#ffffff") ? NAVY : "#fff";
}

// Seeded blink starts in [0, durationMs), 2 to 5 s apart. The same seed always blinks the same way.
export function blinkTimes(seed, durationMs) {
  let s = 2166136261; // FNV-1a hash of the seed, then mulberry32
  for (const ch of String(seed)) s = Math.imul(s ^ ch.charCodeAt(0), 16777619);
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [];
  for (let t = 2000 + Math.floor(rand() * 3001); t < durationMs; t += 2000 + Math.floor(rand() * 3001)) out.push(t);
  return out;
}

// Play position in ms. It runs from now() while playing and stops at durationMs.
export function createReelClock({ now = () => performance.now(), durationMs }) {
  let base = 0; // position when last paused or seeked
  let since = null; // now() when play started, or null while paused
  const clamp = (ms) => Math.min(Math.max(ms, 0), durationMs);
  const time = () => clamp(since === null ? base : base + now() - since);
  const ended = () => time() >= durationMs;
  return {
    play() {
      if (since === null && !ended()) since = now();
    },
    pause() {
      base = time();
      since = null;
    },
    seek(ms) {
      base = clamp(ms);
      if (since !== null) since = now();
    },
    time,
    playing: () => since !== null && !ended(),
    ended,
  };
}

// Saved reels keep their audio here (written in Task 11); activate never deletes it.
export const REEL_CACHE = "instagene-reels-saved";

// The decrypted reel {header, audio} from data/reels/<id>.enc, else from the saved-reel cache.
// Null when there is no key, no file anywhere, or the file will not decrypt: the reel then plays
// silently with captions.
export async function loadReelAudio(fetchFn, id, key) {
  if (!key) return null;
  const url = `data/reels/${id}.enc`;
  let buf = null;
  try {
    const res = await fetchFn(url);
    if (res.ok) buf = await res.arrayBuffer();
  } catch {
    buf = null;
  }
  if (!buf && globalThis.caches) {
    try {
      const hit = await (await globalThis.caches.open(REEL_CACHE)).match(url);
      if (hit) buf = await hit.arrayBuffer();
    } catch {
      buf = null;
    }
  }
  if (!buf) return null;
  try {
    return await decryptReel(buf, key);
  } catch {
    return null;
  }
}
