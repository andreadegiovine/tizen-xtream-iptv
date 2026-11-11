/**
 * Pure scroll maths (all positions share one coordinate space, e.g. the viewport).
 * Returns the scrollTop that keeps [elTop, elBottom] inside [viewTop, viewBottom] with a margin.
 */
export function computeScrollTop({ elTop, elBottom, viewTop, viewBottom, scrollTop, margin = 0 }) {
  const viewHeight = viewBottom - viewTop;
  // Taller than the viewport: show its beginning.
  if (elBottom - elTop + margin * 2 > viewHeight) return scrollTop + (elTop - margin - viewTop);
  if (elTop - margin < viewTop) return scrollTop - (viewTop - (elTop - margin));
  if (elBottom + margin > viewBottom) return scrollTop + (elBottom + margin - viewBottom);
  return scrollTop;
}

let held = 0;
/**
 * Runs `fn` with the scroll held: the focus given by the pointer (an element under the mouse, a tap) never moves the page under it, the
 * user scrolls it themselves.
 */
export function withoutScroll(fn) {
  held += 1;
  try {
    return fn();
  } finally {
    held -= 1;
  }
}
export const scrollHeld = () => held > 0;

/** Brings an element of a list into view (the nearest edge), unless the pointer gave the focus. */
export function revealNearest(node) {
  if (!held && node && node.scrollIntoView) node.scrollIntoView({ block: 'nearest' });
}

/** Scrolls the closest `.page` so that `el` is fully visible. `first: true` also reveals the page heading. */
export function ensureVisible(el, { margin = 32, first = false } = {}) {
  if (held) return;
  const page = el && el.closest ? el.closest('.page') : null;
  if (!page) return;
  if (first) {
    page.scrollTop = 0;
    return;
  }
  const pageRect = page.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  // A sticky head (title + page number) covers the top of the viewport: keep the element below it.
  const sticky = page.querySelector('.sticky-head');
  const inset = sticky ? sticky.getBoundingClientRect().height : 0;
  const next = Math.max(
    0,
    computeScrollTop({
      elTop: rect.top,
      elBottom: rect.bottom,
      viewTop: pageRect.top + inset,
      viewBottom: pageRect.bottom,
      scrollTop: page.scrollTop,
      margin,
    }),
  );
  if (next !== page.scrollTop) page.scrollTop = next; // already in view: no write, no extra layout
}
