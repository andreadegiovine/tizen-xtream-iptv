/* Samsung Tizen (TV, Chromium 76+): the platform adapter (see src/platform/contract.js). Everything that only exists on Tizen is here or
 * next to this file: AVPlay, the remote keys, tizen.systeminfo, the YouTube service for trailers, config.xml, the signing certificate. */
import { createHtml5Engine } from '../../src/services/playerEngines.js';
import { createAvPlayEngine } from './avplayEngine.js';
import { createAvPlaySpike } from './avplaySpike.js';
import { createYouTubeEngine } from './youtubeEngine.js';
import { TIZEN_KEY_CODES, registerTizenKeys } from './keys.js';
import { tizenDisplay, tizenMemory, tizenNetwork } from './systemInfo.js';
import { log } from '../../src/core/logger.js';

const YOUTUBE_APP_ID = '111299001912'; // the YouTube app of Samsung TVs

const hasTizen = () => typeof window !== 'undefined' && typeof window.tizen !== 'undefined';

export default {
  id: 'tizen',
  name: 'Samsung Tizen',
  keyCodes: TIZEN_KEY_CODES,
  registerKeys: () => registerTizenKeys(),
  exit() {
    try {
      if (hasTizen()) window.tizen.application.getCurrentApplication().exit();
      else window.close(); // desktop browser (may be ignored by the browser)
    } catch {
      /* nothing else to do */
    }
  },
  // AVPlay on the TV; the <video> element in a desktop browser (development).
  createEngine() {
    const avplay = createAvPlayEngine();
    return avplay.available() ? avplay : createHtml5Engine();
  },
  // The "_youtube" packages play trailers in the app (YouTube page served by the on-TV service); the others (store) open the TV's YouTube app.
  createTrailerEngine: (typeof __YOUTUBE__ !== 'undefined' && __YOUTUBE__) || (typeof __DEV__ !== 'undefined' && __DEV__) ? createYouTubeEngine : null,
  openTrailer(videoId) {
    try {
      const data = new tizen.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: `v=${videoId}` })]);
      const control = new tizen.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, [data]);
      tizen.application.launchAppControl(control, YOUTUBE_APP_ID, null, (err) => log.warn('YouTube app did not open', err && err.message));
      return true;
    } catch (err) {
      log.warn('YouTube app not available', err && err.message);
      return false;
    }
  },
  createDiagnosticPlayer: createAvPlaySpike,
  runtimeChecks() {
    const row = (id, good, yes, no) => ({ id, status: good ? 'ok' : 'warn', detail: good ? yes : no });
    const api = typeof webapis !== 'undefined' ? webapis : null;
    return [
      row('tizen', typeof tizen !== 'undefined', 'tizen API present', 'not running inside Tizen'),
      row('webapis', Boolean(api), 'webapis present', 'webapis.js not loaded'),
      row('avplay', Boolean(api && api.avplay), 'AVPlay available', 'AVPlay not available'),
    ];
  },
  display: (env) => tizenDisplay(env),
  memory: (env) => tizenMemory(env),
  networkType: (env) => tizenNetwork(env),
};
