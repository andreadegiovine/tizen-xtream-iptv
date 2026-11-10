import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { createScheduledViewing, LEAD_MS, NOTICE_MS } from '../../src/services/scheduledViewing.js';

const M = 60000;

test('one programme per start time; notice and start of the channel come at their time; cancelling removes it', async () => {
  let now = 1000 * M;
  const schedules = createScheduledViewing({ db: await openAppDb(`sched-${Math.random()}`), now: () => now });
  const news = { providerId: 'p', entryKey: 'live:1', entryName: 'One', channelId: 'one', title: 'News', start: now + 60 * M, stop: now + 90 * M };
  await schedules.add(news);
  await expect(schedules.add({ ...news, entryKey: 'live:2', channelId: 'two', title: 'Match' })).rejects.toMatchObject({ code: 'CONFLICT' });
  await schedules.add({ ...news, start: news.start + 30 * M, stop: news.stop + 30 * M, title: 'Film' });
  expect((await schedules.list('p')).map((s) => s.title)).toEqual(['News', 'Film']);
  expect(await schedules.due()).toEqual({ notice: [], start: [] });
  now = news.start - LEAD_MS - NOTICE_MS;
  expect((await schedules.due()).notice.map((s) => s.title)).toEqual(['News']);
  await schedules.markNoticed(news);
  expect((await schedules.due()).notice).toEqual([]);
  now = news.start - LEAD_MS;
  expect((await schedules.due()).start.map((s) => s.title)).toEqual(['News']);
  await schedules.remove(news);
  expect((await schedules.list()).map((s) => s.title)).toEqual(['Film']);
  now = news.stop + 31 * M; // gone by
  expect(await schedules.list()).toEqual([]);
});

test('a programme stays scheduled while it is on (the channel opens once) and leaves when it ends', async () => {
  let now = 1000 * M;
  const schedules = createScheduledViewing({ db: await openAppDb(`sched-${Math.random()}`), now: () => now });
  const changes = jest.fn();
  schedules.onChange(changes);
  const news = { providerId: 'p', entryKey: 'live:1', entryName: 'One', channelId: 'one', title: 'News', start: now + 60 * M, stop: now + 90 * M };
  await schedules.add(news);
  now = news.start - LEAD_MS;
  expect((await schedules.due()).start.map((s) => s.title)).toEqual(['News']);
  await schedules.markStarted(news);
  expect((await schedules.due()).start).toEqual([]); // not opened twice
  now = news.start + 10 * M;
  expect(await schedules.prune()).toBe(0);
  expect((await schedules.list('p')).map((s) => s.title)).toEqual(['News']); // still in "Scheduled" while on
  changes.mockClear();
  now = news.stop;
  expect(await schedules.prune()).toBe(1);
  expect(changes).toHaveBeenCalledTimes(1); // the "Scheduled" entry and view follow
  expect(await schedules.list()).toEqual([]);
  expect(await schedules.prune()).toBe(0);
});

test('nextAt: when the next notice, start or end is due (the app waits until then), null with nothing scheduled', async () => {
  let now = 1000 * M;
  const schedules = createScheduledViewing({ db: await openAppDb(`sched-${Math.random()}`), now: () => now });
  expect(await schedules.nextAt()).toBeNull();
  const news = { providerId: 'p', entryKey: 'live:1', entryName: 'One', channelId: 'one', title: 'News', start: now + 60 * M, stop: now + 90 * M };
  await schedules.add(news);
  expect(await schedules.nextAt()).toBe(news.start - LEAD_MS - NOTICE_MS);
  now = news.start - LEAD_MS - NOTICE_MS;
  await schedules.markNoticed(news);
  expect(await schedules.nextAt()).toBe(news.start - LEAD_MS);
  now = news.start - LEAD_MS;
  await schedules.markStarted(news);
  expect(await schedules.nextAt()).toBe(news.stop);
  now = news.stop + 1; // ended, not pruned yet: due now
  expect(await schedules.nextAt()).toBe(now);
  await schedules.prune();
  expect(await schedules.nextAt()).toBeNull();
});

test('nextAt: the app opened while a scheduled programme is already on (channel not opened yet): due now', async () => {
  const now = 1000 * M;
  const schedules = createScheduledViewing({ db: await openAppDb(`sched-${Math.random()}`), now: () => now });
  await schedules.add({ providerId: 'p', entryKey: 'live:1', entryName: 'One', channelId: 'one', title: 'News', start: now - 10 * M, stop: now + 20 * M });
  expect(await schedules.nextAt()).toBe(now);
  expect((await schedules.due()).start.map((s) => s.title)).toEqual(['News']);
});
