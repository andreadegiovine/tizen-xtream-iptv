import { createAvPlayEngine } from '../../../platforms/tizen/avplayEngine.js';

afterEach(() => {
  delete global.webapis;
});

test('aspect ratio: letterbox, full screen, cropped; only setDisplayMethod; false when AVPlay refuses the mode', () => {
  const calls = [];
  let refuse = false;
  global.webapis = {
    avplay: {
      open() {},
      prepareAsync() {},
      setDisplayRect: (...a) => calls.push(['rect', ...a]),
      setDisplayMethod: (m) => {
        if (refuse) throw new Error('InvalidValuesError');
        calls.push(['method', m]);
      },
    },
  };
  const engine = createAvPlayEngine();
  expect(engine.aspectModes).toBeUndefined(); // all three modes of the player
  expect(['fit', 'fill', 'zoom'].map((mode) => engine.setAspect(mode))).toEqual([true, true, true]);
  expect(calls).toEqual([
    ['method', 'PLAYER_DISPLAY_MODE_LETTER_BOX'],
    ['method', 'PLAYER_DISPLAY_MODE_FULL_SCREEN'],
    ['method', 'PLAYER_DISPLAY_MODE_CROPPED_FULL'],
  ]);
  refuse = true;
  expect(engine.setAspect('zoom')).toBe(false);
});

test('subtitles: choosing a track opens the video again and chooses it once playing, at the same position; off only stops drawing', () => {
  const calls = [];
  let listener = null;
  global.webapis = {
    avplay: {
      open: (url) => calls.push(`open ${url}`),
      setDisplayRect() {},
      setBufferingParam() {},
      setListener: (l) => {
        listener = l;
      },
      prepareAsync: (ok) => ok(),
      getCurrentTime: () => 61000,
      seekTo: (ms, ok) => {
        calls.push(`seek ${ms}`);
        ok();
      },
      play: () => calls.push('play'),
      getState: () => 'PLAYING',
      setSilentSubtitle: (v) => calls.push(`silent ${v}`),
      setSelectTrack: (type, i) => calls.push(`select ${type} ${i}`),
      stop: () => calls.push('stop'),
      close: () => calls.push('close'),
    },
  };
  const lines = [];
  const prepared = jest.fn();
  const engine = createAvPlayEngine();
  engine.start('http://x/movie.mkv', { bufferSeconds: 5, handlers: { onPrepared: prepared, onBuffering() {}, onSubtitle: (text, ms) => lines.push([text, ms]) } });
  expect(prepared).toHaveBeenCalledTimes(1);
  expect(calls).not.toContain('silent true'); // silent mode is never turned on
  listener.onsubtitlechange('1000', 'auto-selected', 'text');
  expect(lines).toEqual([]); // no lines drawn before a track is chosen
  calls.length = 0;
  engine.setSubtitleTrack(3);
  expect(calls).toEqual(['stop', 'close', 'open http://x/movie.mkv', 'seek 61000', 'play', 'select TEXT 3', 'silent false']); // READY refuses the track: chosen once playing
  expect(prepared).toHaveBeenCalledTimes(1); // the page is not told the video started again
  listener.onsubtitlechange('2500', 'Ciao<br>mondo', 'text');
  expect(lines).toEqual([['Ciao<br>mondo', 2500]]);
  calls.length = 0;
  engine.setSubtitleTrack(null);
  expect(calls).toEqual([]);
  listener.onsubtitlechange('1000', 'hidden', 'text');
  expect(lines).toHaveLength(1);
  engine.stop();
});
