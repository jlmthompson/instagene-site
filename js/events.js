import { KEYS, createStore } from "./store.js";

const REPO = "jlmthompson/instagene";
let flushing = false;

const readQueue = (storage) => {
  try {
    const q = JSON.parse(storage.getItem(KEYS.queue) || "[]");
    return Array.isArray(q) ? q : [];
  } catch {
    return [];
  }
};

// The events not yet sent, oldest first.
export function queuedEvents(storage = globalThis.localStorage) {
  return readQueue(storage).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

export function queueLength(storage = globalThis.localStorage) {
  return readQueue(storage).length;
}

// `at` must be new Date().toISOString(): the pipeline orders events by string comparison.
export function enqueue(event, storage = globalThis.localStorage) {
  const e = { ...event, at: event.at ?? new Date().toISOString() };
  storage.setItem(KEYS.queue, JSON.stringify([...readQueue(storage), e]));
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const rand6 = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

const MAX_BODY_BYTES = 60000; // keepalive fetch bodies are capped near 64KB

const bodyFor = (events) =>
  JSON.stringify({ message: "events", content: toBase64Utf8(events.map((e) => JSON.stringify(e)).join("\n") + "\n") });

function chunkEvents(events) {
  const chunks = [];
  let cur = [];
  for (const e of events) {
    if (cur.length && bodyFor([...cur, e]).length >= MAX_BODY_BYTES) {
      chunks.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// File names avoid ':' (not allowed in Windows checkouts) and keep '.' only before the extension.
const stamp = (d) => d.toISOString().replace(/[:.]/g, "-");

// Returns the number of events sent. One PUT per chunk; each chunk leaves the queue only on its
// own 201, and the first failure stops the run with the remainder still queued.
// keepalive is used only when the page is hidden (it must outlive the page then). WebKit may
// reject a preflighted cross-origin keepalive request, so a visible page sends a plain fetch.
export async function flush(fetchFn, token, now = new Date(), storage = globalThis.localStorage,
  visibility = globalThis.document?.visibilityState ?? "visible") {
  if (!token || flushing) return 0;
  const batch = readQueue(storage);
  if (!batch.length) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const chunk of chunkEvents(batch)) {
      const name = `${stamp(now)}-${rand6()}.jsonl`;
      const res = await fetchFn(`https://api.github.com/repos/${REPO}/contents/events/${name}`, {
        method: "PUT",
        keepalive: visibility === "hidden",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: bodyFor(chunk),
      });
      if (res.status !== 201) break;
      // Drop only what was sent; events queued during the request stay.
      sent += chunk.length;
      storage.setItem(KEYS.queue, JSON.stringify(readQueue(storage).slice(chunk.length)));
    }
  } catch {
    // network failure: keep the rest queued
  } finally {
    flushing = false;
  }
  return sent;
}

export function installFlushHooks(win, doc) {
  const store = createStore(win.localStorage);
  const run = (visibility = doc.visibilityState) =>
    flush((u, i) => win.fetch(u, i), store.getToken(), new Date(), win.localStorage, visibility);
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "hidden") run();
  });
  // The page is going away, so the request must outlive it whatever visibilityState says.
  win.addEventListener("pagehide", () => run("hidden"));
  if (doc.readyState === "complete") run();
  else win.addEventListener("load", () => run());
}
