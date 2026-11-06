import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { Action } from '../../src/core/input.js';
import { createNoticeService } from '../../src/ui/components/notice.js';

let mockFull = false;
jest.mock('../../src/platform/index.js', () => {
  const actual = jest.requireActual('../../src/platform/index.js');
  return {
    platform: {
      ...actual.platform,
      toggleFullscreen: jest.fn(async () => {
        mockFull = !mockFull;
        return mockFull;
      }),
      isFullscreen: jest.fn(async () => mockFull),
    },
  };
});

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test('a platform with a window gets a full-screen button in the player; it follows the state of the window', async () => {
  const engine = { available: () => true, start: jest.fn(), play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), stop: jest.fn(), getTime: () => 0, getDuration: () => 0 };
  const client = { streamUrl: () => 'http://h/movie/1' };
  const ctx = {
    createEngine: () => engine,
    notices: createNoticeService({ root: document.body }),
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, timeFormat: '24h' }) },
    active: { get: async () => ({ provider: { id: 'p' }, client, db: null }), authenticatedClient: async () => client },
    dialogs: { isOpen: () => false, choose: jest.fn() },
    router: { back: jest.fn() },
  };
  const page = createPlayerPage(ctx, { type: 'movie', entryKey: 'movie:t1', title: 'Heat', playlist: [{ id: 1, ext: 'mp4', title: '' }], index: 0 });
  document.body.appendChild(page.el);
  page.mount();
  await wait();
  const button = Array.from(page.el.querySelectorAll('.player-btn')).find((b) => b.getAttribute('aria-label') === 'Full screen');
  expect(button).toBeTruthy();
  page.onAction(Action.DOWN); // focus on the controls: play / pause
  [Action.RIGHT, Action.RIGHT, Action.RIGHT, Action.RIGHT].forEach((a) => page.onAction(a)); // forward, aspect ratio, subtitles, full screen
  expect(button.classList.contains('focused')).toBe(true);
  page.onAction(Action.ENTER);
  await wait();
  expect(mockFull).toBe(true);
  expect(button.getAttribute('aria-label')).toBe('Exit full screen');
  page.destroy();
});
