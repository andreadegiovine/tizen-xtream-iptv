import { createPlayerPage } from '../../src/ui/pages/playerPage.js';
import { createNoticeService } from '../../src/ui/components/notice.js';
import { Action } from '../../src/core/input.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { dbPutMany } from '../../src/core/idb.js';
import { LIVE_ALL } from '../../src/services/catalogQuery.js';

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;

async function setup() {
  const db = await openProviderDb(`player-live-${(counter += 1)}`);
  const row = (entryKey, added) => ({ key: `${entryKey}|${LIVE_ALL}`, entryKey, type: 'live', categoryId: LIVE_ALL, added });
  await dbPutMany(db, 'entries', [
    { key: 'live:i1', type: 'live', name: 'Sky Uno', defaultId: 1, networkKey: 'live:nSky', epgChannelId: 'c1' },
    { key: 'live:i3', type: 'live', name: 'Sky Due', defaultId: 3, networkKey: 'live:nSky' },
    { key: 'live:i2', type: 'live', name: 'Cielo', defaultId: 2 },
  ]);
  await dbPutMany(db, 'groups', [
    { key: 'live:nSky', type: 'live', name: 'Sky', memberKeys: ['live:i1', 'live:i3'] },
    { key: 'live:gRai', type: 'live', name: 'Rai 1', isGroup: true, defaultId: 11, members: [{ id: 11, name: 'Rai 1 HD' }, { id: 12, name: 'Rai 1 SD' }] },
  ]);
  await dbPutMany(db, 'entry_cat', [row('live:nSky', 30), row('live:gRai', 20), row('live:i2', 10)]);
  const engine = { available: () => true, start: jest.fn((url, opts) => (engine.handlers = opts.handlers)), play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), stop: jest.fn(), getTime: () => 0, getDuration: () => 0 };
  const now = Date.now();
  const client = { streamUrl: (type, id) => `http://h/${type}/${id}` };
  const ctx = {
    createEngine: () => engine,
    notices: createNoticeService({ root: document.body }),
    catalog: { pause() {}, resume() {} },
    settings: { get: async () => ({ bufferSeconds: 5, timeFormat: '24h' }) },
    active: { get: async () => ({ provider: { id: 'p' }, client, db }), authenticatedClient: async () => client },
    epg: { maybeSync: async () => null, nowNext: async (id) => (id === 'c1' ? { now: { title: 'News', start: now - 60000, stop: now + 3600000 }, next: null } : { now: null, next: null }) },
    dialogs: { isOpen: () => false, choose: jest.fn() },
    router: { back: jest.fn() },
  };
  const page = createPlayerPage(ctx, { type: 'live', entryKey: 'live:i1', title: 'Sky Uno', playlist: [{ id: 1, ext: '', title: '' }], index: 0, epgChannelId: 'c1' });
  document.body.appendChild(page.el);
  page.mount();
  await wait();
  return { page, ctx, engine };
}

const visible = (page) => Array.from(page.el.querySelectorAll('.player-btn')).filter((b) => b.style.display !== 'none').map((b) => b.getAttribute('aria-label'));
const focusedTip = (page) => (page.el.querySelector('.player-btn.focused') || { getAttribute: () => null }).getAttribute('data-tip');

afterEach(() => {
  document.body.innerHTML = '';
});

test('live: end of the programme after LIVE; network, previous and next before it; next goes over "show all" with networks opened up', async () => {
  const { page, ctx, engine } = await setup();
  expect(page.el.querySelector('.player-time').textContent).toMatch(/^LIVE · ends at \d\d:\d\d$/);
  expect(page.el.querySelector('.player-now').textContent).toBe('News');
  expect(visible(page).slice(0, 4)).toEqual(['Pause', 'Open the network', 'Previous channel', 'Next channel']); // Versions hidden: not a group
  expect(visible(page)).not.toContain('Subtitles'); // the stream has no subtitle tracks
  page.onAction(Action.ENTER); // focus on the controls: play / pause
  expect(focusedTip(page)).toBe('Pause');
  page.onAction(Action.RIGHT); // the network
  page.onAction(Action.RIGHT); // previous channel: the last of "show all" (wraps)
  await wait();
  expect(focusedTip(page)).toBe('Cielo');
  page.onAction(Action.RIGHT); // next channel: the other channel of the network
  await wait();
  expect(focusedTip(page)).toBe('Sky Due');
  page.onAction(Action.ENTER);
  await wait();
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/3');
  expect(page.el.querySelector('.player-title').textContent).toBe('Sky Due');
  expect(page.el.querySelector('.player-time').textContent).toMatch(/^LIVE$/); // no guide for this one
  // The network button lists its channels, titled with its name.
  ctx.dialogs.choose.mockResolvedValueOnce('live:i1');
  page.onAction(Action.LEFT);
  page.onAction(Action.LEFT);
  page.onAction(Action.ENTER);
  await wait();
  expect(ctx.dialogs.choose.mock.calls[0][0]).toMatchObject({ title: 'Sky', options: [{ label: 'Sky Uno', value: 'live:i1' }, { label: 'Sky Due', value: 'live:i3' }], selected: 'live:i3' });
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/1');
  page.destroy();
});

test('live group: "Versions" lists its streams and plays the chosen one', async () => {
  const { page, ctx, engine } = await setup();
  page.onAction(Action.CHANNEL_UP); // CH+ without a category: next channel over "show all" → the network's second channel
  await wait();
  page.onAction(Action.CHANNEL_UP); // → the group
  await wait();
  expect(page.el.querySelector('.player-title').textContent).toBe('Rai 1');
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/11');
  ctx.dialogs.choose.mockResolvedValueOnce(12);
  page.onAction(Action.ENTER); // focus on play / pause, then Versions (the group is in no network)
  page.onAction(Action.RIGHT);
  page.onAction(Action.ENTER);
  await wait();
  expect(ctx.dialogs.choose.mock.calls[0][0]).toMatchObject({ options: [{ label: 'Rai 1 HD', value: 11 }, { label: 'Rai 1 SD', value: 12 }], selected: 11 });
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/12');
  page.destroy();
});

test('live: the arrows do not change channel, they bring the controls with the focus on the first button on the left', async () => {
  const { page, engine } = await setup();
  const starts = engine.start.mock.calls.length;
  page.onAction(Action.DOWN);
  await wait();
  expect(engine.start.mock.calls.length).toBe(starts); // same channel
  expect(page.el.querySelector('.player-btn.focused').getAttribute('aria-label')).toBe('Pause'); // the first one: play / pause
  page.onBack(); // out of the controls
  page.onAction(Action.UP);
  await wait();
  expect(engine.start.mock.calls.length).toBe(starts);
  expect(page.el.querySelector('.player-btn.focused')).not.toBeNull();
  page.onBack();
  page.onAction(Action.CHANNEL_DOWN); // CH- changes channel: the last of "show all" (wraps)
  await wait();
  expect(engine.start.mock.calls[engine.start.mock.calls.length - 1][0]).toBe('http://h/live/2');
  page.destroy();
});

test('live: Subtitles only when the stream carries subtitle tracks; play after a pause goes on from there, "Back to live" goes to now', async () => {
  const { page, engine } = await setup();
  engine.getSubtitleTracks = () => [{ index: 0, language: 'ita' }];
  engine.handlers.onPrepared();
  engine.handlers.onBufferingDone();
  await wait();
  expect(visible(page)).toContain('Subtitles');
  const starts = engine.start.mock.calls.length;
  const plays = engine.play.mock.calls.length;
  expect(visible(page)).not.toContain('Back to live');
  page.onAction(Action.PLAY_PAUSE);
  expect(engine.pause).toHaveBeenCalledTimes(1);
  expect(visible(page).slice(0, 2)).toEqual(['Play', 'Back to live']); // next to play / pause
  page.onAction(Action.PLAY_PAUSE);
  await wait();
  expect(engine.play.mock.calls.length).toBe(plays + 1); // goes on from where it was paused
  expect(engine.start.mock.calls.length).toBe(starts);
  expect(visible(page)).toContain('Back to live'); // still behind live
  page.onAction(Action.ENTER); // the controls, on play / pause
  page.onAction(Action.RIGHT);
  expect(page.el.querySelector('.player-btn.focused').getAttribute('aria-label')).toBe('Back to live');
  page.onAction(Action.ENTER);
  await wait();
  expect(engine.start.mock.calls.length).toBe(starts + 1); // opened again: live
  expect(visible(page)).not.toContain('Back to live');
  expect(page.el.querySelector('.player-btn.focused').getAttribute('aria-label')).toBe('Pause');
  page.destroy();
});

test('audio listed late: looked at again after the start; the language of the app is chosen once, a choice of the user stays', async () => {
  const { page, engine } = await setup();
  let tracks = [];
  engine.getAudioTracks = () => tracks;
  engine.setAudioTrack = jest.fn((index) => { tracks = tracks.map((track) => ({ ...track, current: track.index === index })); });
  engine.handlers.onPrepared();
  engine.handlers.onBufferingDone();
  await wait();
  expect(visible(page)).not.toContain('Audio');
  // The stream lists its audio later (an HLS audio group): seen at the next look; the app speaks English: the English one is chosen.
  tracks = [{ index: 0, language: 'ita', current: true }, { index: 1, language: 'eng', current: false }];
  const realNow = Date.now;
  const start = realNow();
  Date.now = () => start + 6000;
  await wait(700);
  expect(visible(page)).toContain('Audio');
  expect(engine.setAudioTrack).toHaveBeenCalledWith(1);
  // The user goes back to Italian: the next looks leave it.
  engine.setAudioTrack(0);
  Date.now = () => start + 12000;
  await wait(700);
  expect(engine.setAudioTrack).toHaveBeenCalledTimes(2);
  expect(tracks.find((track) => track.current).language).toBe('ita');
  Date.now = realNow;
  page.destroy();
});
