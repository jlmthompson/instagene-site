import { h, icon, renderGraphic } from "./graphics.js";
import { ILLUSTRATIONS, illustration } from "./illustrations.js";

export const TOPIC_LABELS = {
  chd: "CHD genetics",
  llm_genomics: "LLMs in genomics",
  regulatory: "Regulatory variants",
  prs_dcm: "PRS and DCM",
  ai_science: "AI for science",
  general_cv: "Heart health",
};

// Card data comes from the bundle and the schema allows any string, so only http(s) URLs are
// used as links or image sources. A javascript: URL would run in the origin that holds the token.
export function safeUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

// Archive photos come from Wikimedia Commons only: https, and the host must be exactly one of
// Commons' two image hosts (so upload.wikimedia.org.evil.com fails).
const PHOTO_HOSTS = ["upload.wikimedia.org", "thumb.wikimedia.org"];
export function safePhotoUrl(url) {
  const href = safeUrl(url);
  if (!href) return null;
  const u = new URL(href);
  return u.protocol === "https:" && PHOTO_HOSTS.includes(u.hostname) ? href : null;
}

const chip = (card, extra) =>
  h("span", { class: "chip" }, extra ? `${extra}, ${TOPIC_LABELS[card.topic] ?? card.topic}` : TOPIC_LABELS[card.topic] ?? card.topic);

export function saveButton(card, onSave, saved) {
  const btn = h("button", { class: "act act-save", type: "button", "aria-label": "Save", "aria-pressed": String(!!saved) },
    icon("heart"),
    h("span", { class: "act-text" }));
  const paint = (on) => {
    btn.setAttribute("aria-pressed", String(on));
    btn.querySelector(".act-text").textContent = on ? "Saved" : "Save";
  };
  paint(!!saved);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = btn.getAttribute("aria-pressed") !== "true";
    paint(on);
    onSave?.(card, on);
  });
  return btn;
}

// Initials for the lab avatar: the first letters of the first two words of the lab's name,
// ignoring "Lab", "Group" and "Unit" ("Chidi Okafor Lab" is CO).
export function labInitials(lab) {
  const words = String(lab.name ?? "").split(/\s+/).filter((w) => w && !/^(lab|group|unit)$/i.test(w));
  const letters = (words.length ? words : [lab.surname ?? "?"]).slice(0, 2).map((w) => [...w][0]).join("");
  return letters.toUpperCase();
}

export const labAvatar = (lab) => h("span", { class: "lab-ava", "aria-hidden": "true" }, labInitials(lab));

export function paintLabLine(el, following) {
  const pill = el.querySelector(".lab-pill");
  pill.disabled = following;
  pill.setAttribute("aria-pressed", String(following));
  pill.classList.toggle("on", following);
  pill.replaceChildren(...(following ? [checkIcon(), "Following"] : ["Follow"]));
}

function checkIcon() {
  const span = h("span", { class: "lab-check", "aria-hidden": "true" });
  span.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 8.5l3 3 7-7"/></svg>';
  return span;
}

// "Okafor Lab, Example University" line under a paper: who wrote it, and a way to follow them.
export function labLine(card, { following = false, onFollow } = {}) {
  const lab = card.kind === "paper" ? card.source?.lab : null;
  if (!lab?.key) return null;
  const follow = (e) => {
    e.stopPropagation();
    if (e.currentTarget.closest(".lab-line").querySelector(".lab-pill").disabled) return;
    onFollow?.(lab);
  };
  const el = h("div", { class: "lab-line", "data-lab-key": lab.key },
    labAvatar(lab),
    h("button", { class: "lab-name", type: "button", onclick: follow },
      h("u", {}, lab.name),
      lab.institution && h("small", {}, lab.institution)),
    h("button", { class: "lab-pill", type: "button", onclick: follow }));
  paintLabLine(el, !!following);
  return el;
}

// Art shown when a card's graphic cannot be drawn (a schema-valid chart the layout can't place,
// or a renderer error): the card's story illustration, else a drawing for its topic.
const TOPIC_ILLUSTRATION = {
  chd: "heart",
  llm_genomics: "laptop_code",
  regulatory: "gene_lens",
  prs_dcm: "family_tree",
  ai_science: "dna",
  general_cv: "stethoscope",
};

function artPanel(card) {
  let g = renderGraphic(card.graphic);
  if (g.classList.contains("g-empty")) {
    const name = ILLUSTRATIONS.includes(card.story?.illustration) ? card.story.illustration : TOPIC_ILLUSTRATION[card.topic];
    if (name) g = renderGraphic({ type: "illustration", name });
  }
  return h("div", { class: g.dataset.graphic === "illustration" ? "art art-ill" : "art" }, g);
}

const hasMore = (card) => !!(card.more || card.source || card.figure || card.ref || card.kind === "fact");

function actions(card, { onSave, onMore, saved }, short = false) {
  return h("div", { class: "actions" },
    saveButton(card, onSave, saved),
    hasMore(card) &&
      h("button", {
        class: "act act-more", type: "button", "aria-label": "Tell me more",
        onclick: (e) => { e.stopPropagation(); (onMore ?? openMoreSheet)(card); },
      }, short ? "More" : "Tell me more"));
}

const base = (card, cls, ...children) =>
  h("article", { class: `card ${cls} t-${card.topic}`, "data-card-id": card.id, "data-kind": card.kind, "data-topic": card.topic }, children);

function itemCard(card, opts) {
  const size = opts.size ?? "full"; // full | wide | tile
  const el = base(card, `card-item size-${size}`,
    artPanel(card),
    h("div", { class: "body" },
      chip(card, card.kind === "blog" ? card.source?.name : null),
      h("h3", { class: "title" }, card.title),
      h("p", { class: "hook" }, card.hook),
      h("div", { class: "detail" },
        h("p", { class: "finding" }, card.finding)),
      actions(card, opts, size === "tile"),
      labLine(card, opts)));
  if (size === "tile") {
    // A tile opens to full width on tap to show the finding.
    el.addEventListener("click", () => el.classList.toggle("is-open"));
  }
  return el;
}

function figureCard(card, opts) {
  const f = card.figure;
  return base(card, "card-figure",
    h("figure", { class: "fig" },
      safeUrl(f.img) && h("img", { src: safeUrl(f.img), alt: f.caption, referrerpolicy: "no-referrer", loading: "lazy", decoding: "async" }),
      h("figcaption", { class: "fig-credit" }, `${f.attribution}. ${f.licence}.`)),
    h("div", { class: "body" },
      chip(card, "Figure"),
      h("h3", { class: "title" }, card.title),
      h("p", { class: "hook" }, f.caption),
      actions(card, opts)));
}

// A "Did you know" card: half width beside a paper tile, or wide when it has no partner.
function factCard(card, opts) {
  const size = opts.size === "wide" ? "wide" : "tile";
  return base(card, `card-fact size-${size}`,
    h("span", { class: "chip" }, "Did you know"),
    h("div", { class: "fact-n", "data-n": card.fact.value }, card.fact.value),
    h("p", { class: "fact-line" }, card.fact.line),
    actions(card, opts, true));
}

// "From the archive": a moment from the history of genetics, with a duotone Commons photo when
// the photo URL passes safePhotoUrl.
function archiveCard(card, opts) {
  const p = card.photo;
  const src = p && safePhotoUrl(p.img);
  const page = p && safeUrl(p.page);
  const credit = p && `Photo: ${p.author}, ${p.licence}`;
  return base(card, "card-archive",
    src && h("div", { class: "photo" },
      h("img", { src, alt: "", referrerpolicy: "no-referrer", loading: "lazy", decoding: "async" }),
      h("span", { class: "photo-cred" }, page ? h("a", { href: page, target: "_blank", rel: "noopener" }, credit) : credit)),
    h("div", { class: "body" },
      h("span", { class: "chip" }, "From the archive"),
      card.year != null && h("div", { class: "archive-year" }, String(card.year)),
      h("h3", { class: "title" }, card.title),
      card.body && h("p", { class: "hook" }, card.body),
      actions(card, opts)));
}

function quizCard(card, opts) {
  const q = card.quiz;
  const explain = h("div", { class: "quiz-explain", hidden: true },
    h("p", { class: "quiz-verdict" }),
    h("p", {}, q.explanation));
  const buttons = q.options.map((text, i) =>
    h("button", { class: "quiz-option", type: "button", onclick: () => answer(i) }, text));
  function answer(i) {
    buttons.forEach((b, j) => {
      b.disabled = true;
      if (j === q.answer_index) b.classList.add("is-right");
      else if (j === i) b.classList.add("is-wrong");
    });
    explain.querySelector(".quiz-verdict").textContent = i === q.answer_index ? "Yes, that's it." : `It's "${q.options[q.answer_index]}".`;
    explain.hidden = false;
  }
  return base(card, "card-quiz",
    h("div", { class: "body" },
      chip(card, "Quiz"),
      h("h3", { class: "quiz-question" }, q.question),
      h("div", { class: "quiz-options" }, buttons),
      explain,
      actions(card, opts)));
}

function explainerCard(card, opts) {
  const dots = card.panels.map(() => h("i", {}));
  dots[0].classList.add("is-on");
  const track = h("div", { class: "panels", tabindex: "0", "aria-label": `${card.title}, swipe for more` },
    card.panels.map((p) =>
      h("section", { class: "panel" },
        illustration(p.illustration, "il panel-ill") ?? h("span", { class: "panel-emoji", "aria-hidden": "true" }, p.emoji),
        h("h4", {}, p.heading),
        h("p", {}, p.body))));
  track.addEventListener("scroll", () => {
    // The last panel is narrower than the track, so at the end of the scroll it never reaches the
    // left edge; treat the end as the last panel, otherwise pick the panel nearest the left edge.
    const panels = [...track.children];
    const atEnd = track.scrollLeft >= track.scrollWidth - track.clientWidth - 1;
    const origin = panels[0].offsetLeft;
    const dist = (p) => Math.abs(p.offsetLeft - origin - track.scrollLeft);
    const i = atEnd ? panels.length - 1 : panels.indexOf(panels.reduce((a, b) => (dist(b) < dist(a) ? b : a)));
    dots.forEach((d, j) => d.classList.toggle("is-on", j === i));
  }, { passive: true });
  return base(card, "card-explainer",
    h("div", { class: "body" }, chip(card, "Explainer"), h("h3", { class: "title" }, card.title)),
    track,
    h("div", { class: "body body-foot" }, h("div", { class: "dots", "aria-hidden": "true" }, dots), actions(card, opts)));
}

export function renderCard(card, opts = {}) {
  switch (card.kind) {
    case "paper":
    case "blog":
      return itemCard(card, opts);
    case "figure":
      return figureCard(card, opts);
    case "fact":
      return factCard(card, opts);
    case "archive":
      return archiveCard(card, opts);
    case "quiz":
      return quizCard(card, opts);
    case "explainer":
      return explainerCard(card, opts);
    default:
      return base(card, "card-unknown", h("div", { class: "body" }, h("h3", { class: "title" }, card.title)));
  }
}

// "Tell me more": a bottom sheet with the longer text and the source link.
export function openMoreSheet(card) {
  const src = card.source;
  const byline = src && [src.authors?.length ? src.authors.join(", ") : null, src.published].filter(Boolean).join(", ");
  const sheet = h("dialog", { class: `sheet t-${card.topic}`, "aria-label": card.title });
  sheet.append(h("div", { class: "sheet-inner", tabindex: "-1", autofocus: true },
    h("div", { class: "sheet-grip", "aria-hidden": "true" }),
    card.kind === "archive" ? h("span", { class: "chip" }, "From the archive") : chip(card),
    h("h2", {}, card.title),
    card.finding && h("p", { class: "finding" }, card.finding),
    card.figure && h("p", {}, card.figure.caption),
    card.more && h("p", { class: "more" }, card.more),
    src && h("div", { class: "sheet-source" },
      h("p", {}, h("strong", {}, src.name), byline ? `. ${byline}` : ""),
      safeUrl(src.url) && h("a", { class: "btn btn-primary", href: safeUrl(src.url), target: "_blank", rel: "noopener" },
        card.kind === "archive" ? "Read on Wikipedia" : `Open on ${src.name}`)),
    h("button", { class: "btn btn-quiet", type: "button", onclick: () => sheet.close() }, "Close")));
  sheet.addEventListener("close", () => sheet.remove());
  // Tapping the dimmed backdrop closes the sheet.
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.close(); });
  document.body.append(sheet);
  sheet.showModal();
  return sheet;
}
