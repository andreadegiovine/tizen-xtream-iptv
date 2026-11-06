import { h } from '../dom.js';
import { createCard } from './card.js';
import { t, i18n } from '../../i18n/index.js';
import { formatClockTime } from '../../core/clock.js';
import { log } from '../../core/logger.js';
import { icon } from '../icons.js';

/** Minutes → pixels on the time axis (a half hour is 240 px: a 30-minute programme shows a title of ~20 letters). */
export const PX_PER_MIN = 8;
export const ROW_HEIGHT = 128;
export const CHANNEL_WIDTH = 132;
export const RULER_HEIGHT = 44;
const HALF_HOUR = 30 * 60 * 1000;
const HOUR = 2 * HALF_HOUR;
/**
 * The axis starts at the current half hour (never more than 30 minutes ago: what began earlier shows from there) and goes 24 hours
 * forward. PAST_MS: how far before the current half hour it starts.
 */
export const PAST_MS = 0;
export const SPAN_MS = 24 * HOUR;
const ROW_PAGE = 40;

/** First instant of the half hour that contains `ms`. */
export const floorHalfHour = (ms) => Math.floor(ms / HALF_HOUR) * HALF_HOUR;

/** Pixel offset of an instant on the axis that starts at `start`. */
export const xOf = (ms, start) => ((ms - start) / 60000) * PX_PER_MIN;

/**
 * The programmes of one row as segments of the axis [start, end): clipped to it, holes filled with "no information" (so every
 * moment of the row can be focused). A channel without guide is one segment over the whole axis.
 */
export function rowSegments(programmes, start, end) {
  const out = [];
  let at = start;
  (programmes || [])
    .filter((p) => p.stop > start && p.start < end)
    .sort((a, b) => a.start - b.start)
    .forEach((p) => {
      const from = Math.max(p.start, start);
      const to = Math.min(p.stop, end);
      if (to <= at) return; // overlaps the previous one
      if (from > at) out.push({ start: at, stop: from, title: '', empty: true });
      out.push({ start: Math.max(from, at), stop: to, title: p.title || '', desc: p.desc || '', programme: p });
      at = to;
    });
  if (at < end) out.push({ start: at, stop: end, title: '', empty: true });
  return out;
}

/** Index of the segment that holds `ms` (the last one when `ms` is past them all). */
export const segmentAt = (segments, ms) => {
  const i = segments.findIndex((s) => s.start <= ms && s.stop > ms);
  return i >= 0 ? i : Math.max(0, segments.length - 1);
};

/** Index of the programme closest to `at`: the one on, else the next, else the last one (-1 when the row has none). */
export function nextProgramme(segments, at) {
  let last = -1;
  for (let i = 0; i < segments.length; i += 1) {
    if (!segments[i].programme) continue;
    if (segments[i].stop > at) return i;
    last = i;
  }
  return last;
}

/** The horizontal scroll that shows a segment: its start is kept visible, its end too when it fits. */
export function scrollFor(segment, start, x, width) {
  const left = xOf(segment.start, start);
  const right = xOf(segment.stop, start);
  if (left <= x && right >= x + width) return x; // covers the whole screen already: nothing to move
  if (left < x) return Math.max(0, left);
  if (right > x + width) return Math.max(0, Math.min(left, right - width));
  return x;
}

/**
 * Programme guide: one row per channel / group (its small card stays on the left), the programmes on a horizontal time axis with the
 * hours and half hours on top and a line at the current time. Up / Down move between rows (keeping the time), Left / Right between
 * programmes; the axis and the rows scroll with transforms only, and only the rows on screen exist (thousands of channels).
 *
 * `loadRows(offset, limit)` → { entries }, `countRows()` → number, `programmes(channelIds, from, to)` → Map(channelId → list),
 * `onOpen(entry, row, programme)` (the focused programme, null on a hole), `getTimeFormat()` → '24h' | '12h' | 'auto'. `emptyText`: what
 * a hole of the guide says. `pickSegment(segments, now)` → index or -1: the programme a row focuses when reached with Up / Down (by
 * default the one at the time the focus was on).
 * OK held on a row selects it (channel and programmes) and shows `rowActions` ({ id, icon, label }, left to right) at its right:
 * Left / Right move between them, OK runs `onRowAction(id, entry, row)`, Back (`cancelRowMode()`) gives the normal focus back.
 */
export function createEpgGuide({ loadRows, countRows, programmes, onOpen, getTimeFormat = () => 'auto', enrich = null, now = Date.now, emptyText = null, pickSegment = null, rowActions = [], onRowAction = null, defaultRowAction = 0 }) {
  let start = floorHalfHour(now()) - PAST_MS; // moves on with the half hours while the guide stays open
  let end = start + SPAN_MS + PAST_MS;
  const ruler = h('div', { class: 'epg-ruler' });
  const rulerViewport = h('div', { class: 'epg-ruler-viewport' }, ruler);
  const corner = h('div', { class: 'epg-corner' });
  const rowsEl = h('div', { class: 'epg-rows' });
  const nowLine = h('div', { class: 'epg-now' });
  const status = h('p', { class: 'muted epg-status' });
  const actionButtons = rowActions.map((a) => h('button', { class: 'icon-btn', type: 'button', 'aria-label': a.label, title: a.label }, icon(a.icon)));
  const actionsEl = h('div', { class: 'guide-row-actions' }, actionButtons);
  actionsEl.style.display = 'none';
  const selection = h('div', { class: 'guide-row-selection' });
  selection.style.display = 'none';
  const el = h('div', { class: 'epg-guide' }, h('div', { class: 'epg-top' }, corner, rulerViewport), h('div', { class: 'epg-body' }, rowsEl, nowLine, selection, actionsEl), status);
  ruler.style.width = `${xOf(end, start)}px`;

  let total = 0;
  const entries = []; // loaded rows (sparse while pages arrive)
  const pagesLoading = new Map(); // page → Promise
  const guide = new Map(); // channelId → programmes (null while loading)
  let x = xOf(floorHalfHour(now()), start); // the axis starts at the current half hour
  let first = 0; // first row on screen
  let visible = 6; // rows fully on screen
  let drawn = 7; // rows drawn: the visible ones and the one cut by the bottom edge
  let focusRow = 0;
  let focusSeg = -1;
  let focusTime = now();
  let focused = false;
  let destroyed = false;
  let rowNodes = new Map(); // row → { el, track, segments, segNodes }
  let clock = null;
  let rowMode = null; // { button } while a row is selected (OK held)
  const noInfo = () => (emptyText === null ? t('epg.noInfo') : emptyText);

  const viewWidth = () => Math.max(200, (rowsEl.clientWidth || 1600) - CHANNEL_WIDTH);

  function drawRuler() {
    while (ruler.firstChild) ruler.removeChild(ruler.firstChild);
    const format = getTimeFormat();
    for (let ms = start; ms < end; ms += HALF_HOUR) {
      const half = (ms / HALF_HOUR) % 2 === 1;
      const mark = h('span', { class: half ? 'epg-tick half' : 'epg-tick', text: formatClockTime(new Date(ms), format, i18n.getLocale()) });
      mark.style.left = `${xOf(ms, start)}px`;
      ruler.appendChild(mark);
    }
  }

  function drawNow() {
    const at = xOf(now(), start) - x;
    nowLine.style.display = at < 0 || at > viewWidth() ? 'none' : '';
    nowLine.style.transform = `translateX(${Math.round(CHANNEL_WIDTH + at)}px)`;
    corner.textContent = formatClockTime(new Date(now()), getTimeFormat(), i18n.getLocale());
  }

  /** The title of a programme that started before the left edge slides right, so it stays readable. */
  function pinTitles(node) {
    node.segNodes.forEach((segNode, i) => {
      const seg = node.segments[i];
      const left = xOf(seg.start, start);
      const shift = left < x ? Math.max(0, Math.min(x - left, xOf(seg.stop, start) - left - 160)) : 0;
      const title = segNode.firstChild;
      if (title) title.style.transform = shift > 0 ? `translateX(${Math.round(shift)}px)` : '';
    });
  }

  function applyScroll() {
    ruler.style.transform = `translateX(${-Math.round(x)}px)`;
    rowNodes.forEach((node) => {
      node.track.style.transform = `translateX(${-Math.round(x)}px)`;
      pinTitles(node);
    });
    drawNow();
  }

  function ensurePage(pageIndex) {
    if (pagesLoading.has(pageIndex)) return pagesLoading.get(pageIndex);
    const job = loadRows(pageIndex * ROW_PAGE, ROW_PAGE)
      .then((result) => {
        (result.entries || []).forEach((entry, i) => {
          entries[pageIndex * ROW_PAGE + i] = entry;
        });
      })
      .catch((err) => {
        pagesLoading.delete(pageIndex);
        log.warn('Guide rows failed', err && err.message);
      });
    pagesLoading.set(pageIndex, job);
    return job;
  }

  /** Reads the programmes of the rows on screen (and the next screen) not read yet, then draws them. */
  async function loadGuide(fromRow, toRow) {
    const ids = [];
    for (let r = fromRow; r < toRow; r += 1) {
      const entry = entries[r];
      if (entry && entry.epgChannelId && !guide.has(entry.epgChannelId)) {
        guide.set(entry.epgChannelId, null);
        ids.push(entry.epgChannelId);
      }
    }
    if (!ids.length) return;
    const found = await programmes(ids, start, end).catch(() => new Map());
    if (destroyed) return;
    ids.forEach((id) => guide.set(id, found.get(id) || []));
    const focusedEntry = entries[focusRow];
    if (focusedEntry && ids.includes(focusedEntry.epgChannelId)) {
      // The focused row was a placeholder: the focus goes to the programme at the time it was on.
      focusAt(focusRow);
      return;
    }
    render();
  }

  function segmentsOf(row) {
    const entry = entries[row];
    if (!entry) return [];
    const list = entry.epgChannelId ? guide.get(entry.epgChannelId) : [];
    if (list === null || list === undefined) return [{ start, stop: end, title: '', loading: true }];
    return rowSegments(list, start, end);
  }

  function buildRow(row) {
    const entry = entries[row];
    const track = h('div', { class: 'epg-track' });
    track.style.width = `${xOf(end, start)}px`;
    const channel = h('div', { class: 'epg-channel' });
    if (entry) {
      const card = createCard(entry, 'live', { square: true });
      channel.appendChild(card.el);
      if (enrich) enrich([entry], [card]);
    } else channel.appendChild(h('div', { class: 'skeleton-block epg-channel-skeleton' }));
    const segments = segmentsOf(row);
    const segNodes = segments.map((seg) => {
      const node = h('div', { class: `epg-prog${seg.empty ? ' empty' : ''}${seg.loading ? ' loading' : ''}${seg.programme && seg.start <= now() && seg.stop > now() ? ' live' : ''}` }, h('span', { class: `epg-prog-title${seg.loading ? ' skeleton-line' : ''}`, text: seg.loading ? '' : seg.title || noInfo() }));
      node.style.left = `${xOf(seg.start, start)}px`;
      node.style.width = `${Math.max(2, xOf(seg.stop, start) - xOf(seg.start, start))}px`;
      track.appendChild(node);
      return node;
    });
    const rowEl = h('div', { class: 'guide-row' }, channel, h('div', { class: 'epg-track-viewport' }, track));
    rowEl.style.transform = `translateY(${(row - first) * ROW_HEIGHT}px)`;
    track.style.transform = `translateX(${-Math.round(x)}px)`;
    const node = { el: rowEl, track, segments, segNodes, entry, loaded: Boolean(entry) && !(segments[0] && segments[0].loading) };
    pinTitles(node);
    return node;
  }

  /** Draws the rows on screen: kept when nothing changed, built again when their data arrived. */
  function render() {
    if (destroyed) return;
    const last = Math.min(total, first + drawn);
    const next = new Map();
    for (let row = first; row < last; row += 1) {
      let node = rowNodes.get(row);
      const ready = Boolean(entries[row]) && !(segmentsOf(row)[0] || {}).loading;
      if (!node || (!node.loaded && (ready || (entries[row] && !node.entry)))) {
        if (node) node.el.remove();
        node = buildRow(row);
        rowsEl.appendChild(node.el);
      } else node.el.style.transform = `translateY(${(row - first) * ROW_HEIGHT}px)`;
      next.set(row, node);
    }
    rowNodes.forEach((node, row) => {
      if (!next.has(row)) node.el.remove();
    });
    rowNodes = next;
    paintFocus();
    status.style.display = total ? 'none' : '';
    // What is missing for the rows on screen and the next screen is read in the background.
    const want = Math.min(total, last + visible);
    let missing = false;
    for (let row = first; row < want; row += 1) {
      if (!entries[row]) {
        missing = true;
        ensurePage(Math.floor(row / ROW_PAGE)).then(() => render());
        row = (Math.floor(row / ROW_PAGE) + 1) * ROW_PAGE - 1;
      }
    }
    if (!missing) loadGuide(first, want);
  }

  function paintFocus() {
    rowNodes.forEach((node, row) => {
      node.el.classList.toggle('current', focused && row === focusRow);
      node.segNodes.forEach((seg, i) => seg.classList.toggle('focused', focused && !rowMode && row === focusRow && i === focusSeg));
    });
    // The selected row: one frame around channel and programmes, the actions on its right.
    const shown = Boolean(rowMode && focused);
    selection.style.display = shown ? '' : 'none';
    actionsEl.style.display = shown ? '' : 'none';
    if (!shown) return;
    const y = `translateY(${(focusRow - first) * ROW_HEIGHT}px)`;
    selection.style.transform = y;
    actionsEl.style.transform = y;
    actionButtons.forEach((b, i) => b.classList.toggle('focused', i === rowMode.button));
  }

  /** Moves the focus to a row, on the programme at `focusTime`, scrolling rows and axis as needed. */
  function focusAt(row, segIndex = null) {
    focusRow = Math.max(0, Math.min(row, total - 1));
    if (focusRow < first) first = focusRow;
    if (focusRow >= first + visible) first = focusRow - visible + 1;
    const segments = segmentsOf(focusRow);
    const picked = segIndex === null && pickSegment ? pickSegment(segments, now()) : -1;
    if (segIndex !== null) focusSeg = Math.max(0, Math.min(segIndex, segments.length - 1));
    else focusSeg = picked >= 0 ? picked : segmentAt(segments, Math.max(focusTime, start));
    const seg = segments[focusSeg];
    if (seg) x = scrollFor(seg, start, x, viewWidth());
    render();
    applyScroll();
  }

  /**
   * The rows fill the screen down to its bottom edge (no fixed height): as many rows as fit, plus the one cut by the edge, which the
   * focus brings fully into view when it gets there.
   */
  /** A new half hour began: the axis starts from it (the half hour gone by leaves), the programmes are read again for the new hours. */
  function shiftAxis() {
    const next = floorHalfHour(now()) - PAST_MS;
    x = Math.max(0, x - xOf(next, start));
    focusTime = Math.max(focusTime, next);
    start = next;
    end = start + SPAN_MS + PAST_MS;
    ruler.style.width = `${xOf(end, start)}px`;
    drawRuler();
    guide.clear();
    rowNodes.forEach((node) => node.el.remove());
    rowNodes = new Map();
    if (total) focusAt(focusRow);
    else render();
  }

  function layout() {
    const top = rowsEl.getBoundingClientRect().top || el.getBoundingClientRect().top + RULER_HEIGHT || 0;
    const height = Math.max(ROW_HEIGHT * 2, (window.innerHeight || 1080) - top);
    visible = Math.max(2, Math.floor(height / ROW_HEIGHT));
    drawn = visible + 1;
    rowsEl.style.height = `${Math.round(height)}px`;
    nowLine.style.height = `${Math.round(height) + RULER_HEIGHT}px`; // from the hours down to the bottom of the screen
  }

  /** Focus model: Up / Down between rows at the same time, Left / Right between programmes; Left from the first one leaves. */
  const model = {
    getCount: () => (total > 0 ? 1 : 0),
    navigate(dir) {
      if (rowMode) {
        if (dir === 'left') rowMode.button = Math.max(0, rowMode.button - 1);
        if (dir === 'right') rowMode.button = Math.min(actionButtons.length - 1, rowMode.button + 1);
        paintFocus();
        return { type: 'move', index: 0 };
      }
      const segments = segmentsOf(focusRow);
      if (dir === 'left') {
        if (focusSeg <= 0 || (segments[focusSeg] && segments[focusSeg].start <= start)) return { type: 'exit', dir };
        focusAt(focusRow, focusSeg - 1);
        focusTime = segmentsOf(focusRow)[focusSeg].start;
        return { type: 'move', index: 0 };
      }
      if (dir === 'right') {
        if (focusSeg >= segments.length - 1) return { type: 'move', index: 0 };
        focusAt(focusRow, focusSeg + 1);
        focusTime = segmentsOf(focusRow)[focusSeg].start;
        return { type: 'move', index: 0 };
      }
      if (dir === 'up') {
        if (focusRow === 0) return { type: 'exit', dir };
        focusAt(focusRow - 1);
        return { type: 'move', index: 0 };
      }
      if (focusRow >= total - 1) return { type: 'move', index: 0 };
      focusAt(focusRow + 1);
      return { type: 'move', index: 0 };
    },
  };

  return {
    el,
    model,
    async start() {
      layout();
      drawRuler();
      status.textContent = t('player.loading');
      total = await countRows().catch(() => 0);
      if (destroyed) return;
      if (!total) status.textContent = t('common.empty');
      await ensurePage(0);
      if (destroyed) return;
      focusAt(0);
      applyScroll();
      clock = setInterval(() => {
        if (floorHalfHour(now()) - PAST_MS !== start) shiftAxis();
        drawNow();
        rowNodes.forEach((node) => node.segNodes.forEach((seg, i) => {
          const s = node.segments[i];
          seg.classList.toggle('live', Boolean(s && s.programme && s.start <= now() && s.stop > now()));
        }));
      }, 30000);
    },
    onFocus() {
      focused = true;
      if (focusSeg < 0) focusAt(focusRow);
      paintFocus();
    },
    onBlur() {
      focused = false;
      paintFocus();
    },
    activate() {
      const entry = entries[focusRow];
      if (!entry) return;
      if (rowMode) {
        if (onRowAction) onRowAction(rowActions[rowMode.button].id, entry, focusRow);
        return;
      }
      const seg = segmentsOf(focusRow)[focusSeg];
      onOpen(entry, focusRow, seg && seg.programme ? seg.programme : null);
    },
    /** OK held: the row is selected and its actions shown. */
    longActivate() {
      if (!rowActions.length || !entries[focusRow]) return;
      rowMode = { button: Math.max(0, Math.min(defaultRowAction, rowActions.length - 1)) };
      paintFocus();
    },
    /** Back while a row is selected: the normal focus again. True when there was a selection. */
    cancelRowMode() {
      if (!rowMode) return false;
      rowMode = null;
      paintFocus();
      return true;
    },
    inRowMode: () => Boolean(rowMode),
    /** The rows changed (order, removed ones): read again, focus on `row`; the selection stays when `keepRowMode`. */
    async reload({ row = focusRow, keepRowMode = false } = {}) {
      if (!keepRowMode) rowMode = null;
      entries.length = 0;
      pagesLoading.clear();
      rowNodes.forEach((node) => node.el.remove());
      rowNodes = new Map();
      total = await countRows().catch(() => 0);
      if (destroyed) return;
      status.textContent = total ? '' : t('common.empty');
      if (!total) {
        rowMode = null;
        render();
        return;
      }
      await ensurePage(Math.floor(Math.min(row, total - 1) / ROW_PAGE));
      if (destroyed) return;
      focusAt(Math.min(row, total - 1));
    },
    /** Where the focus is (row) and the scroll, to come back to the same place. */
    state: () => ({ row: focusRow, time: focusTime }),
    restore(state) {
      if (!state) return;
      focusTime = state.time || focusTime;
      focusAt(state.row || 0);
    },
    get count() {
      return total;
    },
    /** The guide was downloaded again: the programmes of the rows are read again (the rows and the focus stay). */
    reloadProgrammes() {
      guide.clear();
      rowNodes.forEach((node) => node.el.remove());
      rowNodes = new Map();
      render();
    },
    destroy() {
      destroyed = true;
      if (clock) clearInterval(clock);
    },
  };
}
