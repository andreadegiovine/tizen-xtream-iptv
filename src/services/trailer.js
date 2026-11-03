import { log } from '../core/logger.js';

const YOUTUBE_TV_APP_ID = '111299001912';

/** The provider gives either the bare 11-character id or a full youtube URL. */
export function youtubeId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[\w-]{11}$/.test(text)) return text;
  const match = /(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/.exec(text);
  return match ? match[1] : '';
}

export const youtubeUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

/** Opens the trailer in the YouTube app on the TV, or in a new tab in a desktop browser. */
export function openTrailer(value) {
  const id = youtubeId(value);
  if (!id) return false;
  const tz = typeof tizen !== 'undefined' ? tizen : null;
  if (tz && tz.application) {
    try {
      const control = new tz.ApplicationControl('http://tizen.org/appcontrol/operation/view', null, null, null, [
        new tz.ApplicationControlData('PAYLOAD', [JSON.stringify({ values: `v=${id}` })]),
      ]);
      tz.application.launchAppControl(control, YOUTUBE_TV_APP_ID, () => undefined, (err) => log.warn('YouTube launch failed', err && err.message));
      return true;
    } catch (err) {
      log.warn('YouTube launch failed', err && err.message);
    }
  }
  window.open(youtubeUrl(id), '_blank');
  return true;
}
