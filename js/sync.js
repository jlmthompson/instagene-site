const BASE = "https://api.github.com/repos/jlmthompson/instagene/contents/";
const RAW = "application/vnd.github.raw+json";

const headers = (token, accept) => ({ Authorization: `Bearer ${token}`, Accept: accept });

// Returns the response, or null for 404. Any other failure throws so a partial
// rebuild is never mistaken for an empty saved list.
async function get(fetchFn, token, path, accept) {
  const res = await fetchFn(BASE + path, { headers: headers(token, accept) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`github ${res.status} for ${path}`);
  return res;
}

// Every event file under events/ (the ones the pipeline has not folded in yet), oldest first.
export async function pendingEvents(fetchFn, token) {
  const events = [];
  const lres = await get(fetchFn, token, "events", "application/vnd.github+json");
  if (lres) {
    const files = (await lres.json()).filter((f) => f.type === "file" && f.name.endsWith(".jsonl"));
    for (const f of files) {
      const r = await get(fetchFn, token, f.path, RAW);
      if (!r) continue;
      for (const line of (await r.text()).split("\n")) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line));
        } catch {
          // skip a corrupt line
        }
      }
    }
  }
  events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return events;
}

async function stateFile(fetchFn, token, path) {
  const res = await get(fetchFn, token, path, RAW);
  return res ? JSON.parse(await res.text()) : {};
}

export async function rebuildSaved(fetchFn, token) {
  const out = { ...(await stateFile(fetchFn, token, "state/saved.json")) };
  for (const e of await pendingEvents(fetchFn, token)) {
    if (e.t === "save" && e.card) out[e.id] = e.card;
    else if (e.t === "unsave") delete out[e.id];
  }
  return out;
}

export async function rebuildFollowing(fetchFn, token) {
  const out = { ...(await stateFile(fetchFn, token, "state/following.json")) };
  for (const e of await pendingEvents(fetchFn, token)) {
    if (e.t === "follow" && e.lab) out[e.id] = e.lab;
    else if (e.t === "unfollow") delete out[e.id];
  }
  return out;
}

// Put events still waiting in the phone's queue over a map rebuilt from the repo, so a change
// made offline (or not yet sent) is not undone by the repo's older copy. `events` must be sorted by at.
export function replayFollowing(map, events) {
  const out = { ...map };
  for (const e of events) {
    if (e.t === "follow" && e.lab) out[e.id] = e.lab;
    else if (e.t === "unfollow") delete out[e.id];
  }
  return out;
}

export function replaySaved(map, events) {
  const out = { ...map };
  for (const e of events) {
    if (e.t === "save" && e.card) out[e.id] = e.card;
    else if (e.t === "unsave") delete out[e.id];
  }
  return out;
}

// The snapshot taken before the fetch plus whatever was queued while it ran (an Unfollow or Unsave
// tapped mid-restore), each event once, oldest first.
function unionQueued(before, now) {
  const seen = new Set();
  const out = [];
  for (const e of [...before, ...now]) {
    const k = `${e.t}|${e.id}|${e.at}`;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// Rebuild from the repo, then lay the phone's own copy and its unsent events over it. `local()`
// and `queue()` are read after the fetches finish, so changes made during them are kept.
export async function restoreSaved(fetchFn, token, { local, queue, before = [] }) {
  const remote = await rebuildSaved(fetchFn, token);
  return replaySaved({ ...remote, ...local() }, unionQueued(before, queue()));
}

export async function restoreFollowing(fetchFn, token, { local, queue, before = [] }) {
  const remote = await rebuildFollowing(fetchFn, token);
  return replayFollowing({ ...remote, ...local() }, unionQueued(before, queue()));
}
