/* Samsung remote: the keys only Tizen sends (the common ones, arrows / OK / media keys, are in src/core/input.js). */
import { Action } from '../../src/core/actions.js';

export const TIZEN_KEY_CODES = Object.freeze({
  10009: Action.BACK,
  10252: Action.PLAY_PAUSE,
  427: Action.CHANNEL_UP,
  428: Action.CHANNEL_DOWN,
});

/** Media and channel keys are not forwarded by default: Tizen is asked for them. */
const EXTRA_KEYS = ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'MediaFastForward', 'MediaRewind', 'ChannelUp', 'ChannelDown'];

export function registerTizenKeys(env = typeof window !== 'undefined' ? window : {}) {
  try {
    const device = env.tizen && env.tizen.tvinputdevice;
    if (device) EXTRA_KEYS.forEach((name) => device.registerKey(name));
  } catch {
    /* keys stay unregistered; navigation keys still work */
  }
}
