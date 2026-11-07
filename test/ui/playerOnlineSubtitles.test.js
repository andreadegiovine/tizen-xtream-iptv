import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { Action } from '../../src/core/input.js';
import { createNoticeService } from '../../src/ui/components/notice.js';

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function setup({ tracks = [], fetch }) {
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
  const client = { streamUrl: () => 'http://h/movie/1.mp4' };
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

test('nothing is downloaded at the start: the Subtitles press downloads, then lists them and they follow the position', async () => {
  let release;
  const s = setup({ fetch: () => new Promise((resolve) => (release = resolve)) });
  await wait();
  s.start();
  await wait(1900);
  expect(s.ctx.openSubtitles.fetch).not.toHaveBeenCalled();
  s.ctx.dialogs.choose.mockImplementation(async ({ options }) => {
    expect(options.map((o) => o.label)).toEqual(['Off', 'Italiano (OpenSubtitles)']);
    return options[1].value;
  });
  pressSubtitles(s);
  await wait();
  expect(s.ctx.openSubtitles.fetch).toHaveBeenCalledWith({ tmdbId: 603, languages: expect.any(Array) });
  expect(noticeTexts()).toContain('Downloading subtitles');
  expect(s.ctx.dialogs.choose).not.toHaveBeenCalled();
  release({ language: 'it', cues: [{ start: 1000, end: 3000, text: 'Ciao' }] });
  await wait();
  expect(noticeTexts()).not.toContain('Downloading subtitles');
  expect(noticeTexts()).toContain('Subtitles downloaded: Italiano');
  await wait(300);
  expect(s.ctx.dialogs.choose).toHaveBeenCalled();
  s.setTime(1500);
  await wait(300);
  expect(s.page.el.querySelector('.player-subtitle').textContent).toBe('Ciao');
  s.page.onAction(Action.ENTER); // second press: no new download
  await wait();
  expect(s.ctx.openSubtitles.fetch).toHaveBeenCalledTimes(1);
  s.page.destroy();
}, 10000);

test('the file has its own subtitles: the press downloads too, and both are listed', async () => {
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
  expect(s.ctx.openSubtitles.fetch).toHaveBeenCalledTimes(1);
  expect(labels).toHaveLength(3);
  expect(labels[2]).toContain('(OpenSubtitles)');
  s.page.destroy();
}, 10000);
