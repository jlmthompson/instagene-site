// Story bubbles: tonight's top unseen papers, opened one after another full screen.
// No DOM at import time (node --test imports this module).
import { TOPIC_LABELS } from "./render.js";

export const STORY_MS = 8000;

const STORY_KINDS = ["paper", "blog"];

// Paper and blog cards from the latest night in the bundle, unseen, highest score first.
export function storyPicks(feedCards, seenSet, n = 3) {
  const items = feedCards.filter((c) => STORY_KINDS.includes(c.kind));
  const latest = items.reduce((max, c) => (c.added > max ? c.added : max), "");
  return items
    .filter((c) => c.added === latest && !seenSet.has(c.id))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, n);
}

// Cards written before story labels existed get the DNA drawing and their topic name.
export function storyArt(card) {
  if (card.story) return card.story;
  return { illustration: "dna", label: TOPIC_LABELS[card.topic] ?? card.topic };
}

// Safari throws "Illegal invocation" if setTimeout is called as a method of another object.
const WINDOW_TIMERS = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id) };

// Steps through `count` stories. onShow(i) runs on every display, including a replay of story 0
// after prev() at the start. next() past the last story, or close(), calls onClose() once.
export function createStoryPlayer({ count, start = 0, onShow, onClose, timers = WINDOW_TIMERS }) {
  let i = start;
  let timer = null;
  let closed = false;

  const stop = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const show = () => {
    stop();
    onShow(i);
    timer = timers.set(next, STORY_MS);
  };
  function next() {
    if (closed) return;
    if (i >= count - 1) return close();
    i += 1;
    show();
  }
  function prev() {
    if (closed) return;
    i = Math.max(0, i - 1);
    show();
  }
  function close() {
    if (closed) return;
    closed = true;
    stop();
    onClose?.();
  }

  show();
  return { next, prev, close, index: () => i };
}
