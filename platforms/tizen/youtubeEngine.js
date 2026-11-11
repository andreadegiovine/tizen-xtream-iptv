/* Tizen trailer plugin: YouTube in an iframe served by an on-TV service (the embed refuses a file:// origin, error 153). */
import { log } from '../../src/core/logger.js';
import { videoIdOf } from '../../src/services/trailer.js';

export { youtubeStreamUrl, videoIdOf } from '../../src/services/trailer.js';

/** Port of the on-TV service that serves the YouTube player page (see platforms/tizen/youtube/service.js). */
export const YOUTUBE_SERVICE_PORT = 8125;
const READY_TIMEOUT_MS = 30000; // the service may take up to SERVICE_READY_MS to answer, then the page loads
const SERVICE_WAIT_MS = 1500;
/** The service just launched may take seconds to listen (a cold start of its Node runtime): its /health is asked until it answers. */
export const SERVICE_POLL_MS = 300;
export const SERVICE_READY_MS = 15000;


/** Player page: the on-TV service when the app runs from a package (file://), otherwise the page next to the app. */
export function playerPageUrl(videoId, location = typeof window !== 'undefined' ? window.location : { protocol: 'http:' }) {
  const base = location.protocol === 'file:' ? `http://localhost:${YOUTUBE_SERVICE_PORT}/player.html` : 'yt-player.html';
  return `${base}?videoId=${encodeURIComponent(videoId)}`;
}

/**
 * Message from the player page → handler calls and the clock the controller polls.
 * state codes: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
 */
export function applyBridgeMessage(message, handlers, clock) {
  if (!message || !message.__ytbridge) return;
  if (message.type === 'ready') handlers.onPrepared();
  else if (message.type === 'time') {
    clock.time = Number(message.t) || 0;
    clock.duration = Number(message.d) || 0;
  } else if (message.type === 'state') {
    if (message.data === 0) handlers.onEnded();
    else if (message.data === 3) handlers.onBuffering(0);
    else if (message.data === 1) handlers.onBufferingDone();
  } else if (message.type === 'error') handlers.onError(`YouTube ${message.data}`);
}

/** Starts the on-TV service (a no-op in a desktop browser). Resolves when it had a moment to listen. */
function launchService() {
  return new Promise((resolve) => {
    const tz = typeof tizen !== 'undefined' ? tizen : null;
    if (!tz || !tz.application || (typeof window !== 'undefined' && window.location.protocol !== 'file:')) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, SERVICE_WAIT_MS);
    try {
      const pkg = tz.application.getCurrentApplication().appInfo.id.split('.')[0];
      tz.application.launch(`${pkg}.ytresolver`, () => setTimeout(() => { clearTimeout(timer); resolve(); }, 400), (err) => {
        log.warn('YouTube service launch failed', err && err.message);
      });
    } catch (err) {
      log.warn('YouTube service launch failed', err && err.message);
    }
  });
}

/**
 * Resolves once the on-TV service answers on /health (true), or after `limitMs` (false). The first trailer after the TV started used to
 * load the player page before the service listened: the iframe showed the browser's error page and the trailer never started. Nothing to
 * wait for outside a package (the page sits next to the app).
 */
export async function waitForService({ fetchImpl = typeof fetch === 'function' ? fetch.bind(window) : null, location = typeof window !== 'undefined' ? window.location : { protocol: 'http:' }, limitMs = SERVICE_READY_MS, pollMs = SERVICE_POLL_MS, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  if (location.protocol !== 'file:' || !fetchImpl) return true;
  const until = now() + limitMs;
  for (;;) {
    try {
      const res = await fetchImpl(`http://localhost:${YOUTUBE_SERVICE_PORT}/health`, { cache: 'no-store' });
      if (res && res.ok) return true;
    } catch {
      /* not listening yet */
    }
    if (now() >= until) return false;
    await wait(pollMs);
  }
}

/**
 * Player engine for YouTube videos (same contract as the AVPlay / <video> engines): the player page runs in an
 * iframe behind the app's own controls and is driven with postMessage. Aspect ratio and subtitles do not apply.
 */
export function createYouTubeEngine() {
  let frame = null;
  let listener = null;
  let timer = null;
  const clock = { time: 0, duration: 0 };

  const send = (cmd, val) => {
    if (frame && frame.contentWindow) frame.contentWindow.postMessage({ __ytbridge_cmd: true, cmd, val }, '*');
  };

  return {
    kind: 'youtube',
    available: () => typeof document !== 'undefined',
    start(url, { handlers }) {
      this.stop();
      const id = videoIdOf(url);
      if (!id) throw new Error('Not a YouTube video');
      clock.time = 0;
      clock.duration = 0;
      const mine = document.createElement('iframe');
      frame = mine;
      mine.setAttribute('tabindex', '-1');
      mine.setAttribute('allow', 'autoplay; encrypted-media');
      mine.style.cssText = 'position:fixed;left:0;top:0;width:1920px;height:1080px;border:0;z-index:-1;background:#000;pointer-events:none';
      listener = (event) => {
        if (event.source === mine.contentWindow) {
          if (event.data && event.data.type === 'ready') clearTimeout(timer);
          applyBridgeMessage(event.data, handlers, clock);
        }
      };
      window.addEventListener('message', listener);
      document.body.classList.add('video-active');
      document.body.appendChild(mine);
      timer = setTimeout(() => handlers.onError('player did not start'), READY_TIMEOUT_MS);
      launchService()
        .then(() => waitForService())
        .then((up) => {
          if (!up) log.warn('YouTube service not answering: loading the player page anyway');
          if (frame === mine) mine.src = playerPageUrl(id);
        });
    },
    play: () => send('play'),
    pause: () => send('pause'),
    seekTo: (ms) => send('seek', ms),
    getTime: () => clock.time,
    getDuration: () => clock.duration,
    setAspect: () => undefined,
    getSubtitleTracks: () => [],
    setSubtitleTrack: () => undefined,
    stop() {
      clearTimeout(timer);
      if (listener) window.removeEventListener('message', listener);
      listener = null;
      if (frame) {
        send('stop');
        frame.remove();
      }
      frame = null;
      document.body.classList.remove('video-active');
    },
  };
}
