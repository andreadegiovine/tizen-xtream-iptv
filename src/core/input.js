export const Action = Object.freeze({
  UP: 'up',
  DOWN: 'down',
  LEFT: 'left',
  RIGHT: 'right',
  ENTER: 'enter',
  LONG_ENTER: 'longEnter', // OK held down (only where the focused element has a long-press action)
  BACK: 'back',
  PLAY: 'play',
  PAUSE: 'pause',
  PLAY_PAUSE: 'playPause',
  STOP: 'stop',
  FAST_FORWARD: 'fastForward',
  REWIND: 'rewind',
  CHANNEL_UP: 'channelUp',
  CHANNEL_DOWN: 'channelDown',
});

/** Samsung remote key codes, plus desktop keys (Esc/Backspace/PageUp/PageDown) for browser debugging. */
export const KEY_MAP = Object.freeze({
  37: Action.LEFT,
  38: Action.UP,
  39: Action.RIGHT,
  40: Action.DOWN,
  13: Action.ENTER,
  10009: Action.BACK,
  27: Action.BACK,
  8: Action.BACK,
  415: Action.PLAY,
  19: Action.PAUSE,
  10252: Action.PLAY_PAUSE,
  413: Action.STOP,
  417: Action.FAST_FORWARD,
  412: Action.REWIND,
  427: Action.CHANNEL_UP,
  428: Action.CHANNEL_DOWN,
  33: Action.CHANNEL_UP,
  34: Action.CHANNEL_DOWN,
});

/** OK held this long is a long press (row actions in the programme guide). */
export const LONG_PRESS_MS = 600;

const THROTTLED = new Set([Action.UP, Action.DOWN, Action.LEFT, Action.RIGHT]);
const TIZEN_EXTRA_KEYS = [
  'MediaPlay',
  'MediaPause',
  'MediaPlayPause',
  'MediaStop',
  'MediaFastForward',
  'MediaRewind',
  'ChannelUp',
  'ChannelDown',
];

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
  constructor(target = document, { minRepeatMs = 80, now = () => Date.now(), longPressMs = LONG_PRESS_MS, holdsEnter = () => false } = {}) {
    this.target = target;
    this.longPressMs = longPressMs;
    /** True when the focused element has a long-press action: then OK is told apart (short on release, long after `longPressMs`). */
    this.holdsEnter = holdsEnter;
    this.enterTimer = null;
    this.enterLong = false;
    this.onKeyUp = this.onKeyUp.bind(this);
    this.doc = target.nodeType === 9 ? target : target.ownerDocument;
    this.minRepeatMs = minRepeatMs;
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

  /** Asks Tizen to deliver media/channel keys, which are not forwarded by default. */
  registerTizenKeys() {
    try {
      const device = window.tizen && window.tizen.tvinputdevice;
      if (device) TIZEN_EXTRA_KEYS.forEach((name) => device.registerKey(name));
    } catch {
      /* keys stay unregistered; navigation keys still work */
    }
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
      if (t - (this.lastAt[action] || 0) < this.minRepeatMs) return;
      this.lastAt[action] = t;
    }
    this.emit(action, event);
  }
}
