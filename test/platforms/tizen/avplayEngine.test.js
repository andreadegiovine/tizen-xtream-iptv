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
