// Phone-side state. localStorage for small things, IndexedDB for the derived CryptoKey
// (a non-extractable CryptoKey can be stored there but not in localStorage).
export const KEYS = {
  seen: "instagene/seen",
  saved: "instagene/saved",
  token: "instagene/token",
  bundle: "instagene/bundle",
  queue: "instagene/queue",
  following: "instagene/following",
};

function readJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

export function indexedDbKeyBackend(idb = globalThis.indexedDB) {
  const open = () =>
    new Promise((resolve, reject) => {
      const req = idb.open("instagene", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("key");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction("key", mode).objectStore("key"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  };
  return {
    get: (salt) => run("readonly", (s) => s.get(salt)),
    set: (salt, key) => run("readwrite", (s) => s.put(key, salt)),
  };
}

export function createStore(storage = globalThis.localStorage, keyBackend) {
  let backend = keyBackend;
  const keys = () => (backend ??= indexedDbKeyBackend());
  return {
    getSeen: () => {
      const a = readJSON(storage, KEYS.seen, []);
      return new Set(Array.isArray(a) ? a : []);
    },
    markSeen(id) {
      const s = this.getSeen();
      s.add(id);
      storage.setItem(KEYS.seen, JSON.stringify([...s]));
    },
    getSaved: () => {
      const o = readJSON(storage, KEYS.saved, {});
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    },
    setSaved: (obj) => storage.setItem(KEYS.saved, JSON.stringify(obj)),
    save(card) {
      this.setSaved({ ...this.getSaved(), [card.id]: card });
    },
    unsave(id) {
      const o = { ...this.getSaved() };
      delete o[id];
      this.setSaved(o);
    },
    getFollowing: () => {
      const o = readJSON(storage, KEYS.following, {});
      return o && typeof o === "object" && !Array.isArray(o) ? o : {};
    },
    setFollowing: (obj) => storage.setItem(KEYS.following, JSON.stringify(obj)),
    follow(lab) {
      this.setFollowing({ ...this.getFollowing(), [lab.key]: lab });
    },
    unfollow(key) {
      const o = { ...this.getFollowing() };
      delete o[key];
      this.setFollowing(o);
    },
    getToken: () => storage.getItem(KEYS.token) || "",
    setToken: (t) => storage.setItem(KEYS.token, t),
    getCachedBundle: () => readJSON(storage, KEYS.bundle, null),
    setCachedBundle: (b) => storage.setItem(KEYS.bundle, JSON.stringify(b)),
    getKey: async (salt) => (await keys().get(salt)) ?? null,
    setKey: (salt, key) => keys().set(salt, key),
  };
}
