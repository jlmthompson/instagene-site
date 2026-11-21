export const SKIP_MS = 1500;

export const classifyExit = (dwellMs) => (dwellMs < SKIP_MS ? "skip" : "seen");

// A card exits when it has been visible and its bottom then goes above the viewport top.
// onExit(cardEl, "skip" | "seen"). Returns a disconnect function.
export function observe(container, onExit) {
  const shownAt = new Map();
  const done = new WeakSet();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = e.target;
      if (done.has(el)) continue;
      if (e.isIntersecting) {
        if (!shownAt.has(el)) shownAt.set(el, performance.now());
      } else if (shownAt.has(el) && e.boundingClientRect.bottom <= 0) {
        const dwell = performance.now() - shownAt.get(el);
        done.add(el);
        shownAt.delete(el);
        io.unobserve(el);
        onExit(el, classifyExit(dwell));
      }
    }
  });
  const watch = (el) => io.observe(el);
  container.querySelectorAll("[data-card-id]").forEach(watch);
  return { watch, disconnect: () => io.disconnect() };
}
