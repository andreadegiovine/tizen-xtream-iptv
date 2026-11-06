import { createAvPlayEngine, AVPLAY_ASPECT_MODES } from '../../../platforms/tizen/avplayEngine.js';

afterEach(() => {
  delete global.webapis;
});

test('aspect ratio: only the modes AVPlay has; the area is set again so the change shows', () => {
  const calls = [];
  global.webapis = { avplay: { open() {}, prepareAsync() {}, setDisplayRect: (...a) => calls.push(['rect', ...a]), setDisplayMethod: (m) => calls.push(['method', m]) } };
  const engine = createAvPlayEngine();
  expect(engine.aspectModes).toEqual(AVPLAY_ASPECT_MODES);
  expect(AVPLAY_ASPECT_MODES).toEqual(['fit', 'fill']); // no crop on AVPlay
  engine.setAspect('fill');
  engine.setAspect('fit');
  expect(calls).toEqual([
    ['method', 'PLAYER_DISPLAY_MODE_FULL_SCREEN'],
    ['rect', 0, 0, 1920, 1080],
    ['method', 'PLAYER_DISPLAY_MODE_LETTER_BOX'],
    ['rect', 0, 0, 1920, 1080],
  ]);
});
