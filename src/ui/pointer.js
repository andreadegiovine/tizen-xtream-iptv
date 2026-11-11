import { withoutScroll } from './scroll.js';

/**
 * Mouse, touch and the webOS Magic Remote next to the remote's keys: both work at any time, on the same focus.
 * - the element under a moving pointer becomes the focus (the page does not scroll under it);
 * - a click / tap is OK on it, a right click / long touch the long press of OK (row actions of the guide);
 * - a click on the dark backdrop of a dialog, or the "back" button of a mouse, is Back;
 * - `pointer-mode` on <body> while the pointer is in use (pointer cursor, rows that scroll with the wheel or a finger); a key turns it off.
 * `focus`: the FocusManager; `onBack()`: what Back does; `isTextEditing()`: a text field has the keyboard (the pointer leaves it alone).
 */
export function createPointer({ doc = document, win = window, focus, onBack, isTextEditing = () => false }) {
  const body = doc.body;
  let active = false;
  let lastX = null;
  let lastY = null;
  let pending = null; // the element of the last move, handled at the next frame
  let frame = null;
  const listeners = [];
  const on = (target, name, fn, options) => {
    target.addEventListener(name, fn, options);
    listeners.push(() => target.removeEventListener(name, fn, options));
  };

  function setActive(next) {
    if (active === next) return;
    active = next;
    body.classList.toggle('pointer-mode', next);
  }

  /** The element under the pointer becomes the focus, if it is one of a zone's and not the focus already. */
  function pointAt(target) {
    if (isTextEditing()) return;
    if (target && target.closest && target.closest('.dragging')) return; // a row being dragged: the focus stays where it was
    const found = withoutScroll(() => focus.locate(target)); // (a zone that finds the element itself may move its own focus)
    if (!found) return;
    if (focus.activeId === found.id && focus.active && focus.active.index === found.index) return;
    withoutScroll(() => focus.focus(found.id, found.index));
  }

  const flush = () => {
    frame = null;
    const target = pending;
    pending = null;
    if (target) pointAt(target);
  };

  on(doc, 'mousemove', (event) => {
    // Chromium sends a mousemove where the pointer already is after the page scrolled (a key moved it): only a real move counts.
    if (event.screenX === lastX && event.screenY === lastY) return;
    lastX = event.screenX;
    lastY = event.screenY;
    setActive(true);
    pending = event.target;
    if (frame === null) frame = (win.requestAnimationFrame || ((fn) => setTimeout(fn, 16)))(flush);
  });
  on(doc, 'pointerdown', (event) => {
    if (event.pointerType === 'touch' || event.pointerType === 'pen' || event.pointerType === 'mouse') setActive(true);
  });
  on(doc, 'wheel', () => setActive(true), { passive: true });
  on(doc, 'keydown', (event) => {
    if (!event.fromPointer) setActive(false);
  }, true);

  on(doc, 'click', (event) => {
    setActive(true);
    if (event.defaultPrevented || event.button !== 0) return;
    const target = event.target;
    // A click on the backdrop of a dialog (outside the box): Back closes it.
    if (target && target.classList && target.classList.contains('dialog-backdrop')) {
      onBack();
      return;
    }
    if (isTextEditing() && target && target.tagName === 'INPUT') return; // the field being typed in keeps its keyboard
    const found = withoutScroll(() => focus.locate(target));
    if (!found) return;
    withoutScroll(() => focus.activate(found.id, found.index));
  });

  // Right click, or a long touch: the long press of OK where the element has one; never the browser menu.
  on(doc, 'contextmenu', (event) => {
    event.preventDefault();
    const found = withoutScroll(() => focus.locate(event.target));
    if (found) withoutScroll(() => focus.activate(found.id, found.index, { long: true }));
  });

  // The "back" button of a mouse (button 3).
  on(doc, 'mouseup', (event) => {
    if (event.button !== 3) return;
    event.preventDefault();
    onBack();
  });

  // webOS Magic Remote: the cursor shows when the remote is moved and hides when a key is pressed.
  on(doc, 'cursorStateChange', (event) => {
    const visible = event && event.detail && event.detail.visibility;
    if (visible !== undefined) setActive(Boolean(visible));
  });

  return {
    isActive: () => active,
    destroy() {
      listeners.forEach((off) => off());
      setActive(false);
    },
  };
}
