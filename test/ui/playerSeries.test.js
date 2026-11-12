import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { Action } from '../../src/core/input.js';
import { createNoticeService } from '../../src/ui/components/notice.js';

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const EPISODES = [
  { id: 11, ext: 'mkv', title: 'Uno', season: 1, number: 1 },
  { id: 12, ext: 'mkv', title: 'Due', season: 1, number: 2 },
  { id: 13, ext: 'mkv', title: 'Tre', season: 1, number: 3 },
];

function setup({ index = 1, autoplayNext = true, stored = {} } = {}) {
  let handlers = null;
  let now = 0;
  const engine = {
    available: () => true,
    start: jest.fn((url, opts) => {
      handlers = opts.handlers;
    }),
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    stop: jest.fn(),
    getTime: () => now,
    getDuration: () => 600000, // 10 minutes
    getSubtitleTracks: () => [{ index: 1, language: 'ita' }],
  };
  const client = { streamUrl: (type, id) => `http://h/series/${id}.mkv` };
  const credits = {
    map: { ...stored },
    get: jest.fn(async (p, key) => credits.map[`${p}|${key}`] || null),
    set: jest.fn(async (p, key, seconds) => {
      credits.map[`${p}|${key}`] = seconds;
    }),
    remove: jest.fn(async (p, key) => {
      delete credits.map[`${p}|${key}`];
    }),
  };
  const ctx = {
    createEngine: () => engine,
    notices: createNoticeService({ root: document.body }),
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, timeFormat: '24h', autoplayNext }) },
    active: { get: async () => ({ provider: { id: 'p' }, client, db: null }), authenticatedClient: async () => client },
    watch: { get: async () => null, save: async () => null },
    dialogs: { isOpen: () => false, choose: jest.fn() },
    router: { back: jest.fn() },
    credits,
  };
  const page = createPlayerPage(ctx, { type: 'series', entryKey: 'series:t1396', title: 'Breaking Bad', playlist: EPISODES, index });
  document.body.appendChild(page.el);
  page.mount();
  const button = (label) => Array.from(page.el.querySelectorAll('.player-btn')).find((b) => b.getAttribute('aria-label') === label);
  const visible = (label) => Boolean(button(label)) && button(label).style.display !== 'none';
  const focus = (label) => {
    page.onAction(Action.DOWN);
    for (let i = 0; i < 10 && !button(label).classList.contains('focused'); i += 1) page.onAction(Action.RIGHT);
    expect(button(label).classList.contains('focused')).toBe(true);
  };
  return { ctx, page, engine, credits, button, visible, focus, start: () => handlers.onPrepared(), setTime: (ms) => (now = ms) };
}

const notices = () => Array.from(document.querySelectorAll('.notice-text')).map((n) => n.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

test('no back / forward 30 s buttons; previous / next episode only when there is one', async () => {
  const s = setup({ index: 0 });
  await wait();
  expect(s.button('Back 30 s')).toBeUndefined();
  expect(s.button('Forward 30 s')).toBeUndefined();
  expect(s.visible('Previous episode')).toBe(false);
  expect(s.visible('Next episode')).toBe(true);
  s.focus('Next episode');
  expect(s.button('Next episode').getAttribute('data-tip')).toBe('Next episode'); // its name as tooltip
  s.page.onAction(Action.ENTER);
  await wait();
  expect(s.engine.start).toHaveBeenLastCalledWith('http://h/series/12.mkv', expect.anything());
  expect(s.visible('Previous episode')).toBe(true);
  expect(s.visible('Next episode')).toBe(true);
  s.page.onAction(Action.CHANNEL_UP);
  await wait();
  expect(s.visible('Next episode')).toBe(false); // last episode
  s.page.destroy();
});

test('credits button: only with "play the next episode" on, last on the right', async () => {
  const off = setup({ autoplayNext: false });
  await wait();
  expect(off.visible('End credits start')).toBe(false);
  off.page.destroy();
  document.body.innerHTML = '';
  const on = setup();
  await wait();
  expect(on.visible('End credits start')).toBe(true);
  const right = on.page.el.querySelectorAll('.player-group')[1];
  expect(right.lastChild).toBe(on.button('End credits start'));
  on.focus('End credits start');
  expect(on.button('End credits start').getAttribute('data-tip')).toBe('End credits start');
  on.page.destroy();
});

test('setting the credits start: saved for the series from the end, darker bar, next episode offered from there; again = removed', async () => {
  const s = setup();
  await wait();
  s.start();
  s.setTime(500000); // 8:20 of 10:00
  await wait(700);
  s.focus('End credits start');
  s.page.onAction(Action.ENTER);
  await wait();
  expect(s.credits.set).toHaveBeenCalledWith('p', 'series:t1396', 100);
  const zone = s.page.el.querySelector('.player-credits');
  expect(zone.style.display).toBe('');
  expect(parseFloat(zone.style.left)).toBeCloseTo(83.33, 1);
  expect(s.button('Remove end credits start')).toBeTruthy();
  expect(s.button('Remove end credits start').classList.contains('active')).toBe(true);
  expect(notices().some((n) => n.indexOf('1:40') >= 0)).toBe(true);
  // the countdown starts at the credits point (here: already reached)
  await wait(700);
  expect(notices()).toContain('Next episode in 10 seconds');
  // again: removed, the bar is plain
  s.page.onAction(Action.DOWN);
  s.focus('Remove end credits start');
  s.page.onAction(Action.ENTER);
  await wait();
  expect(s.credits.remove).toHaveBeenCalledWith('p', 'series:t1396');
  expect(zone.style.display).toBe('none');
  s.page.destroy();
});

test('a point set earlier is used by every episode; without one the notice comes 10 s before the end', async () => {
  const s = setup({ stored: { 'p|series:t1396': 200 } }); // credits 200 s before the end: at 6:40
  await wait();
  s.start();
  s.setTime(390000); // 6:30, before the credits
  await wait(700);
  expect(parseFloat(s.page.el.querySelector('.player-credits').style.left)).toBeCloseTo(66.67, 1);
  expect(notices()).not.toContain('Next episode in 10 seconds');
  s.setTime(405000); // 6:45, after the credits start (but 3:15 before the end)
  await wait(700);
  expect(notices()).toContain('Next episode in 10 seconds');
  s.page.destroy();
  document.body.innerHTML = '';
  const plain = setup();
  await wait();
  plain.start();
  plain.setTime(405000); // 3:15 before the end: nothing yet
  await wait(700);
  expect(notices()).not.toContain('Next episode in 10 seconds');
  expect(plain.page.el.querySelector('.player-credits').style.display).toBe('none');
  plain.setTime(490000); // 1:50 before the end: not yet
  await wait(700);
  expect(notices()).not.toContain('Next episode in 10 seconds');
  plain.setTime(590000); // 10 s before the end
  await wait(700);
  expect(notices()).toContain('Next episode in 10 seconds');
  plain.page.destroy();
}, 10000);

test('previous episode, back 30 s, play / pause, forward 30 s, next episode; play / pause keeps the focus when the controls open', async () => {
  const s = setup({ index: 1 });
  await wait();
  const order = Array.from(s.page.el.querySelectorAll('.player-btn')).map((b) => b.getAttribute('aria-label'));
  expect(order.slice(0, 5)).toEqual(['Previous episode', 'Back 30 seconds', 'Pause', 'Forward 30 seconds', 'Next episode']);
  s.page.onAction(Action.DOWN);
  expect(s.button('Pause').classList.contains('focused')).toBe(true);
  s.page.onAction(Action.LEFT);
  expect(s.button('Back 30 seconds').classList.contains('focused')).toBe(true);
  s.page.onAction(Action.LEFT);
  expect(s.button('Previous episode').classList.contains('focused')).toBe(true);
  s.page.destroy();
});

test('"ends at" of an episode counts to the start of the end credits when the series has one', async () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 8, 20, 0, 0) });
  const s = setup({ stored: { 'p|series:t1396': 200 } }); // 10 minutes, credits 200 s before the end: at 6:40
  await jest.advanceTimersByTimeAsync(50);
  s.start();
  await jest.advanceTimersByTimeAsync(1100);
  expect(s.page.el.textContent).toContain('ends at 20:06'); // 6:40 from now, not 10:00
  s.page.destroy();
  jest.useRealTimers();
});
