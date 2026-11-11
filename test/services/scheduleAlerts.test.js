import 'fake-indexeddb/auto';
import { openAppDb } from '../../src/db/appDb.js';
import { createScheduledViewing, LEAD_MS, scheduleId } from '../../src/services/scheduledViewing.js';
import { createScheduleAlerts, alertsFor, alertId } from '../../src/services/scheduleAlerts.js';

const M = 60000;
const flush = () => new Promise((resolve) => setTimeout(resolve, 20));
const texts = (s) => ({ title: `Soon: ${s.title}`, body: s.entryName });

function fakeDoc(state = 'visible') {
  const listeners = [];
  return {
    visibilityState: state,
    addEventListener: (name, fn) => name === 'visibilitychange' && listeners.push(fn),
    set(next) {
      this.visibilityState = next;
      listeners.forEach((fn) => fn());
    },
  };
}

function fakeAlerts(whileHidden) {
  const calls = [];
  let open = null;
  return {
    calls,
    open: (id, action) => open(id, action),
    whileHidden,
    arm: jest.fn(async (list) => calls.push(['arm', list.map((a) => a.scheduleId)])),
    disarm: jest.fn(async () => calls.push(['disarm'])),
    onOpen: (fn) => {
      open = fn;
    },
    prepare: jest.fn(async () => undefined),
  };
}

async function setup({ whileHidden = true, state = 'visible' } = {}) {
  let now = 1000 * M;
  const db = await openAppDb(`alerts-${Math.random()}`);
  const schedules = createScheduledViewing({ db, now: () => now });
  const alerts = fakeAlerts(whileHidden);
  const doc = fakeDoc(state);
  const opened = [];
  const service = createScheduleAlerts({ alerts, schedules, db, texts, doc, now: () => now, onOpen: (id, action) => opened.push([id, action]) });
  const news = { providerId: 'p', entryKey: 'live:1', entryName: 'One', channelId: 'one', title: 'News', start: now + 60 * M, stop: now + 90 * M };
  return { service, schedules, alerts, doc, opened, news, db, setNow: (t) => (now = t) };
}

test('alertsFor: the programmes still to come, at the time the channel would open', () => {
  const now = 1000 * M;
  const s = { providerId: 'p', channelId: 'one', title: 'News', entryName: 'One', start: now + 60 * M, stop: now + 90 * M };
  const list = alertsFor([s, { ...s, start: now + LEAD_MS - 1, channelId: 'two' }, { ...s, started: true, channelId: 'three' }], { now, texts });
  expect(list).toEqual([{ id: alertId(scheduleId(s)), time: s.start - LEAD_MS, scheduleId: scheduleId(s), title: 'Soon: News', body: 'One' }]);
  expect(alertId('x')).toBeGreaterThan(0);
  expect(alertId('x')).toBeLessThanOrEqual(0x7fffffff);
});

test('a system that shows them (TV, Android): set while the app is hidden, removed when it is shown again', async () => {
  const { service, schedules, alerts, doc, news } = await setup();
  await service.sync();
  expect(alerts.calls).toEqual([['disarm']]); // left from the last session: removed while the app is in use
  await schedules.add(news);
  await flush();
  expect(alerts.calls).toEqual([['disarm']]); // visible: the app does it itself
  doc.set('hidden');
  await flush();
  expect(alerts.calls[1]).toEqual(['arm', [scheduleId(news)]]);
  doc.set('visible');
  await flush();
  expect(alerts.calls[2]).toEqual(['disarm']);
});

test('a programme scheduled or removed while hidden changes the alerts; exit sets them', async () => {
  const { service, schedules, alerts, doc, news } = await setup({ state: 'hidden' });
  await service.sync();
  expect(alerts.calls).toEqual([['arm', []]]); // the ones of the last session replaced by none
  await schedules.add(news);
  await flush();
  expect(alerts.calls[1]).toEqual(['arm', [scheduleId(news)]]);
  await schedules.remove(news);
  await flush();
  expect(alerts.calls[2]).toEqual(['arm', []]);
  doc.set('visible');
  await flush();
  await schedules.add(news);
  await flush();
  const before = alerts.calls.length;
  await service.beforeExit();
  expect(alerts.calls[before]).toEqual(['arm', [scheduleId(news)]]);
});

test('desktop (not only while hidden): always set; opening one goes to onOpen', async () => {
  const { service, schedules, alerts, opened, news } = await setup({ whileHidden: false });
  await service.sync();
  expect(alerts.calls).toEqual([]); // nothing scheduled, nothing set
  await schedules.add(news);
  await flush();
  expect(alerts.calls).toEqual([['arm', [scheduleId(news)]]]);
  alerts.open(scheduleId(news));
  alerts.open(scheduleId(news), 'cancel');
  expect(opened).toEqual([[scheduleId(news), 'watch'], [scheduleId(news), 'cancel']]);
  await service.beforeExit(); // nothing to do: the desktop app shows nothing once closed
  expect(alerts.calls).toHaveLength(1);
});

test('the permissions are asked once, the first time', async () => {
  const { service, alerts } = await setup();
  await service.prepare();
  await service.prepare();
  expect(alerts.prepare).toHaveBeenCalledTimes(1);
});

test('without alerts (webOS, a browser) nothing happens', async () => {
  let now = 1000 * M;
  const db = await openAppDb(`alerts-${Math.random()}`);
  const schedules = createScheduledViewing({ db, now: () => now });
  const service = createScheduleAlerts({ alerts: null, schedules, db, texts, doc: fakeDoc('hidden') });
  expect(service.available).toBe(false);
  await expect(service.sync()).resolves.toBeUndefined();
  await expect(service.prepare()).resolves.toBeUndefined();
  await expect(service.beforeExit()).resolves.toBeUndefined();
});
