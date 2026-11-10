import { Action } from './actions.js';
import { platform } from '../platform/index.js';

export { Action };

/**
 * Keys every platform shares (arrows, OK, the standard media keys) plus desktop keys for browser debugging (Esc / Backspace = Back,
 * PageUp / PageDown = channel). The platform adds its own remote keys (`keyCodes`, e.g. 10009 = Back on Samsung).
 */
export const COMMON_KEY_MAP = Object.freeze({
  37: Action.LEFT,
  38: Action.UP,
  39: Action.RIGHT,
  40: Action.DOWN,
  13: Action.ENTER,
  27: Action.BACK,
  8: Action.BACK,
  415: Action.PLAY,
  19: Action.PAUSE,
  413: Action.STOP,
  417: Action.FAST_FORWARD,
  412: Action.REWIND,
  33: Action.CHANNEL_UP,
  34: Action.CHANNEL_DOWN,
});

export const KEY_MAP = Object.freeze({ ...COMMON_KEY_MAP, ...(platform.keyCodes || {}) });

/** OK held this long is a long press (row actions in the programme guide). */
export const LONG_PRESS_MS = 600;

const THROTTLED = new Set([Action.UP, Action.DOWN, Action.LEFT, Action.RIGHT]);

/** A move waits for the frame of the previous one at most this long (a page that is not drawn, e.g. hidden, never blocks the keys). */
const FRAME_WAIT_MS = 250;

const animationFrame = typeof requestAnimationFrame === 'function' ? (callback) => requestAnimationFrame(callback) : null;

export function actionFromKeyCode(code) {
  return KEY_MAP[code] || null;
}

export function isTextEditing(doc) {
  const el = doc.activeElement;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || Boolean(el.isContentEditable);
}

/** Single place that reads the keyboard/remote: the rest of the app only sees abstract actions. */
export class InputService {
  constructor(target = document, { minRepeatMs = 80, now = () => Date.now(), longPressMs = LONG_PRESS_MS, holdsEnter = () => false, nextFrame = animationFrame } = {}) {
    this.target = target;
    this.longPressMs = longPressMs;
    /** True when the focused element has a long-press action: then OK is told apart (short on release, long after `longPressMs`). */
    this.holdsEnter = holdsEnter;
    this.enterTimer = null;
    this.enterLong = false;
    this.onKeyUp = this.onKeyUp.bind(this);
    this.doc = target.nodeType === 9 ? target : target.ownerDocument;
    this.minRepeatMs = minRepeatMs;
    /**
     * A held arrow repeats faster than a slow TV draws: a move that arrives before the previous one was drawn is dropped, so the focus never
     * runs on after the key is released (`nextFrame`: requestAnimationFrame; null: no wait).
     */
    this.nextFrame = nextFrame;
    this.frameWaitSince = 0;
    this.now = now;
    this.handlers = new Set();
    this.lastAt = {};
    this.onKeyDown = this.onKeyDown.bind(this);
  }

  start() {
    this.target.addEventListener('keydown', this.onKeyDown);
    this.target.addEventListener('keyup', this.onKeyUp);
  }

  stop() {
    this.target.removeEventListener('keydown', this.onKeyDown);
    this.target.removeEventListener('keyup', this.onKeyUp);
  }

  emit(action, event) {
    Array.from(this.handlers).forEach((handler) => handler(action, event));
  }

  /** OK released: a short press when the long one did not fire. */
  onKeyUp(event) {
    if (actionFromKeyCode(event.keyCode) !== Action.ENTER || (!this.enterTimer && !this.enterLong)) return;
    const short = Boolean(this.enterTimer);
    clearTimeout(this.enterTimer);
    this.enterTimer = null;
    this.enterLong = false;
    if (short) this.emit(Action.ENTER, event);
  }

  onAction(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Asks the platform to deliver the media / channel keys (on Tizen they are not forwarded by default). */
  registerPlatformKeys() {
    platform.registerKeys();
  }

  onKeyDown(event) {
    const action = actionFromKeyCode(event.keyCode);
    if (!action) return;
    // While the on-screen keyboard is open the field owns every key.
    if (isTextEditing(this.doc)) return;
    event.preventDefault();
    if (action === Action.ENTER && (this.enterTimer || this.enterLong)) return; // OK still held (the remote repeats it)
    if (action === Action.ENTER && this.holdsEnter()) {
      this.enterTimer = setTimeout(() => {
        this.enterTimer = null;
        this.enterLong = true;
        this.emit(Action.LONG_ENTER, event);
      }, this.longPressMs);
      return;
    }
    if (THROTTLED.has(action)) {
      const t = this.now();
      if (this.frameWaitSince && t - this.frameWaitSince < FRAME_WAIT_MS) return;
      if (t - (this.lastAt[action] || 0) < this.minRepeatMs) return;
      this.lastAt[action] = t;
      if (this.nextFrame) {
        this.frameWaitSince = t;
        this.nextFrame(() => {
          this.frameWaitSince = 0;
        });
      }
    }
    this.emit(action, event);
  }
}
