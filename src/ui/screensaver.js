import { h } from './dom.js';
import { MARK } from './components/logo.js';

export const IDLE_MS = 15 * 60 * 1000;
export const MOVE_MS = 10 * 1000;
const EVENTS = ['keydown', 'mousedown', 'mousemove', 'wheel', 'touchstart'];
const MIN_SIZE = 120;
const MAX_SIZE = 360;

/** A random size and place for the logo inside a screen of `width` × `height`. */
export function randomSpot(width, height, random = Math.random) {
  const size = Math.round(MIN_SIZE + random() * (MAX_SIZE - MIN_SIZE));
  return { size, left: Math.round(random() * Math.max(0, width - size)), top: Math.round(random() * Math.max(0, height - size)) };
}

/**
 * Screensaver: after `idleMs` without a key or pointer event a black screen with the logo takes over; the logo
 * changes place and size every `moveMs`. The first key or pointer event ends it and is not passed on to the UI.
 * It never starts while suspended (a video is playing) or when disabled.
 */
export function createScreensaver({ doc = document, win = window, idleMs = IDLE_MS, moveMs = MOVE_MS, random = Math.random, enabled = true } = {}) {
  const mark = h('span', { class: 'screensaver-mark' });
  mark.innerHTML = MARK;
  const el = h('div', { class: 'screensaver', 'aria-hidden': 'true' }, mark);
  let on = enabled;
  let suspended = false;
  let active = false;
  let idleTimer = null;
  let moveTimer = null;
  let lastReset = 0;

  function place() {
    const spot = randomSpot(win.innerWidth || 1920, win.innerHeight || 1080, random);
    mark.style.width = `${spot.size}px`;
    mark.style.height = `${spot.size}px`;
    mark.style.left = `${spot.left}px`;
    mark.style.top = `${spot.top}px`;
  }

  function show() {
    if (active || !on || suspended) return;
    active = true;
    doc.body.appendChild(el);
    place();
    moveTimer = setInterval(place, moveMs);
  }

  function hide() {
    if (!active) return;
    active = false;
    clearInterval(moveTimer);
    el.remove();
  }

  function arm() {
    clearTimeout(idleTimer);
    idleTimer = null;
    lastReset = Date.now();
    if (on && !suspended) idleTimer = setTimeout(show, idleMs);
  }

  function onEvent(event) {
    if (active) {
      event.preventDefault();
      event.stopPropagation(); // the key that wakes the screen does nothing else
      hide();
      arm();
      return;
    }
    if (event.type === 'mousemove' && Date.now() - lastReset < 1000) return; // a moving pointer fires many events
    arm();
  }

  EVENTS.forEach((name) => doc.addEventListener(name, onEvent, true));
  arm();

  return {
    el,
    isActive: () => active,
    setEnabled(value) {
      on = Boolean(value);
      if (!on) hide();
      arm();
    },
    /** True while a video plays: no screensaver then. */
    setSuspended(value) {
      suspended = Boolean(value);
      if (suspended) hide();
      arm();
    },
    destroy() {
      EVENTS.forEach((name) => doc.removeEventListener(name, onEvent, true));
      clearTimeout(idleTimer);
      hide();
    },
  };
}
