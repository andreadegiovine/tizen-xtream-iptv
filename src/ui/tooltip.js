/**
 * Tooltips: the name of a button that shows only an icon (and the full title and times of a guide programme), shown after TIP_DELAY of
 * focus on it (or of the pointer resting on it). An element gets one with `setTip(el, text, dir)` (`data-tip`; `data-tip-dir` 'down',
 * otherwise above). A single floating box (body > .tooltip) shows it, so the containers that cut their content (overflow) never hide it,
 * and it stays on screen (moved in from the edges, flipped when there is no room on its side).
 *
 * Checked after every key, pointer move and click, and every POLL_MS: the box goes as soon as the element loses the focus, leaves the page
 * or is hidden (the player controls fading out); its text follows the element (play / pause).
 */
export const TIP_DELAY = 2000;
const POLL_MS = 250;
const GAP = 12; // between the element and the box
const EDGE = 16; // the box never closer than this to the screen edges

/** Gives `el` a tooltip (`text` empty: none). `dir`: 'up' (default) or 'down'. Returns `el`. */
export function setTip(el, text, dir = 'up') {
  if (!el) return el;
  if (text) el.setAttribute('data-tip', text);
  else el.removeAttribute('data-tip');
  if (dir === 'down') el.setAttribute('data-tip-dir', 'down');
  else el.removeAttribute('data-tip-dir');
  return el;
}

/** Shown, and not faded out by an ancestor (the player controls): opacity under one half counts as hidden. */
export function isShown(el) {
  if (!el || !el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  if (r.bottom < 0 || r.right < 0 || r.top > window.innerHeight || r.left > window.innerWidth) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const style = window.getComputedStyle(n);
    if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) < 0.5)) return false;
  }
  return true;
}

/** Where the box goes: above (or below) the element, centred on it, kept inside the screen. */
export function placeTip(rect, box, dir, view) {
  let down = dir === 'down';
  if (!down && rect.top - GAP - box.height < EDGE) down = true;
  else if (down && rect.bottom + GAP + box.height > view.height - EDGE && rect.top - GAP - box.height >= EDGE) down = false;
  const top = down ? rect.bottom + GAP : rect.top - GAP - box.height;
  const centred = rect.left + rect.width / 2 - box.width / 2;
  const left = Math.max(EDGE, Math.min(centred, view.width - EDGE - box.width));
  return { top: Math.round(top), left: Math.round(left), down };
}

let state = null;

function pick() {
  // With the pointer, the element under it (the focus stays where the pointer last left it); with the keys, the focused one.
  if (document.body.classList.contains('pointer-mode')) return state.hovered && isShown(state.hovered) ? state.hovered : null;
  const list = document.querySelectorAll('.focused[data-tip]');
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isShown(list[i])) return list[i];
  }
  return null;
}

function hide() {
  if (!state.shown) return;
  state.shown = false;
  state.box.classList.remove('shown');
}

function show(el) {
  const { box } = state;
  const text = el.getAttribute('data-tip');
  if (box.textContent !== text) box.textContent = text;
  const pos = placeTip(el.getBoundingClientRect(), { width: box.offsetWidth, height: box.offsetHeight }, el.getAttribute('data-tip-dir'), { width: window.innerWidth, height: window.innerHeight });
  box.style.top = `${pos.top}px`;
  box.style.left = `${pos.left}px`;
  box.classList.toggle('down', pos.down);
  if (!state.shown) {
    state.shown = true;
    box.classList.add('shown');
  }
}

function tick() {
  if (!state) return;
  const el = pick();
  if (el !== state.el) {
    state.el = el;
    state.since = Date.now();
    hide();
    clearTimeout(state.timer);
    if (el) state.timer = setTimeout(tick, TIP_DELAY);
    return;
  }
  if (!el || !el.getAttribute('data-tip') || !isShown(el)) {
    hide();
    return;
  }
  if (Date.now() - state.since >= TIP_DELAY - 20) show(el);
}

/** Looks again at once (the focus may have moved without a key: a page that took it). */
export function refreshTips() {
  if (state) setTimeout(tick, 0);
}

/** Starts the tooltips (once, at boot). Returns a function that stops them. */
export function startTooltips() {
  if (state) return () => {};
  const box = document.createElement('div');
  box.className = 'tooltip';
  box.setAttribute('aria-hidden', 'true');
  document.body.appendChild(box);
  state = { box, el: null, since: 0, shown: false, hovered: null, timer: null };
  const soon = () => setTimeout(tick, 0);
  const over = (event) => {
    const target = event.target && event.target.closest ? event.target.closest('[data-tip]') : null;
    if (target !== state.hovered) {
      state.hovered = target;
      soon();
    }
  };
  document.addEventListener('keydown', soon, true);
  document.addEventListener('keyup', soon, true);
  document.addEventListener('click', soon, true);
  document.addEventListener('mouseover', over, true);
  const poll = setInterval(tick, POLL_MS);
  return () => {
    document.removeEventListener('keydown', soon, true);
    document.removeEventListener('keyup', soon, true);
    document.removeEventListener('click', soon, true);
    document.removeEventListener('mouseover', over, true);
    clearInterval(poll);
    clearTimeout(state.timer);
    box.remove();
    state = null;
  };
}
