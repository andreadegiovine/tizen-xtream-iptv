/* webOS system services ("Luna" bus) without webOSTV.js: PalmServiceBridge is what that library uses underneath, and it exists in every
 * webOS web app. Resolves with the answer, rejects when the service fails or the bridge is not there (a desktop browser). */
export function lunaCall(uri, parameters = {}, env = typeof window !== 'undefined' ? window : {}) {
  return new Promise((resolve, reject) => {
    if (typeof env.PalmServiceBridge !== 'function') {
      reject(new Error('webOS services are not available'));
      return;
    }
    const bridge = new env.PalmServiceBridge();
    bridge.onservicecallback = (text) => {
      let answer = null;
      try {
        answer = JSON.parse(text);
      } catch {
        answer = { returnValue: false, errorText: String(text) };
      }
      if (answer && answer.returnValue === false) reject(new Error(answer.errorText || 'service failed'));
      else resolve(answer);
    };
    bridge.call(uri, JSON.stringify(parameters));
  });
}

/** The YouTube app of the TV on a video (trailers: webOS has no in-app player for them). */
export const YOUTUBE_APP_ID = 'youtube.leanback.v4';

export function openYouTube(videoId, env) {
  return lunaCall('luna://com.webos.applicationManager/launch', { id: YOUTUBE_APP_ID, params: { contentTarget: `https://www.youtube.com/tv?v=${videoId}` } }, env);
}
