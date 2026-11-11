import { createAndroidAlerts } from '../../../platforms/android/alerts.js';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeCap({ display = 'granted', exact = 'granted' } = {}) {
  const calls = [];
  let listener = null;
  return {
    calls,
    emit: (event) => listener(event),
    nativePromise: (plugin, method, options) => {
      calls.push([plugin, method, options]);
      if (method === 'checkPermissions' || method === 'requestPermissions') return Promise.resolve({ display });
      if (method === 'checkExactNotificationSetting') return Promise.resolve({ exact_alarm: exact });
      return Promise.resolve({});
    },
    addListener: (plugin, name, callback) => {
      calls.push([plugin, 'addListener', name]);
      listener = callback;
    },
  };
}

function memoryStorage() {
  const data = {};
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)) };
}

const alert = { id: 7, time: Date.UTC(2026, 10, 12, 20, 58), title: 'Starting soon: News', body: 'One at 21:00', scheduleId: 'p|one|1' };

test('arm: removes the alerts set last, makes the channel and the buttons, schedules the new ones (no title, extra = the programme)', async () => {
  const cap = fakeCap();
  const storage = memoryStorage();
  const alerts = createAndroidAlerts(cap, { texts: () => ({ channelName: 'Scheduled viewing', cancel: 'Annulla', watch: 'Guarda programma' }), storage });
  await flush(); // permissions read
  await alerts.arm([alert]);
  const scheduled = cap.calls.find((c) => c[1] === 'schedule')[2].notifications[0];
  expect(scheduled).toMatchObject({ id: 7, body: alert.body, channelId: 'schedule', actionTypeId: 'schedule', smallIcon: 'ic_stat_schedule', isExactNotification: true, extra: { scheduleId: 'p|one|1' } });
  expect(scheduled.title).toBeUndefined(); // the system shows the app's name
  expect(scheduled.schedule).toEqual({ at: '2026-11-12T20:58:00.000Z', allowWhileIdle: true });
  expect(cap.calls.find((c) => c[1] === 'registerActionTypes')[2]).toEqual({
    types: [{ id: 'schedule', actions: [{ id: 'cancel', title: 'Annulla' }, { id: 'watch', title: 'Guarda programma' }] }],
  });
  expect(cap.calls.find((c) => c[1] === 'createChannel')[2]).toMatchObject({ id: 'schedule', name: 'Scheduled viewing', importance: 4 });
  const cancels = () => cap.calls.filter((c) => c[1] === 'cancel');
  cap.calls.length = 0;
  await alerts.disarm();
  expect(cancels()).toEqual([['LocalNotifications', 'cancel', { notifications: [{ id: 7 }] }]]);
  expect(cap.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['checkPermissions', 'checkExactNotificationSetting'])); // read again: the app is shown
  cap.calls.length = 0;
  await alerts.disarm();
  expect(cancels()).toEqual([]); // nothing left to remove
});

test('exact alarms not allowed: an inexact alert (the plugin must not open the settings screen while the app hides)', async () => {
  const cap = fakeCap({ exact: 'denied' });
  const alerts = createAndroidAlerts(cap, { storage: memoryStorage() });
  await flush();
  await alerts.arm([alert]);
  expect(cap.calls.find((c) => c[1] === 'schedule')[2].notifications[0].isExactNotification).toBe(false);
});

test('notifications not allowed (Android 13+ denied): nothing is scheduled (the plugin would ask while the app hides)', async () => {
  const cap = fakeCap({ display: 'denied' });
  const alerts = createAndroidAlerts(cap, { storage: memoryStorage() });
  await flush();
  await alerts.arm([alert]);
  expect(cap.calls.some((c) => c[1] === 'schedule')).toBe(false);
});

test('prepare: asks the notification permission, then offers the exact alarms screen when they are not allowed', async () => {
  const cap = fakeCap({ exact: 'denied' });
  const alerts = createAndroidAlerts(cap, { texts: () => ({ exactTitle: 'Alerts on time' }), storage: memoryStorage() });
  const confirm = jest.fn(async () => true);
  await alerts.prepare({ confirm });
  expect(cap.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['requestPermissions', 'checkExactNotificationSetting', 'openExactAlarmSettings']));
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Alerts on time' }));
  const open = cap.calls.find((c) => c[1] === 'openExactAlarmSettings');
  expect(open[0]).toBe('TvHost');
});

test('prepare: exact alarms allowed, or the user says not now: no settings screen', async () => {
  const allowed = fakeCap();
  await createAndroidAlerts(allowed, { storage: memoryStorage() }).prepare({ confirm: async () => true });
  expect(allowed.calls.some((c) => c[1] === 'openExactAlarmSettings')).toBe(false);
  const later = fakeCap({ exact: 'denied' });
  await createAndroidAlerts(later, { storage: memoryStorage() }).prepare({ confirm: async () => false });
  expect(later.calls.some((c) => c[1] === 'openExactAlarmSettings')).toBe(false);
});

test('a tap or "Watch programme" gives the programme to watch, "Cancel" the one to remove', () => {
  const cap = fakeCap();
  const alerts = createAndroidAlerts(cap, { storage: memoryStorage() });
  const opened = [];
  alerts.onOpen((id, action) => opened.push([id, action]));
  const notification = { id: 7, extra: { scheduleId: 'p|one|1' } };
  cap.emit({ actionId: 'tap', notification });
  cap.emit({ actionId: 'watch', notification });
  cap.emit({ actionId: 'cancel', notification });
  cap.emit({ actionId: 'tap', notification: { id: 8 } }); // not one of ours
  expect(opened).toEqual([['p|one|1', 'watch'], ['p|one|1', 'watch'], ['p|one|1', 'cancel']]);
});
