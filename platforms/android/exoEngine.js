/*
 * Video engine of the Android TV / Fire TV app: ExoPlayer (ExoPlayerPlugin.java) behind the transparent WebView, as AVPlay on the TV.
 * Same contract as the other engines (src/services/playerController.js). The plugin answers asynchronously: the time, the duration and
 * the tracks arrive as events and are kept here, so that the synchronous getters of the contract have them.
 */
import { log } from '../../src/core/logger.js';

const PLUGIN = 'ExoPlayer';

/** The Capacitor bridge of the app (window.Capacitor, injected by the native side), or null in a browser. */
const bridge = (env) => (env && env.Capacitor && typeof env.Capacitor.nativePromise === 'function' ? env.Capacitor : null);

export function createExoEngine(env = typeof window !== 'undefined' ? window : {}) {
  let listener = null;
  let handlers = null;
  const clock = { position: 0, duration: 0, buffered: null };
  let tracks = { audio: [], text: [] };

  const call = (method, options = {}) => {
    const cap = bridge(env);
    if (!cap) return Promise.resolve();
    return cap.nativePromise(PLUGIN, method, options).catch((err) => log.warn(`ExoPlayer ${method} failed`, err && err.message));
  };

  function onEvent(event) {
    if (!event || !handlers) return;
    if (event.type === 'time') {
      clock.position = Number(event.position) || 0;
      clock.duration = Number(event.duration) || 0;
      clock.buffered = Number.isFinite(Number(event.buffered)) ? Number(event.buffered) : null;
    } else if (event.type === 'prepared') handlers.onPrepared();
    else if (event.type === 'buffering') handlers.onBuffering(Number(event.percent) || 0);
    else if (event.type === 'bufferingDone') handlers.onBufferingDone();
    else if (event.type === 'ended') handlers.onEnded();
    else if (event.type === 'error') handlers.onError(String(event.message || 'ExoPlayer error'));
    else if (event.type === 'tracks') tracks = { audio: event.audio || [], text: event.text || [] };
  }

  return {
    kind: 'exoplayer',
    available: () => Boolean(bridge(env)),
    start(url, { bufferSeconds = 10, handlers: next }) {
      const cap = bridge(env);
      if (!cap) throw new Error('ExoPlayer is not available');
      this.stop();
      handlers = next;
      clock.position = 0;
      clock.duration = 0;
      clock.buffered = null;
      tracks = { audio: [], text: [] };
      listener = cap.addListener(PLUGIN, 'event', onEvent);
      // The page is see-through over the video: <html> too, its background fills the whole WebView.
      if (typeof document !== 'undefined') [document.documentElement, document.body].forEach((node) => node.classList.add('video-active'));
      call('start', { url, bufferSeconds });
    },
    play: () => call('play'),
    pause: () => call('pause'),
    seekTo: (ms) => {
      clock.position = Math.max(0, ms);
      call('seekTo', { ms: Math.round(ms) });
    },
    getTime: () => clock.position,
    getDuration: () => clock.duration,
    getBufferedEnd: () => clock.buffered,
    setAspect(mode) {
      call('setAspect', { mode });
      return true;
    },
    getSubtitleTracks: () => tracks.text.map((track) => ({ index: track.index, language: track.language || '' })),
    getAudioTracks: () => tracks.audio.map((track) => ({ index: track.index, language: track.language || '', current: Boolean(track.current) })),
    setAudioTrack: (index) => call('selectAudio', { index }),
    /** index = track to show (drawn by ExoPlayer), null = subtitles off. */
    setSubtitleTrack: (index) => call('selectText', { index: index === null ? -1 : index }),
    stop() {
      if (listener) {
        listener.remove();
        listener = null;
      }
      handlers = null;
      call('stop');
      if (typeof document !== 'undefined') [document.documentElement, document.body].forEach((node) => node.classList.remove('video-active'));
    },
  };
}
