import { h, renderGraphic } from "./graphics.js";
import { illustration } from "./illustrations.js";
import { TOPIC_LABELS, labAvatar, saveButton } from "./render.js";
import { STORY_MS, createStoryPlayer, storyArt } from "./stories.js";

// Bento layout: blog cards with a compact graphic pair up as half-width tiles. A blog with no
// partner becomes a wide card. A fact pairs as a tile with the card right after it when that card
// is a tileable, unpaired blog, and is wide otherwise. Facts and archive cards never move, so a
// blog never looks past one for a partner. Everything else spans the full width.
const tileable = (c) => c?.kind === "blog" && ["stat", "compare"].includes(c.graphic?.type);
const extra = (c) => c.kind === "fact" || c.kind === "archive";

export function arrange(cards) {
  const out = [];
  const used = new Set();
  cards.forEach((c, i) => {
    if (used.has(i)) return;
    if (c.kind === "fact") {
      if (tileable(cards[i + 1])) {
        used.add(i + 1);
        out.push({ card: c, size: "tile" }, { card: cards[i + 1], size: "tile" });
      } else out.push({ card: c, size: "wide" });
      return;
    }
    if (!tileable(c)) {
      out.push({ card: c, size: "full" });
      return;
    }
    let j = -1;
    for (let k = i + 1; k < cards.length && !extra(cards[k]); k++) {
      if (!used.has(k) && tileable(cards[k])) { j = k; break; }
    }
    if (j === -1) {
      out.push({ card: c, size: "wide" });
      return;
    }
    used.add(j);
    out.push({ card: c, size: "tile" }, { card: cards[j], size: "tile" });
  });
  return out;
}

export function lockView({ message, canCancel, onSubmit, onCancel }) {
  const input = h("input", { id: "pass", type: "password", autocomplete: "current-password", required: true, enterkeyhint: "go" });
  const button = h("button", { class: "btn btn-primary", type: "submit" }, "Unlock");
  const form = h("form", { class: "lock-form" },
    h("label", { for: "pass" }, "Passphrase"),
    input,
    h("p", { class: "lock-hint" }, "Use a long passphrase: five or more random words, at least 20 characters."),
    message && h("p", { class: "lock-error", role: "alert" }, message),
    button,
    canCancel && h("button", { class: "btn btn-quiet", type: "button", onclick: onCancel }, "Cancel"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!input.value) return;
    input.disabled = true;
    button.disabled = true;
    button.textContent = "Unlocking";
    onSubmit(input.value);
  });
  queueMicrotask(() => input.focus());
  return h("section", { class: "lock", id: "lock" },
    h("div", { class: "lock-mark", "aria-hidden": "true" }, h("i"), h("i"), h("i"), h("i")),
    h("h1", { class: "wordmark" }, "Instagene"),
    form);
}

export function messageView(text, onRetry) {
  return h("section", { class: "empty-state", role: "status" },
    h("p", {}, text),
    onRetry && h("button", { class: "btn btn-primary", type: "button", onclick: onRetry }, "Try again"));
}

export function noticeBar(text, action) {
  return h("div", { class: "notice", role: "status" },
    h("p", {}, text),
    action && h("button", { class: "btn btn-small", type: "button", onclick: action.onClick }, action.label));
}

export function capBanner(spend) {
  if (!spend?.capped) return null;
  return h("div", { class: "notice notice-cap", role: "status" },
    h("p", {}, `This month's Claude budget of $${spend.cap_usd} is used up, so new papers pause until next month. Quiz and explainer cards still work.`));
}

const KIND_NAMES = { quiz: "quiz", explainer: "explainer" };

// feedView: the day's cards, then the caught-up block with its two stock buttons.
// takeStock(kind) returns the next few unseen stock cards; onAppend(elements) lets the caller
// start tracking them.
export function feedView({ cards, render, takeStock, onAppend, banner }) {
  const grid = h("div", { class: "bento" }, arrange(cards).map(({ card, size }) => render(card, { size })));
  const extra = h("div", { class: "bento bento-extra" });
  const note = h("p", { class: "caught-note", role: "status" });

  const more = (kind) => {
    const picked = takeStock(kind);
    if (!picked.length) {
      note.textContent = `That's every ${KIND_NAMES[kind]} card for now. Fresh ones arrive overnight.`;
      return;
    }
    note.textContent = "";
    const els = picked.map((c) => render(c, { size: "full" }));
    extra.append(...els);
    onAppend?.(els);
    els[0].scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const caught = h("section", { class: "caught-up" },
    h("div", { class: "caught-mark", "aria-hidden": "true" }),
    h("h2", {}, "You're all caught up"),
    h("div", { class: "caught-buttons" },
      h("button", { class: "btn btn-stock btn-quiz", type: "button", onclick: () => more("quiz") }, "More quiz cards"),
      h("button", { class: "btn btn-stock btn-explainer", type: "button", onclick: () => more("explainer") }, "More explainer cards")),
    note);

  return h("section", { class: "view view-feed", id: "feed" }, banner, cards.length ? grid : null, extra, caught);
}

export function savedView({ cards, render }) {
  return h("section", { class: "view view-saved", id: "saved" },
    h("h2", { class: "view-title" }, "Saved"),
    cards.length
      ? h("div", { class: "bento" }, cards.map((c) => render(c, { size: "full" })))
      : h("p", { class: "empty-note" }, "Nothing saved yet. Tap Save on a card and it stays here until you remove it."));
}

// A short message at the bottom of the screen with one action. It removes itself after `ms`.
export function toast(text, action, ms = 5000) {
  document.querySelector(".toast")?.remove();
  // The node is in the page empty and filled on the next tick, so screen readers announce the text.
  const span = h("span", {});
  const el = h("div", { class: "toast", role: "status" }, span);
  setTimeout(() => { span.textContent = text; }, 0);
  const gone = () => { clearTimeout(timer); el.remove(); };
  if (action) el.append(h("button", { class: "toast-action", type: "button", onclick: () => { gone(); action.onClick(); } }, action.label));
  const timer = setTimeout(gone, ms);
  document.body.append(el);
  return el;
}

const TOPIC_KEYS = Object.keys(TOPIC_LABELS);
const topicFor = (key) => TOPIC_KEYS[[...key].reduce((n, c) => n + c.charCodeAt(0), 0) % TOPIC_KEYS.length];

// "Labs you follow": one row per lab. Unfollowing removes the row here and tells the caller.
export function followingBlock(following, onUnfollow) {
  const list = h("div", { class: "follow-list" });
  const empty = h("p", { class: "empty-note follow-empty" }, "No labs yet. Tap Follow on a paper card.");
  const sync = () => { empty.hidden = list.children.length > 0; };
  for (const lab of following) {
    const row = h("div", { class: `follow-row t-${topicFor(lab.key)}`, "data-lab-key": lab.key },
      labAvatar(lab),
      h("span", { class: "follow-t" },
        h("b", {}, `${lab.surname} Lab`),
        h("small", {}, [lab.name, lab.institution].filter(Boolean).join(", "))),
      h("button", { class: "unfollow", type: "button", onclick: () => { row.remove(); sync(); onUnfollow?.(lab.key); } }, "Unfollow"));
    list.append(row);
  }
  sync();
  return h("div", { class: "settings-block follow-block" },
    h("h3", {}, "Labs you follow"),
    h("p", { class: "hint" }, "New papers from these labs go to the top of your feed."),
    list, empty);
}

export function settingsView({ hasToken, spend, following = [], onSaveToken, onChangePassphrase, onUnfollow }) {
  const input = h("input", { id: "token", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    placeholder: hasToken ? "A token is saved on this phone" : "github_pat_..." });
  const status = h("p", { class: "settings-status", role: "status" });
  const form = h("form", { class: "settings-block" },
    h("h3", {}, h("label", { for: "token" }, "GitHub token")),
    h("p", { class: "hint" }, "A fine-grained token with contents write access to the private instagene repo. Saves and skips sync with it. It stays on this phone."),
    input,
    h("button", { class: "btn btn-primary", type: "submit" }, "Save token"),
    status);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = "";
    input.placeholder = "A token is saved on this phone";
    status.textContent = "Token saved. Restoring saved cards.";
    status.textContent = await onSaveToken(t);
  });

  const usd = Number(spend?.usd ?? 0).toFixed(2);
  return h("section", { class: "view view-settings", id: "settings" },
    h("h2", { class: "view-title" }, "Settings"),
    form,
    followingBlock(following, onUnfollow),
    h("div", { class: "settings-block" },
      h("h3", {}, "Claude spend"),
      h("p", { class: "spend" }, `This month: $${usd} of $${spend?.cap_usd ?? 250}`)),
    h("div", { class: "settings-block" },
      h("h3", {}, "Passphrase"),
      h("p", { class: "hint" }, "The passphrase must be a long passphrase, such as five or more random words. The encrypted feed is public, so a short one can be guessed offline."),
      h("button", { class: "btn btn-quiet-solid", type: "button", onclick: onChangePassphrase }, "Change passphrase")));
}

// ---------- story bubbles ----------

const drawing = (name, cls) => illustration(name, cls) ?? illustration("dna", cls);

// One round bubble per pick, above the feed. The ring is dark until the story has been shown.
export function bubbleRow(picks, { seenSet = new Set(), onOpen }) {
  if (!picks.length) return null;
  return h("div", { class: "bubbles" }, picks.map((card, i) => {
    const art = storyArt(card);
    return h("button", {
      class: `bubble t-${card.topic}${seenSet.has(card.id) ? " is-seen" : ""}`,
      type: "button", "data-card-id": card.id, onclick: () => onOpen(i),
    },
    h("span", { class: "bubble-ring", "aria-hidden": "true" },
      h("span", { class: "bubble-in" }, drawing(art.illustration, "il bubble-ill"))),
    h("span", { class: "bubble-label" }, art.label));
  }));
}

// Charts keep their own drawing; a big-number, comparison or emoji graphic (and any chart that
// can't be drawn) gives way to the card's story illustration.
const STORY_CHARTS = ["forest", "pedigree", "timeline", "slope", "ring"];

function storyArtPanel(card, art) {
  if (STORY_CHARTS.includes(card.graphic?.type)) {
    const g = renderGraphic(card.graphic);
    if (!g.classList.contains("g-empty")) return h("div", { class: "story-art story-chart" }, g);
  }
  const name = card.graphic?.type === "illustration" ? card.graphic.name : art.illustration;
  return h("div", { class: "story-art" }, drawing(name, "il story-ill"));
}

const closeIcon = () => {
  const span = h("span", { class: "story-x", "aria-hidden": "true" });
  span.innerHTML = '<svg viewBox="0 0 24 24" width="30" height="30"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  return span;
};

// Full-screen story view over the feed, opened at `start`. Each story runs STORY_MS, then moves
// on; a tap on the left third goes back, anywhere else (outside the buttons) goes forward.
// "Tell me more" leaves the stories for the card's sheet. Appends itself to the body and opens.
export function storyView(cards, start, { onShow, onSave, onMore, onClose, isSaved = () => false }) {
  const dialog = h("dialog", { class: "story", "aria-label": "Tonight's picks", style: `--story-ms:${STORY_MS}ms` });
  const inner = h("div", { class: "story-inner" });
  dialog.append(inner);

  const draw = (i) => {
    const card = cards[i];
    const art = storyArt(card);
    const topic = TOPIC_LABELS[card.topic] ?? card.topic;
    const where = `${i + 1} of ${cards.length} tonight`;
    dialog.className = `story t-${card.topic}`;
    inner.replaceChildren(
      h("div", { class: "story-segs", "aria-hidden": "true" },
        cards.map((_, j) => h("i", { class: j < i ? "is-done" : j === i ? "is-now" : null }, h("b")))),
      h("div", { class: "story-card", "data-card-id": card.id },
        h("div", { class: "story-head" },
          h("span", { class: "story-mini" }, drawing(art.illustration, "il")),
          h("span", { class: "story-who" }, art.label, h("small", {}, art.label === topic ? where : `${topic}, ${where}`)),
          h("button", { class: "story-close", type: "button", "aria-label": "Close", onclick: () => player.close() }, closeIcon())),
        storyArtPanel(card, art),
        h("h2", { class: "story-title" }, card.title),
        h("p", { class: "story-hook" }, card.hook),
        h("div", { class: "story-cta" },
          h("button", { class: "btn story-more", type: "button", onclick: () => { player.close(); onMore?.(card); } }, "Tell me more"),
          saveButton(card, onSave, isSaved(card))),
        i < cards.length - 1 && h("p", { class: "story-tip" }, "Tap the right side for the next pick")));
    // Redrawing removed the focused close button; put focus back on the new one.
    inner.querySelector(".story-close").focus({ preventScroll: true });
    onShow?.(card);
  };

  dialog.addEventListener("click", (e) => {
    if (e.target.closest("button, a")) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX - r.left < r.width / 3) player.prev();
    else player.next();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") player.prev();
    else if (e.key === "ArrowRight") player.next();
    else return;
    e.preventDefault();
  });
  // Escape closes the dialog without going through the player.
  dialog.addEventListener("close", () => player.close());
  // Leaving the app (another app, a locked phone) closes the stories, so timers that fire on
  // resume never mark unseen stories as seen.
  const leave = () => { if (document.hidden) player.close(); };
  const gone = () => player.close();
  document.addEventListener("visibilitychange", leave);
  window.addEventListener("pagehide", gone);

  document.body.append(dialog);
  dialog.showModal();
  const player = createStoryPlayer({
    count: cards.length,
    start,
    onShow: draw,
    onClose: () => {
      document.removeEventListener("visibilitychange", leave);
      window.removeEventListener("pagehide", gone);
      if (dialog.open) dialog.close();
      dialog.remove();
      onClose?.();
    },
  });
  return dialog;
}
