import { enqueue, flush, installFlushHooks, queuedEvents } from "./events.js";
import { loadBundle, placeExtras, placeReels, stockOf, sydneyToday, visibleFeed } from "./feed.js";
import { h, icon } from "./graphics.js";
import { createReelController, openReelFull, reelCard } from "./reel-view.js";
import { openMoreSheet, paintLabLine, renderCard } from "./render.js";
import { createStore } from "./store.js";
import { restoreFollowing, restoreSaved } from "./sync.js";
import { storyPicks } from "./stories.js";
import { observe } from "./tracker.js";
import { bubbleRow, capBanner, feedView, lockView, messageView, noticeBar, savedView, followingBlock, settingsView, storyView, toast } from "./views.js";

const STOCK_BATCH = 3;
const BAD_PASS = "That passphrase didn't unlock the feed. Check it and try again.";

const store = createStore(window.localStorage);
const app = document.getElementById("app");
const fetchFn = (url, init) => window.fetch(url, init);

let tracker = null;
let tab = "feed";
let bundle = null;
let feedEl = null;
let bubblesEl = null;
let reels = null; // the feed's reel player
let reelKey = null; // decrypts reel audio
const openedFull = new Set(); // reels opened full screen, which counts as started

const now = () => new Date().toISOString();

function show(...els) {
  stopTracking();
  app.replaceChildren(...els.filter(Boolean));
}

// ---------- passphrase ----------

function askPassphrase(message, canCancel) {
  return new Promise((resolve) => {
    show(lockView({ message, canCancel, onSubmit: resolve, onCancel: () => resolve(null) }));
  });
}

async function start({ forgetKey = false } = {}) {
  // forgetKey makes loadBundle ignore the key cached for this salt, so it asks again.
  const s = forgetKey ? { ...store, getKey: async () => null } : store;
  let message = null;
  for (;;) {
    let cancelled = false;
    const prompt = async () => {
      const p = await askPassphrase(message, !!store.getCachedBundle());
      if (p === null) cancelled = true;
      return p;
    };
    const res = await loadBundle(fetchFn, s, prompt);
    if (res.status === "bad-passphrase" && !cancelled) {
      message = BAD_PASS;
      if (res.bundle) {
        return showApp(res.bundle, res.key, { text: BAD_PASS, action: { label: "Try again", onClick: () => start({ forgetKey: true }) } });
      }
      continue;
    }
    if (!res.bundle) {
      return show(messageView("The feed didn't load. Check your connection, then try again.", () => start()));
    }
    const notices = {
      "offline-cached": "You're offline. These are the cards from your last visit.",
      missing: "Today's cards didn't load. These are the cards from your last visit.",
    };
    return showApp(res.bundle, res.key, notices[res.status] ? { text: notices[res.status] } : null);
  }
}

// ---------- saves and tracking ----------

// Saved reels keep their audio in a cache of their own, for offline. Best effort: never blocks the save.
// Chained per id, so a quick unsave runs after the save's add finishes and leaves no orphan.
const reelCacheOps = new Map();
function keepReelAudio(card, on) {
  const prev = reelCacheOps.get(card.id) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
      const cache = await window.caches.open("instagene-reels-saved");
      const url = `data/reels/${card.id}.enc`;
      if (on) await cache.add(url);
      else await cache.delete(url);
    } catch {
      // No Cache API, offline or no file: the reel just will not play offline.
    }
  });
  reelCacheOps.set(card.id, next);
}

function onSave(card, on) {
  if (card.kind === "reel") keepReelAudio(card, on);
  if (on) {
    store.save(card);
    enqueue({ t: "save", id: card.id, at: now(), card });
  } else {
    store.unsave(card.id);
    enqueue({ t: "unsave", id: card.id, at: now() });
  }
  // Keep every rendered copy of this card in step (feed and saved view).
  for (const btn of document.querySelectorAll(`[data-card-id="${CSS.escape(card.id)}"] .act-save`)) {
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector(".act-text").textContent = on ? "Saved" : "Save";
  }
}

// A fact opens the paper it points at (seen or not), else its own sheet with the source link.
function onFactMore(card) {
  const paper = card.ref && bundle.feed?.find((c) => c.id === card.ref);
  openMoreSheet(paper || card);
}

// ---------- following ----------

// Every rendered lab line for this lab (feed and saved view) follows the store.
function repaintLab(key) {
  const on = key in store.getFollowing();
  for (const el of document.querySelectorAll(`.lab-line[data-lab-key="${CSS.escape(key)}"]`)) paintLabLine(el, on);
}

function unfollow(key) {
  store.unfollow(key);
  enqueue({ t: "unfollow", id: key, at: now() });
  repaintLab(key);
}

function onFollow(lab) {
  store.follow(lab);
  enqueue({ t: "follow", id: lab.key, at: now(), lab });
  repaintLab(lab.key);
  toast(`You'll see ${lab.surname} Lab papers first.`, { label: "Undo", onClick: () => unfollow(lab.key) });
}

// ---------- reels ----------

// A reel is seen once it plays to the end, or once she scrolls past it after it started. Once only.
function reelSeen(id) {
  if (store.getSeen().has(id)) return;
  store.markSeen(id);
  enqueue({ t: "seen", id, at: now() });
}

// A tap on the stage: the inline reel pauses and the reel opens full screen with sound.
// Runs inside the tap, so openReelFull can start the AudioContext before anything async.
// Scrolled past (from the tracker, or from the reel player, which still sees a reel the tracker
// already counted as jumped past): seen only if it started, here or full screen.
function onReelPassed(id) {
  if (tab === "feed" && (reels?.started(id) || openedFull.has(id))) reelSeen(id);
}

function openReel(card) {
  openedFull.add(card.id);
  reels?.pauseAll();
  openReelFull(card, {
    cast: bundle.cast,
    audio: reels?.audio(card.id) ?? null,
    onEnded: reelSeen,
    onClose: () => { if (tab !== "settings") reels?.resume(); },
  });
}

function render(card, opts = {}) {
  if (card.kind === "reel") {
    const el = reelCard(card, { cast: bundle.cast, onSave, saved: card.id in store.getSaved(), onMore: onFactMore, onOpen: openReel });
    reels?.watch(el, card);
    return el;
  }
  return renderCard(card, {
    ...opts, onSave, saved: card.id in store.getSaved(), onMore: card.kind === "fact" ? onFactMore : undefined,
    onFollow, following: (card.source?.lab?.key ?? "") in store.getFollowing(),
  });
}

function onExit(el, kind) {
  if (tab !== "feed") return;
  const id = el.dataset.cardId;
  // A card already opened as a story was recorded as seen then; scrolling past it adds nothing.
  if (store.getSeen().has(id)) return;
  // Reels never feed ranking, so never a skip; one she jumped past before it started adds nothing.
  if (el.dataset.kind === "reel") return onReelPassed(id);
  store.markSeen(id);
  enqueue({ t: kind, id, at: now() });
}

// ---------- stories ----------

// Opening a story is an ordinary "seen", recorded once, so the card leaves the feed next time.
function onStoryShow(card) {
  if (!store.getSeen().has(card.id)) {
    store.markSeen(card.id);
    enqueue({ t: "seen", id: card.id, at: now() });
  }
  bubblesEl?.querySelector(`[data-card-id="${CSS.escape(card.id)}"]`)?.classList.add("is-seen");
}

function openStories(picks, start) {
  storyView(picks, start, {
    onShow: onStoryShow,
    onSave,
    onMore: (card) => openMoreSheet(card),
    isSaved: (card) => card.id in store.getSaved(),
  });
}

function startTracking() {
  stopTracking();
  if (feedEl) tracker = observe(feedEl, onExit);
}

function stopTracking() {
  tracker?.disconnect();
  tracker = null;
}

// ---------- views ----------

function stockTaker(seen) {
  const queues = {};
  return (kind) => {
    queues[kind] ??= stockOf(bundle.stock ?? [], kind, seen);
    return queues[kind].splice(0, STOCK_BATCH);
  };
}

function nav() {
  const item = (name, label) =>
    h("button", { class: "nav-item", type: "button", "data-tab": name, "aria-current": tab === name ? "page" : null, onclick: () => setTab(name) },
      icon(name === "saved" ? "heart" : name), h("span", {}, label));
  return h("nav", { class: "nav", "aria-label": "Views" }, item("feed", "Feed"), item("saved", "Saved"), item("settings", "Settings"));
}

async function saveToken(token) {
  store.setToken(token);
  // Events queued before this point; restore* also re-read the queue once the fetches finish.
  // flush is not awaited: the events it sends are still replayed over the repo copy (it may not
  // have them yet), and the events it has not sent stay queued, so nothing is undone either way.
  const before = queuedEvents();
  flush(fetchFn, token);
  const opts = (local) => ({ local, queue: () => queuedEvents(), before });
  try {
    store.setSaved(await restoreSaved(fetchFn, token, opts(store.getSaved)));
  } catch (e) {
    return `Token saved, but restoring saved cards failed (${e.message}). Saves and skips will still sync.`;
  }
  try {
    store.setFollowing(await restoreFollowing(fetchFn, token, opts(store.getFollowing)));
    document.querySelector("#settings .follow-block")?.replaceWith(followingBlock(Object.values(store.getFollowing()), unfollow));
  } catch (e) {
    return `Token saved and saved cards restored, but restoring followed labs failed (${e.message}). Follows will still sync.`;
  }
  return "Token saved. Saved cards and followed labs are restored from the repo.";
}

function setTab(name) {
  // Stop tracking before the feed leaves the layout, so hidden cards never count as scrolled past.
  stopTracking();
  reels?.pauseAll();
  tab = name;
  const main = document.getElementById("view");
  for (const b of document.querySelectorAll(".nav-item")) {
    if (b.dataset.tab === name) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  if (name === "feed") {
    main.replaceChildren(...[bubblesEl, feedEl].filter(Boolean));
    startTracking();
  } else if (name === "saved") {
    main.replaceChildren(savedView({ cards: Object.values(store.getSaved()).reverse(), render }));
  } else {
    main.replaceChildren(settingsView({
      hasToken: !!store.getToken(),
      spend: bundle.spend,
      following: Object.values(store.getFollowing()),
      onUnfollow: unfollow,
      onSaveToken: saveToken,
      onChangePassphrase: () => start({ forgetKey: true }),
    }));
  }
  window.scrollTo(0, 0);
  // The feed and the Saved view both play reels through the one controller.
  if (name !== "settings") reels?.resume();
}

function showApp(b, key, notice) {
  bundle = b;
  reelKey = key ?? null;
  tab = "feed";
  reels?.disconnect();
  reels = createReelController({ fetchFn, getKey: () => reelKey, onEnded: reelSeen, /* a saved reel that plays to the end on the Saved tab counts as seen (ruling): no tab gate */ onPassed: onReelPassed });
  const seen = store.getSeen();
  const visible = visibleFeed(b.feed ?? [], seen, sydneyToday(), new Set(Object.keys(store.getFollowing())));
  const items = visible.filter((c) => c.kind !== "fact" && c.kind !== "reel");
  const facts = visible.filter((c) => c.kind === "fact");
  const reelCards = visible.filter((c) => c.kind === "reel");
  const cards = placeReels(placeExtras(items, facts, stockOf(b.stock ?? [], "archive", seen)), reelCards);
  const picks = storyPicks(b.feed ?? [], seen);
  bubblesEl = bubbleRow(picks, { seenSet: seen, onOpen: (i) => openStories(picks, i) });
  const banner = [notice && noticeBar(notice.text, notice.action), capBanner(b.spend)].filter(Boolean);
  feedEl = feedView({
    cards,
    render,
    takeStock: stockTaker(seen),
    onAppend: (els) => els.forEach((el) => tracker?.watch(el)),
    banner: banner.length ? h("div", { class: "banners" }, banner) : null,
  });
  show(
    h("header", { class: "top" }, h("h1", { class: "wordmark" }, "Instagene")),
    h("main", { id: "view" }, bubblesEl, feedEl),
    nav(),
  );
  window.scrollTo(0, 0);
  startTracking();
}

// ---------- boot ----------

installFlushHooks(window, document);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
start();
