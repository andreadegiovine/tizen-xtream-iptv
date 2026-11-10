import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { Action } from '../../src/core/input.js';
import { createNoticeService } from '../../src/ui/components/notice.js';

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ tracks = [], fetch, fileFetch = async () => ({ status: 404, headers: { get: () => null } }), url = 'http://h/movie/1.mp4' }) {
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
    getDuration: () => 600000,
    getSubtitleTracks: () => tracks,
    setSubtitleTrack: jest.fn(),
  };
  const client = { streamUrl: () => url };
  const notices = createNoticeService({ root: document.body });
  const ctx = {
    createEngine: () => engine,
    notices,
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, timeFormat: '24h' }) },
    active: { get: async () => ({ provider: { id: 'p' }, client, db: null }), authenticatedClient: async () => client },
    watch: { get: async () => null, save: async () => null },
    dialogs: { isOpen: () => false, choose: jest.fn() },
    router: { back: jest.fn() },
    openSubtitles: { enabled: true, fetch: jest.fn(fetch) },
    fetch: fileFetch,
  };
  const page = createPlayerPage(ctx, { type: 'movie', entryKey: 'movie:t603', title: 'Matrix', playlist: [{ id: 1, ext: 'mp4', title: '' }], index: 0 });
  document.body.appendChild(page.el);
  page.mount();
  return { ctx, page, engine, start: () => handlers && (handlers.onPrepared(), handlers.onBufferingDone()), setTime: (ms) => (now = ms) };
}

const noticeTexts = () => Array.from(document.querySelectorAll('.notice-text')).map((n) => n.textContent);

afterEach(() => {
  document.body.innerHTML = '';
});

function pressSubtitles(s) {
  const subtitles = Array.from(s.page.el.querySelectorAll('.player-btn')).find((b) => b.getAttribute('aria-label') === 'Subtitles');
  s.page.onAction(Action.DOWN); // focus on the controls: play / pause
  [Action.RIGHT, Action.RIGHT].forEach((a) => s.page.onAction(a)); // aspect ratio, subtitles
  expect(subtitles.classList.contains('focused')).toBe(true);
  s.page.onAction(Action.ENTER);
}

test('nothing is downloaded by itself: the list offers "Download from OpenSubtitles", then shows the downloaded subtitles in its place', async () => {
  let release;
  const s = setup({ fetch: () => new Promise((resolve) => (release = resolve)) });
  await wait();
  s.start();
  await wait(300);
  const lists = [];
  const answers = [(options) => options.find((o) => o.label === 'Download from OpenSubtitles').value, (options) => options[1].value];
  s.ctx.dialogs.choose.mockImplementation(async ({ options }) => {
    lists.push(options.map((o) => o.label));
    return answers.shift()(options);
  });
  pressSubtitles(s);
  await wait();
  expect(lists[0]).toEqual(['Off', 'Download from OpenSubtitles']);
  expect(s.ctx.openSubtitles.fetch).toHaveBeenCalledWith({ tmdbId: 603, languages: expect.any(Array) }, { url: 'http://h/movie/1.mp4' });
  expect(noticeTexts()).toContain('Downloading subtitles');
  release({ language: 'it', cues: [{ start: 1000, end: 3000, text: 'Ciao' }] });
  await wait(300);
  expect(noticeTexts()).toContain('Subtitles downloaded: Italiano');
  expect(lists[1]).toEqual(['Off', 'OpenSubtitles: Italiano', 'OpenSubtitles sync: 0.0 s']); // the download entry is gone
  s.setTime(1500);
  await wait(300);
  expect(s.page.el.querySelector('.player-subtitle').textContent).toBe('Ciao');
  expect(s.ctx.openSubtitles.fetch).toHaveBeenCalledTimes(1);
  s.page.destroy();
}, 10000);

test('the file has its own subtitles: they are listed with the download entry, nothing is downloaded until it is chosen', async () => {
  const s = setup({ tracks: [{ index: 2, language: 'ita' }], fetch: async () => ({ language: 'en', cues: [] }) });
  await wait();
  s.start();
  await wait(300);
  let labels = null;
  s.ctx.dialogs.choose.mockImplementation(async ({ options }) => {
    labels = options.map((o) => o.label);
    return null;
  });
  pressSubtitles(s);
  await wait(100);
  expect(s.ctx.openSubtitles.fetch).not.toHaveBeenCalled();
  expect(labels).toEqual(['Off', 'Italiano', 'Download from OpenSubtitles']);
  s.page.destroy();
}, 10000);

test('timing of the downloaded subtitles: +2 s shows each line two seconds later', async () => {
  const s = setup({ fetch: async () => ({ language: 'it', matched: true, cues: [{ start: 1000, end: 3000, text: 'Ciao' }] }) });
  await wait();
  s.start();
  await wait(100);
  const answers = [() => 'download', (options) => {
    expect(options.map((o) => o.label)).toEqual(['Off', 'OpenSubtitles: Italiano (for this file)', 'OpenSubtitles sync: 0.0 s']);
    return 'sync';
  }, (options) => {
    expect(options[0].label).toBe('−5:00 min');
    expect(options.some((o) => o.label === '−1:00 min')).toBe(true);
    return options.find((o) => o.label === '+2.0 s').value;
  }];
  s.ctx.dialogs.choose.mockImplementation(async ({ options }) => answers.shift()(options));
  pressSubtitles(s);
  await wait(300);
  s.setTime(1500); // the line starts at 3 s now
  await wait(300);
  expect(s.page.el.querySelector('.player-subtitle').textContent).toBe('');
  s.setTime(3500);
  await wait(300);
  expect(s.page.el.querySelector('.player-subtitle').textContent).toBe('Ciao');
  s.page.destroy();
}, 10000);

test('the subtitle line moves above the progress bar while the controls are shown, and back when they fade', async () => {
  jest.useFakeTimers();
  const s = setup({ fetch: async () => null });
  const line = s.page.el.querySelector('.player-subtitle');
  const controls = s.page.el.querySelector('.player-controls');
  Object.defineProperty(controls, 'offsetHeight', { configurable: true, value: 260 });
  jest.advanceTimersByTime(10000); // the controls shown at the start fade out
  expect(line.style.transform).toBe('');
  s.page.onAction(Action.DOWN);
  // 188 px from the bottom (260 - 96 of shade above the bar + 24) instead of the 56 of the stylesheet: moved with a transform.
  expect(line.style.transform).toBe('translateY(-132px)');
  expect(line.style.bottom).toBe('');
  jest.advanceTimersByTime(10000);
  expect(line.style.transform).toBe('');
  s.page.destroy();
  jest.useRealTimers();
});

test('an MKV whose player sends no lines: the app reads its text tracks and draws the chosen one', async () => {
  const fs = require('fs');
  const path = require('path');
  if (typeof global.TextDecoder === 'undefined') global.TextDecoder = require('util').TextDecoder;
  const file = fs.readFileSync(path.join(__dirname, '../fixtures/subs.mkv'));
  const fileFetch = async (u, init) => {
    const [from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).slice(1).map(Number);
    const end = Math.min(to, file.length - 1);
    const slice = file.subarray(from, end + 1);
    return { status: 206, headers: { get: () => `bytes ${from}-${end}/${file.length}` }, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) };
  };
  const s = setup({ tracks: [{ index: 2, language: '' }, { index: 3, language: '' }], fetch: async () => null, fileFetch, url: 'http://h/movie/1.mkv' });
  await wait();
  s.start();
  await wait(100);
  let labels = null;
  s.ctx.dialogs.choose.mockImplementation(async ({ options }) => {
    labels = options.map((o) => o.label);
    return options[1].value;
  });
  pressSubtitles(s);
  await wait(400);
  expect(labels).toEqual(['Off', 'Italiano', 'English · forced', 'Download from OpenSubtitles']); // the player's own (silent) tracks are not listed
  s.setTime(1500);
  await wait(500);
  expect(s.page.el.querySelector('.player-subtitle').textContent).toBe('Prima riga');
  expect(s.engine.setSubtitleTrack).toHaveBeenCalledWith(null);
  s.page.destroy();
}, 10000);

test('another app in front: the video stops; back in the app it starts again', async () => {
  const s = setup({ fetch: async () => null });
  await wait();
  s.start();
  await wait(50);
  expect(s.engine.start).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(50);
  expect(s.engine.stop).toHaveBeenCalled();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  await wait(50);
  expect(s.engine.start).toHaveBeenCalledTimes(2);
  s.page.destroy();
  delete document.hidden;
});

test('an MP4 with tx3g tracks: the app reads them and draws the chosen one', async () => {
  const fs = require('fs');
  const path = require('path');
  if (typeof global.TextDecoder === 'undefined') global.TextDecoder = require('util').TextDecoder;
  const file = fs.readFileSync(path.join(__dirname, '../fixtures/subs.mp4'));
  const fileFetch = async (u, init) => {
    const [from, to] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range).slice(1).map(Number);
    const end = Math.min(to, file.length - 1);
    const slice = file.subarray(from, end + 1);
    return { status: 206, headers: { get: () => `bytes ${from}-${end}/${file.length}` }, arrayBuffer: async () => slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.length) };
  };
  const s = setup({ tracks: [{ index: 3, language: '' }], fetch: async () => null, fileFetch });
  await wait();
  s.start();
  await wait(100);
  let labels = null;
  s.ctx.dialogs.choose.mockImplementation(async ({ options }) => {
    labels = options.map((o) => o.label);
    return options[2].value;
  });
  pressSubtitles(s);
  await wait(400);
  expect(labels).toEqual(['Off', 'Italiano', 'English', 'Download from OpenSubtitles']);
  s.setTime(3500);
  await wait(500);
  expect(s.page.el.querySelector('.player-subtitle').textContent).toBe('Hello\nworld, again');
  s.page.destroy();
}, 10000);
