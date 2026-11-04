import { h } from '../dom.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';

export const NOTICE_ZONE = 'notices';
export const NoticeType = Object.freeze({ INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' });
const DEFAULT_MS = { info: 4000, success: 3500, warning: 6000, error: 8000 };
const PLAYBACK_ALLOWED = 'playback'; // `scope` of the notices that may appear while a video plays

/**
 * Standard notices (errors, warnings, confirmations, information), stacked at the right edge of the
 * screen, centred vertically. A notice takes the focus when it appears (unless a dialog is open or
 * a video is playing) and OK closes it; the Back key closes the newest one. `permanent` notices stay
 * until closed. During playback only notices with `scope: 'playback'` (playback errors, audio and
 * subtitle changes) are shown; every other one is dropped.
 */
export function createNoticeService({ focus, root = document.body, isDialogOpen = () => false }) {
  const container = h('div', { class: 'notices', role: 'status', 'aria-live': 'polite' });
  root.appendChild(container);
  let list = []; // [{ id, key, el, timer, captured }]
  let seq = 0;
  let playing = false;
  let previous = null; // focus to give back when the last focusable notice closes
  let registered = false;

  const focusable = () => list.filter((n) => n.captures);

  function release() {
    if (!registered || focusable().length) return;
    registered = false;
    focus.unregister(NOTICE_ZONE);
    if (previous && previous.id && focus.zones.has(previous.id)) focus.focus(previous.id, previous.index);
    previous = null;
  }

  function ensureZone() {
    if (registered) return;
    previous = { id: focus.activeId, index: focus.active ? focus.active.index : 0 };
    registered = true;
    focus.register(
      new FocusZone({
        id: NOTICE_ZONE,
        model: new ListModel({ orientation: 'vertical', getCount: () => focusable().length }),
        onFocus: (i) => focusable()[i] && focusable()[i].el.classList.add('focused'),
        onBlur: (i) => focusable()[i] && focusable()[i].el.classList.remove('focused'),
        onActivate: (i) => focusable()[i] && close(focusable()[i].id),
      }),
    );
    focus.focus(NOTICE_ZONE, 0);
  }

  function close(id) {
    const at = list.findIndex((n) => n.id === id);
    if (at < 0) return;
    const [gone] = list.splice(at, 1);
    clearTimeout(gone.timer);
    gone.el.remove();
    if (registered) {
      const count = focusable().length;
      if (focus.activeId === NOTICE_ZONE && focus.active) focus.active.index = Math.min(focus.active.index, Math.max(0, count - 1));
      if (count && focus.activeId === NOTICE_ZONE) focus.focus(NOTICE_ZONE, focus.active.index);
    }
    release();
  }

  /**
   * options: { type, message, title?, permanent?, ms?, key?, scope? }. `key` replaces a notice that is already shown
   * with the same key. Returns the notice id, or null when it was not shown.
   */
  function show({ type = NoticeType.INFO, message, title = '', permanent = false, ms = 0, key = '', scope = '' }) {
    if (!message) return null;
    if (playing && scope !== PLAYBACK_ALLOWED) return null;
    if (key) {
      const same = list.find((n) => n.key === key);
      if (same) close(same.id);
    }
    seq += 1;
    const id = seq;
    const body = h('div', { class: 'notice-body' }, title ? h('div', { class: 'notice-title', text: title }) : null, h('div', { class: 'notice-text', text: message }));
    const el = h('div', { class: `notice ${type}${permanent ? ' permanent' : ''}`, role: type === 'error' ? 'alert' : 'status' }, h('span', { class: 'notice-icon' }, icon(type)), body);
    el.addEventListener('click', () => close(id));
    const entry = { id, key, el, timer: null, captures: false };
    list.push(entry);
    container.appendChild(el);
    if (!permanent) entry.timer = setTimeout(() => close(id), ms || DEFAULT_MS[type] || DEFAULT_MS.info);
    if (!playing && !isDialogOpen()) {
      entry.captures = true;
      ensureZone();
      if (focus.activeId !== NOTICE_ZONE) focus.focus(NOTICE_ZONE, 0);
      else focus.focus(NOTICE_ZONE, focus.active.index);
    }
    return id;
  }

  const api = {
    show,
    info: (message, options = {}) => show({ ...options, type: NoticeType.INFO, message }),
    success: (message, options = {}) => show({ ...options, type: NoticeType.SUCCESS, message }),
    warning: (message, options = {}) => show({ ...options, type: NoticeType.WARNING, message }),
    error: (message, options = {}) => show({ ...options, type: NoticeType.ERROR, message }),
    close,
    isOpen: () => list.length > 0,
    hasFocus: () => registered && focus.activeId === NOTICE_ZONE,
    /** Back key: closes the newest notice. */
    dismissTop() {
      const last = list[list.length - 1];
      if (last) close(last.id);
    },
    /** While a video plays, notices do not take the focus and only the playback ones appear. */
    setPlayback(value) {
      playing = Boolean(value);
      container.classList.toggle('over-video', playing);
      if (playing) {
        list.filter((n) => n.captures).forEach((n) => {
          n.captures = false;
        });
        release();
      }
    },
  };
  return api;
}
