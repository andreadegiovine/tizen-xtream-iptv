import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { createNoticeService } from '../../src/ui/components/notice.js';
import { Action } from '../../src/core/input.js';

const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function setup({ autoplayNext = true, duration = 3000 } = {}) {
  const clock = { time: 0, duration };
  let handlers = null;
  const engine = {
    available: () => true,
    start: jest.fn((url, o) => {
      handlers = o.handlers;
    }),
    play: jest.fn(),
    pause: jest.fn(),
    seekTo: jest.fn(),
    stop: jest.fn(),
    getTime: () => clock.time * 1000,
    getDuration: () => clock.duration * 1000,
  };
  const notices = createNoticeService({ root: document.body });
  const ctx = {
    createEngine: () => engine,
    notices,
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, autoplayNext, timeFormat: 'auto' }) },
    active: { get: async () => ({ provider: { id: 'p' }, client: { streamUrl: (type, id) => `http://h/${id}.mp4` } }) },
    watch: { get: async () => null, save: async () => undefined, all: async () => [] },
    router: { back: jest.fn() },
  };
  const page = createPlayerPage(ctx, {
    type: 'series',
    entryKey: 'series:1',
    title: 'S',
    playlist: [
      { id: 'e1', ext: 'mp4', title: 'Uno', season: 1, number: 1 },
      { id: 'e2', ext: 'mp4', title: 'Due', season: 1, number: 2 },
    ],
    index: 0,
  });
  return { page, ctx, engine, clock, notices, handlers: () => handlers };
}

describe('player notices', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('retries are notices, the video area only says "paused"', async () => {
    const { page, notices, handlers, engine } = setup();
    document.body.appendChild(page.el);
    page.mount();
    await flush();
    handlers().onPrepared();
    notices.setPlayback(true);
    handlers().onError('boom');
    await flush();
    expect(document.body.querySelector('.notices .notice.warning')).not.toBeNull();
    expect(page.el.querySelector('.player-status').textContent).not.toMatch(/\d\/\d/);
    jest.advanceTimersByTime(20000);
    await flush();
    handlers().onPrepared();
    expect(document.body.querySelector('.notices .notice.warning')).toBeNull();
    expect(engine.start.mock.calls.length).toBeGreaterThan(1);
    page.destroy();
  });

  test('two minutes before the end the next episode is offered in a notice; OK plays it; no offer before', async () => {
    const { page, notices, handlers, clock, engine } = setup();
    document.body.appendChild(page.el);
    page.mount();
    await flush();
    notices.setPlayback(true);
    handlers().onPrepared();
    clock.time = 1000;
    jest.advanceTimersByTime(2000);
    expect(document.body.querySelector('.notices .notice')).toBeNull();
    clock.time = 3000 - 110;
    jest.advanceTimersByTime(2000);
    expect(document.body.querySelector('.notices .notice.info')).not.toBeNull();
    const notice = document.body.querySelector('.notices .notice');
    expect(notice.textContent).toMatch(/Prossimo episodio tra 11\d secondi|Next episode in 11\d seconds/);
    notice.click(); // it cannot be hidden
    expect(document.body.querySelector('.notices .notice.info')).not.toBeNull();
    clock.time = 3000 - 7;
    jest.advanceTimersByTime(2000);
    expect(document.body.querySelector('.notices .notice').textContent).toMatch(/\b[67]\b/);
    page.onAction(Action.ENTER);
    await flush();
    expect(engine.start).toHaveBeenCalledTimes(2);
    expect(engine.start.mock.calls[1][0]).toContain('e2');
    expect(document.body.querySelector('.notices .notice.info')).toBeNull();
    page.destroy();
  });

  test('at the end the next episode starts at once when autoplay is on', async () => {
    const { page, handlers, engine } = setup();
    document.body.appendChild(page.el);
    page.mount();
    await flush();
    handlers().onPrepared();
    handlers().onEnded();
    await flush();
    expect(engine.start).toHaveBeenCalledTimes(2);
    page.destroy();
  });
});
