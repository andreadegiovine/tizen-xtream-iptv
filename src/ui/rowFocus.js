import { VISIBLE_CARDS, AHEAD_CARDS } from './components/carousel.js';

/**
 * The card (or button) the focus is on among some rows of a page, to find it again when the page comes back (a title opened from a
 * carousel, then Back): { id, index } of the focused zone when it is one of `ids`, otherwise null.
 */
export function savedRowFocus(focus, ids) {
  const id = focus.activeId;
  return id && ids.indexOf(id) >= 0 && focus.active ? { id, index: focus.active.index } : null;
}

/**
 * Focuses `index` in a row: a carousel first reads its cards up to there (they are read as the focus moves right), then the focus goes
 * on the card (the last one if the row has fewer now). `row`: { zone, fill? , items? }.
 */
export function focusRowAt(focus, row, index) {
  const want = Math.max(0, index);
  const go = () => {
    const count = row.zone.count;
    focus.focus(row.zone.id, Math.max(0, Math.min(want, count - 1)));
  };
  const reading = row.fill ? row.fill(want + VISIBLE_CARDS + AHEAD_CARDS) : null;
  if (reading && typeof reading.then === 'function') return reading.then(go, go);
  go();
  return Promise.resolve();
}
