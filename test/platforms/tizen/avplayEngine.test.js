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

test('subtitles: AVPlay sends the lines, the page draws them; silent only when off; track changed while paused', () => {
  const calls = [];
  let listener = null;
  let state = 'PLAYING';
  global.webapis = {
    avplay: {
      open() {},
      setDisplayRect() {},
      setBufferingParam() {},
      setListener: (l) => {
        listener = l;
      },
      prepareAsync: (ok) => ok(),
      getState: () => state,
      pause: () => calls.push('pause'),
      play: () => calls.push('play'),
      setSilentSubtitle: (v) => calls.push(`silent ${v}`),
      setSelectTrack: (type, i) => calls.push(`select ${type} ${i}`),
      stop() {},
      close() {},
    },
  };
  const lines = [];
  const engine = createAvPlayEngine();
  engine.start('http://x/movie.mkv', { bufferSeconds: 5, handlers: { onPrepared() {}, onSubtitle: (text, ms) => lines.push([text, ms]) } });
  expect(calls).toEqual(['silent true']); // no lines before a track is chosen
  listener.onsubtitlechange('1000', 'auto-selected', 'text');
  expect(lines).toEqual([]);
  calls.length = 0;
  engine.setSubtitleTrack(3);
  expect(calls).toEqual(['pause', 'silent false', 'select TEXT 3', 'play']);
  listener.onsubtitlechange('2500', 'Ciao<br>mondo', 'text');
  expect(lines).toEqual([['Ciao<br>mondo', 2500]]);
  calls.length = 0;
  state = 'PAUSED';
  engine.setSubtitleTrack(4);
  expect(calls).toEqual(['silent false', 'select TEXT 4']); // paused by the user: stays paused
  calls.length = 0;
  engine.setSubtitleTrack(null);
  expect(calls).toEqual(['silent true']);
  listener.onsubtitlechange('1000', 'hidden', 'text');
  expect(lines).toHaveLength(1);
  engine.stop();
});
