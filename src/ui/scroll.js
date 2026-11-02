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

/** Scrolls the closest `.page` so that `el` is fully visible. `first: true` also reveals the page heading. */
export function ensureVisible(el, { margin = 32, first = false } = {}) {
  const page = el && el.closest ? el.closest('.page') : null;
  if (!page) return;
  if (first) {
    page.scrollTop = 0;
    return;
  }
  const pageRect = page.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  page.scrollTop = Math.max(
    0,
    computeScrollTop({
      elTop: rect.top,
      elBottom: rect.bottom,
      viewTop: pageRect.top,
      viewBottom: pageRect.bottom,
      scrollTop: page.scrollTop,
      margin,
    }),
  );
}
