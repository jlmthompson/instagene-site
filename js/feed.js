import { decryptWithKey, deriveKey } from "./crypto.js";

const DAY_MS = 86400000;

export function sydneyToday(now = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

const dayNumber = (ymd) => Date.parse(ymd + "T00:00:00Z") / DAY_MS;

const labKey = (c) => c.source?.lab?.key;

export function visibleFeed(cards, seenSet, today, followed = new Set()) {
  const t = dayNumber(today);
  const sorted = cards
    .filter((c) => !seenSet.has(c.id) && t < dayNumber(c.added) + 7)
    .sort((a, b) => (a.added < b.added ? 1 : a.added > b.added ? -1 : (b.score ?? 0) - (a.score ?? 0)));
  const isFollowed = (c) => followed.has(labKey(c));
  return [...sorted.filter(isFollowed), ...sorted.filter((c) => !isFollowed(c))];
}

// One fact or archive card after item 5, then after every 6 more, then 5, alternating. Every
// third slot (3rd, 6th, ...) takes the next archive card, else the next fact. The other slots take
// the next fact, else the next archive card. A slot with neither stays empty. Leftovers are not appended.
export function placeExtras(items, facts, archive) {
  const out = [];
  const f = [...facts];
  const a = [...archive];
  let slot = 0;
  let gap = 5;
  let run = 0;
  for (const item of items) {
    out.push(item);
    if (++run < gap) continue;
    run = 0;
    gap = gap === 5 ? 6 : 5;
    const next = slot++ % 3 === 2 ? a.shift() ?? f.shift() : f.shift() ?? a.shift();
    if (next) out.push(next);
  }
  return out;
}

export function stockOf(stock, kind, seenSet) {
  return stock.filter((c) => c.kind === kind && !seenSet.has(c.id));
}

const validEnvelope = (e) => e && typeof e === "object" && ["salt", "iv", "ct"].every((k) => typeof e[k] === "string") && e.v != null;

export async function loadBundle(fetchFn, store, promptPassphrase) {
  const cached = store.getCachedBundle();
  const fail = (status) => ({ bundle: cached ?? null, status });

  let res;
  try {
    res = await fetchFn("data/bundle.enc");
  } catch {
    return fail(cached ? "offline-cached" : "missing");
  }
  if (!res.ok) return fail("missing");

  let env;
  try {
    env = JSON.parse(await res.text());
  } catch {
    return fail("missing");
  }
  if (!validEnvelope(env)) return fail("missing");

  try {
    let key = null;
    try {
      key = await store.getKey(env.salt);
    } catch {
      key = null;
    }
    let data;
    if (key) {
      try {
        data = await decryptWithKey(env, key);
      } catch (e) {
        if (e.message !== "bad-passphrase") throw e;
      }
    }
    if (data === undefined) {
      const pass = await promptPassphrase();
      if (!pass) return fail("bad-passphrase");
      key = await deriveKey(pass, env.salt, env.iter);
      data = await decryptWithKey(env, key);
      try {
        await store.setKey(env.salt, key);
      } catch {
        // Persisting the key is best effort (IndexedDB can be unavailable); the data is already decrypted.
      }
    }
    try {
      store.setCachedBundle(data);
    } catch {
      // Quota or private-mode storage errors must not discard decrypted data.
    }
    return { bundle: data, status: "ok" };
  } catch (e) {
    return fail(e.message === "bad-passphrase" ? "bad-passphrase" : "missing");
  }
}
