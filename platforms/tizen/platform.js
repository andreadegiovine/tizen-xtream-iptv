/* Samsung Tizen (TV, Chromium 76+): the platform adapter (see src/platform/contract.js). Everything that only exists on Tizen is here or
 * next to this file: AVPlay, the remote keys, tizen.systeminfo, the YouTube service for trailers, config.xml, the signing certificate. */
import { createHtml5Engine } from '../../src/services/playerEngines.js';
import { createAvPlayEngine } from './avplayEngine.js';
import { createAvPlaySpike } from './avplaySpike.js';
import { createYouTubeEngine } from './youtubeEngine.js';
import { TIZEN_KEY_CODES, registerTizenKeys } from './keys.js';
import { tizenDisplay, tizenMemory, tizenNetwork } from './systemInfo.js';

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
  createTrailerEngine: createYouTubeEngine,
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
