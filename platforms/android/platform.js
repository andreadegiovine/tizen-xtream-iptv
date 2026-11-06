/* Android TV / Fire TV app (Capacitor, platforms/android/android): the platform adapter (see src/platform/contract.js). Video with
 * ExoPlayer behind the page, the remote's Back / media / channel keys from the activity, trailers in the YouTube app, the device's facts
 * from the TvHost plugin. In a desktop browser (development) it falls back to the <video> engine. */
import { createHtml5Engine } from '../../src/services/playerEngines.js';
import { youtubeUrl } from '../../src/services/trailer.js';
import { Action } from '../../src/core/actions.js';
import { log } from '../../src/core/logger.js';
import { createExoEngine } from './exoEngine.js';

/** Keys sent by MainActivity (RemoteKeys.java): 10000 + the Android key code. D-pad and OK arrive as arrows and Enter. */
export const ANDROID_KEY_OFFSET = 10000;
const code = (androidKey) => ANDROID_KEY_OFFSET + androidKey;
export const ANDROID_KEY_CODES = Object.freeze({
  [code(4)]: Action.BACK, // KEYCODE_BACK
  [code(85)]: Action.PLAY_PAUSE, // MEDIA_PLAY_PAUSE
  [code(126)]: Action.PLAY, // MEDIA_PLAY
  [code(127)]: Action.PAUSE, // MEDIA_PAUSE
  [code(86)]: Action.STOP, // MEDIA_STOP
  [code(90)]: Action.FAST_FORWARD, // MEDIA_FAST_FORWARD
  [code(89)]: Action.REWIND, // MEDIA_REWIND
  [code(87)]: Action.CHANNEL_UP, // MEDIA_NEXT
  [code(88)]: Action.CHANNEL_DOWN, // MEDIA_PREVIOUS
  [code(166)]: Action.CHANNEL_UP, // CHANNEL_UP
  [code(167)]: Action.CHANNEL_DOWN, // CHANNEL_DOWN
});

const capacitor = () => (typeof window !== 'undefined' && window.Capacitor && typeof window.Capacitor.nativePromise === 'function' ? window.Capacitor : null);
const host = (method, options = {}) => {
  const cap = capacitor();
  return cap ? cap.nativePromise('TvHost', method, options) : Promise.reject(new Error('not inside the Android app'));
};

/** The key the activity sends, as a keydown the input service reads like any other (event.keyCode). */
export function dispatchRemoteKey(keyCode, target = typeof document !== 'undefined' ? document : null) {
  if (!target) return;
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'keyCode', { get: () => keyCode });
  target.dispatchEvent(event);
}

let info = null; // the device's facts, read once (TvHost.info)
const readInfo = () => info || (info = host('info').catch(() => null));

export default {
  id: 'android',
  name: 'Android TV / Fire TV',
  keyCodes: ANDROID_KEY_CODES,
  registerKeys() {
    if (typeof window !== 'undefined') window.__xtreamKey = (keyCode) => dispatchRemoteKey(keyCode);
  },
  exit() {
    host('exit').catch(() => {
      try {
        window.close();
      } catch {
        /* nothing else to do */
      }
    });
  },
  // ExoPlayer in the app; the <video> engine in a browser (development).
  createEngine() {
    const exo = createExoEngine();
    return exo.available() ? exo : createHtml5Engine();
  },
  createTrailerEngine: null,
  openTrailer(videoId) {
    host('openUrl', { url: youtubeUrl(videoId) }).catch((err) => log.warn('Trailer link failed', err && err.message));
    return true;
  },
  runtimeChecks() {
    const inApp = Boolean(capacitor());
    return [{ id: 'android', status: inApp ? 'ok' : 'warn', detail: inApp ? 'Android app (Capacitor)' : 'not running inside the Android app' }];
  },
  display: () => readInfo().then((facts) => (facts && facts.width ? { width: facts.width, height: facts.height } : null)),
};
