/* Desktop app (Windows, macOS, Linux; Electron, recent Chromium): the platform adapter (see src/platform/contract.js). The page's <video>
 * plays the streams, with hls.js / mpegts.js for HLS and MPEG-TS; the keyboard is the remote; trailers open in the system browser. The
 * window, the app:// pages and the network without CORS are in electron/main.js. */
import { createHtml5Engine } from '../../src/services/playerEngines.js';
import { youtubeUrl } from '../../src/services/trailer.js';
import { Action } from '../../src/core/actions.js';

/** Keyboard media keys and Space, besides the common keys (arrows, Enter, Esc / Backspace = Back, PageUp / PageDown = channel). */
export const DESKTOP_KEY_CODES = Object.freeze({
  32: Action.PLAY_PAUSE, // Space (a text field keeps it: the input service ignores keys while one is being edited)
  179: Action.PLAY_PAUSE, // MediaPlayPause
  178: Action.STOP, // MediaStop
  176: Action.CHANNEL_UP, // MediaTrackNext
  177: Action.CHANNEL_DOWN, // MediaTrackPrevious
});

/** "Electron/44.9.3" in the user agent: the version of the desktop shell, or null in a plain browser. */
export function electronVersion(userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const match = /Electron\/([\d.]+)/.exec(String(userAgent));
  return match ? match[1] : null;
}

export default {
  id: 'desktop',
  name: 'Desktop',
  keyCodes: DESKTOP_KEY_CODES,
  exit() {
    try {
      window.close(); // the only window: the app quits
    } catch {
      /* nothing else to do */
    }
  },
  createEngine: () => createHtml5Engine({ demux: true }),
  // Full screen of the window, through the preload of electron/main.js (in a plain browser: the page's own full screen).
  toggleFullscreen() {
    const bridge = typeof window !== 'undefined' ? window.xtreamDesktop : null;
    if (bridge) return bridge.toggleFullscreen();
    if (document.fullscreenElement) return Promise.resolve(document.exitFullscreen()).then(() => false);
    if (!document.documentElement.requestFullscreen) return Promise.resolve(false);
    return Promise.resolve(document.documentElement.requestFullscreen()).then(() => true, () => false);
  },
  isFullscreen() {
    const bridge = typeof window !== 'undefined' ? window.xtreamDesktop : null;
    return bridge ? bridge.isFullscreen() : Promise.resolve(Boolean(document.fullscreenElement));
  },
  createTrailerEngine: null,
  // The main process sends every window.open to the system browser.
  openTrailer(videoId) {
    window.open(youtubeUrl(videoId), '_blank');
    return true;
  },
  runtimeChecks() {
    const version = electronVersion();
    return [{ id: 'electron', status: version ? 'ok' : 'warn', detail: version ? `Electron ${version}` : 'not running inside the desktop app' }];
  },
};
