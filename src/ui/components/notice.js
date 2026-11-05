import { h } from '../dom.js';
import { icon } from '../icons.js';

export const NoticeType = Object.freeze({ INFO: 'info', SUCCESS: 'success', WARNING: 'warning', ERROR: 'error' });
const DEFAULT_MS = { info: 4000, success: 3500, warning: 6000, error: 8000 };
const PLAYBACK_ALLOWED = 'playback'; // `scope` of the notices that may appear while a video plays

/**
 * Standard notices (errors, warnings, confirmations, information), stacked at the right edge of the
 * screen, centred vertically. They never take the focus: timed ones close by themselves, `permanent`
 * ones stay until clicked. During playback only notices with `scope: 'playback'` (playback errors,
 * audio and subtitle changes) are shown; every other one is dropped.
 */
export function createNoticeService({ root = document.body } = {}) {
  const container = h('div', { class: 'notices', role: 'status', 'aria-live': 'polite' });
  root.appendChild(container);
  let list = []; // [{ id, key, el, timer }]
  let seq = 0;
  let playing = false;

  function close(id) {
    const at = list.findIndex((n) => n.id === id);
    if (at < 0) return;
    const [gone] = list.splice(at, 1);
    clearTimeout(gone.timer);
    gone.el.remove();
  }

  /**
   * options: { type, message, title?, permanent?, sticky?, ms?, key?, scope? } (`sticky`: a permanent one that a click cannot close). `key` replaces a notice that is already shown
   * with the same key. Returns the notice id, or null when it was not shown.
   */
  function show({ type = NoticeType.INFO, message, title = '', permanent = false, sticky = false, ms = 0, key = '', scope = '' }) {
    if (!message) return null;
    if (playing && scope !== PLAYBACK_ALLOWED) return null;
    if (key) {
      const same = list.find((n) => n.key === key);
      if (same) close(same.id);
    }
    seq += 1;
    const id = seq;
    const body = h('div', { class: 'notice-body' }, title ? h('div', { class: 'notice-title', text: title }) : null, h('div', { class: 'notice-text', text: message }));
    const el = h('div', { class: `notice ${type}${permanent || sticky ? ' permanent' : ''}`, role: type === 'error' ? 'alert' : 'status' }, h('span', { class: 'notice-icon' }, icon(type)), body);
    if (!sticky) el.addEventListener('click', () => close(id));
    const entry = { id, key, el, timer: null, text: body.lastChild };
    list.push(entry);
    container.appendChild(el);
    if (!permanent && !sticky) entry.timer = setTimeout(() => close(id), ms || DEFAULT_MS[type] || DEFAULT_MS.info);
    return id;
  }

  return {
    show,
    info: (message, options = {}) => show({ ...options, type: NoticeType.INFO, message }),
    success: (message, options = {}) => show({ ...options, type: NoticeType.SUCCESS, message }),
    warning: (message, options = {}) => show({ ...options, type: NoticeType.WARNING, message }),
    error: (message, options = {}) => show({ ...options, type: NoticeType.ERROR, message }),
    close,
    /** Changes the text of a notice that is shown (a countdown); false when it is gone. */
    update(id, message) {
      const entry = list.find((n) => n.id === id);
      if (!entry) return false;
      entry.text.textContent = message;
      return true;
    },
    isOpen: () => list.length > 0,
    /** While a video plays only the playback notices appear. */
    setPlayback(value) {
      playing = Boolean(value);
      container.classList.toggle('over-video', playing);
    },
  };
}
