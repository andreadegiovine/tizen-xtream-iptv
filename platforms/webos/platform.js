/* LG webOS (TV, webOS 6+ / Chromium 79+): the platform adapter (see src/platform/contract.js). The video plays in the page's <video>
 * element (the TV decodes HLS and the provider's streams itself); trailers open in the YouTube app; the remote's Back is 461. */
import { createHtml5Engine } from '../../src/services/playerEngines.js';
import { Action } from '../../src/core/actions.js';
import { log } from '../../src/core/logger.js';
import { lunaCall, openYouTube } from './luna.js';

/** LG remote: Back (the media and channel keys use the standard codes, already common). */
export const WEBOS_KEY_CODES = Object.freeze({
  461: Action.BACK,
});

const hasWebOS = () => typeof window !== 'undefined' && typeof window.PalmServiceBridge === 'function';

export default {
  id: 'webos',
  name: 'LG webOS',
  keyCodes: WEBOS_KEY_CODES,
  exit() {
    try {
      window.close(); // closes the app on webOS (the launcher comes back)
    } catch {
      /* nothing else to do */
    }
  },
  createEngine: () => createHtml5Engine(),
  createTrailerEngine: null, // no in-app trailer: openTrailer
  openTrailer(videoId) {
    openYouTube(videoId).catch((err) => log.warn('YouTube app launch failed', err && err.message));
    return true;
  },
  runtimeChecks() {
    const bridge = hasWebOS();
    return [{ id: 'webos', status: bridge ? 'ok' : 'warn', detail: bridge ? 'webOS services available' : 'not running inside webOS' }];
  },
  // The physical panel: 3840x2160 on a UHD TV (the page itself is always 1920x1080).
  display: () =>
    lunaCall('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['UHD'] })
      .then((info) => (info && String(info.UHD) === 'true' ? { width: 3840, height: 2160 } : { width: 1920, height: 1080 }))
      .catch(() => null),
};
