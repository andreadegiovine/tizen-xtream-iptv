import android, { ANDROID_KEY_CODES, ANDROID_KEY_OFFSET, dispatchRemoteKey } from '../../../platforms/android/platform.js';
import { createExoEngine } from '../../../platforms/android/exoEngine.js';
import { Action } from '../../../src/core/actions.js';

/** A Capacitor bridge that records the calls and lets the test send the plugin's events. */
function fakeCapacitor() {
  const calls = [];
  let listener = null;
  return {
    calls,
    emit: (event) => listener && listener(event),
    Capacitor: {
      nativePromise: (plugin, method, options) => {
        calls.push([plugin, method, options]);
        return Promise.resolve({});
      },
      addListener: (plugin, name, callback) => {
        listener = callback;
        return { remove: () => { listener = null; } };
      },
    },
  };
}

test('remote: Back, media and channel keys come from the activity as 10000 + the Android key code', () => {
  expect(ANDROID_KEY_CODES[ANDROID_KEY_OFFSET + 4]).toBe(Action.BACK);
  expect(ANDROID_KEY_CODES[ANDROID_KEY_OFFSET + 85]).toBe(Action.PLAY_PAUSE);
  expect(ANDROID_KEY_CODES[ANDROID_KEY_OFFSET + 90]).toBe(Action.FAST_FORWARD);
  expect(ANDROID_KEY_CODES[ANDROID_KEY_OFFSET + 166]).toBe(Action.CHANNEL_UP);
  const seen = [];
  document.addEventListener('keydown', (e) => seen.push(e.keyCode), { once: true });
  dispatchRemoteKey(ANDROID_KEY_OFFSET + 4);
  expect(seen).toEqual([10004]);
  android.registerKeys();
  expect(typeof window.__xtreamKey).toBe('function');
});

test('ExoPlayer engine: commands to the plugin, events kept for the synchronous getters of the contract', () => {
  const fake = fakeCapacitor();
  const engine = createExoEngine({ Capacitor: fake.Capacitor });
  expect(engine.available()).toBe(true);
  const handlers = { onPrepared: jest.fn(), onBuffering: jest.fn(), onBufferingDone: jest.fn(), onEnded: jest.fn(), onError: jest.fn() };
  engine.start('http://h/live/u/p/1.ts', { bufferSeconds: 8, handlers });
  expect(fake.calls.pop()).toEqual(['ExoPlayer', 'start', { url: 'http://h/live/u/p/1.ts', bufferSeconds: 8 }]);
  fake.emit({ type: 'prepared' });
  fake.emit({ type: 'time', position: 1500, duration: 60000, buffered: 9000 });
  fake.emit({ type: 'tracks', audio: [{ index: 0, language: 'ita', current: true }, { index: 1, language: 'eng', current: false }], text: [{ index: 0, language: 'ita' }] });
  fake.emit({ type: 'error', message: 'ERROR_CODE_IO_BAD_HTTP_STATUS' });
  expect(handlers.onPrepared).toHaveBeenCalled();
  expect(handlers.onError).toHaveBeenCalledWith('ERROR_CODE_IO_BAD_HTTP_STATUS');
  expect([engine.getTime(), engine.getDuration(), engine.getBufferedEnd()]).toEqual([1500, 60000, 9000]);
  expect(engine.getAudioTracks()).toEqual([{ index: 0, language: 'ita', current: true }, { index: 1, language: 'eng', current: false }]);
  expect(engine.getSubtitleTracks()).toEqual([{ index: 0, language: 'ita' }]);
  expect(engine.setAspect('zoom')).toBe(true);
  engine.setSubtitleTrack(null);
  engine.seekTo(30000);
  expect(fake.calls.slice(-3)).toEqual([['ExoPlayer', 'setAspect', { mode: 'zoom' }], ['ExoPlayer', 'selectText', { index: -1 }], ['ExoPlayer', 'seekTo', { ms: 30000 }]]);
  expect(document.body.classList.contains('video-active')).toBe(true);
  engine.stop();
  expect(document.body.classList.contains('video-active')).toBe(false);
  fake.emit({ type: 'ended' }); // after stop: nobody listens
  expect(handlers.onEnded).not.toHaveBeenCalled();
});

test('outside the app (a browser) the <video> engine plays', () => {
  expect(createExoEngine({}).available()).toBe(false);
  expect(android.createEngine().kind).toBe('html5');
});
