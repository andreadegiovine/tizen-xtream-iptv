import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { createNoticeService } from '../../src/ui/components/notice.js';

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function open() {
  const engine = { available: () => true, start: jest.fn((url, { handlers }) => setTimeout(() => handlers.onPrepared(), 0)), play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), stop: jest.fn(), getTime: () => 100000, getDuration: () => 1000000 };
  const client = { streamUrl: () => 'http://h/movie/1' };
  const ctx = {
    createEngine: () => engine,
    notices: createNoticeService({ root: document.body }),
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, timeFormat: '24h' }) },
    active: { get: async () => ({ provider: { id: 'p' }, client, db: null }), authenticatedClient: async () => client },
    dialogs: { isOpen: () => false, choose: jest.fn() },
    router: { back: jest.fn() },
    back: jest.fn(),
    watch: { get: async () => null, save: async () => undefined },
  };
  const page = createPlayerPage(ctx, { type: 'movie', entryKey: 'movie:t1', title: 'Heat', playlist: [{ id: 1, ext: 'mp4', title: '' }], index: 0 });
  document.body.appendChild(page.el);
  page.mount();
  return { page, ctx, engine };
}

const pointer = (type, target, x, extra = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, ...extra });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: extra.pointerType || 'touch' });
  target.dispatchEvent(event);
};

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

test('a cancelled drag on the bar keeps the last position (never 0: the video would start again)', async () => {
  const { page, engine } = open();
  await wait(1300); // prepared, then the clock read: the controller has the duration
  const seek = page.el.querySelector('.player-seek');
  const bar = page.el.querySelector('.player-bar');
  bar.getBoundingClientRect = () => ({ left: 0, width: 1000, top: 0, height: 10 });
  pointer('pointerdown', seek, 400);
  pointer('pointermove', document, 500);
  pointer('pointercancel', document, 0);
  await wait();
  const last = engine.seekTo.mock.calls[engine.seekTo.mock.calls.length - 1];
  expect(last).toBeTruthy();
  expect(last[0]).toBe(500000); // the last position of the drag (500 of 1000 px of a 1000 s film), not where the cancel says
  page.destroy();
});

test('a tap shows the controls (the mouse move sent with it does not), a second one hides them', async () => {
  document.body.classList.add('pointer-mode');
  const { page } = open();
  await wait();
  const controls = page.el.querySelector('.player-controls');
  if (controls.classList.contains('visible')) page.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); // shown at start
  pointer('pointermove', page.el, 500, { pointerType: 'touch' });
  page.el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 500 })); // the compatibility mouse move of a tap
  expect(controls.classList.contains('visible')).toBe(false);
  page.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(controls.classList.contains('visible')).toBe(true);
  page.el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(controls.classList.contains('visible')).toBe(false);
  page.destroy();
});

test('the Back button before the title goes back', async () => {
  const { page, ctx } = open();
  await wait();
  const back = page.el.querySelector('.player-top .player-back');
  expect(back.nextElementSibling.querySelector('.player-title')).not.toBeNull();
  back.click();
  expect(ctx.back).toHaveBeenCalled();
  page.destroy();
});
