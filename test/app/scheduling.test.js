import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { openProviderDb } from '../../src/db/providerDb.js';
import { syncType } from '../../src/services/catalogSync.js';
import { dbGetAll } from '../../src/core/idb.js';
import { createScheduledViewing, LEAD_MS } from '../../src/services/scheduledViewing.js';
import { startInAppScheduling } from '../../src/app/scheduling.js';

const M = 60000;

async function setup() {
  const providerDb = await openProviderDb(`sched-app-${Math.random()}`);
  await syncType({ db: providerDb, type: 'live', client: { getCategories: async () => [{ category_id: '1', category_name: 'News' }], getStreams: async () => [{ stream_id: 7, name: 'One', category_id: '1', epg_channel_id: 'one' }] } });
  const [entry] = await dbGetAll(providerDb, 'entries');
  const now = Date.now();
  const schedules = createScheduledViewing({ db: await openAppDb(`sched-app-${Math.random()}`) });
  const pushed = [];
  const notices = [];
  const ctx = { schedules, router: { push: (name, params) => pushed.push([name, params]) }, notices: { info: (text) => notices.push(text) } };
  const active = { get: async () => ({ provider: { id: 'p' }, db: providerDb }) };
  const item = { providerId: 'p', entryKey: entry.key, entryName: 'One', channelId: 'one', title: 'News', start: now + LEAD_MS - 1000, stop: now + 30 * M };
  return { ctx, active, pushed, notices, schedules, item, entry };
}

test('an alert opened: the channel of its programme, once; one of another provider or already started: nothing', async () => {
  const { ctx, active, pushed, schedules, item, entry } = await setup();
  const doc = { visibilityState: 'visible', addEventListener: () => undefined };
  const { openScheduled } = startInAppScheduling({ ctx, active, doc });
  await schedules.add(item);
  const [s] = await schedules.list();
  await openScheduled(s.id);
  expect(pushed).toHaveLength(1);
  expect(pushed[0][0]).toBe('player');
  expect(pushed[0][1]).toMatchObject({ type: 'live', entryKey: entry.key, section: 'live' });
  await openScheduled(s.id); // started already
  expect(pushed).toHaveLength(1);
  await schedules.add({ ...item, providerId: 'other', start: item.start + 60 * M, stop: item.stop + 60 * M });
  const other = (await schedules.list()).find((x) => x.providerId === 'other');
  await openScheduled(other.id);
  expect(pushed).toHaveLength(1);
});
