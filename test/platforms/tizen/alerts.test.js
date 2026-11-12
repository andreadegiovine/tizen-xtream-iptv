import { createTizenAlerts, SCHEDULE_OPERATION } from '../../../platforms/tizen/alerts.js';

function fakeTizen(requested = null) {
  const alarms = [];
  const tizen = {
    alarms,
    requested,
    alarm: {
      add: jest.fn((alarm, appId, control) => alarms.push({ alarm, appId, control })),
      removeAll: jest.fn(() => alarms.splice(0)),
    },
    AlarmAbsolute: function AlarmAbsolute(date) {
      this.date = date;
    },
    ApplicationControl: function ApplicationControl(operation, uri, mime, category, data) {
      Object.assign(this, { operation, data });
    },
    ApplicationControlData: function ApplicationControlData(key, value) {
      Object.assign(this, { key, value });
    },
    application: {
      getCurrentApplication: () => ({ exit: tizen.exit, appInfo: { id: 'XtrmIptv01.XtreamIPTV' }, getRequestedAppControl: () => (tizen.requested ? { appControl: tizen.requested } : null) }),
    },
  };
  return tizen;
}

function fakeWindow() {
  const listeners = {};
  return { addEventListener: (name, fn) => (listeners[name] = fn), fire: (name) => listeners[name]() };
}

const alert = { id: 7, time: Date.UTC(2026, 10, 12, 20, 58), title: 'x', body: 'y', scheduleId: 'p|one|1' };

test('arm: one alarm per programme that starts this app with the programme; disarm removes them', async () => {
  const tizen = fakeTizen();
  const alerts = createTizenAlerts(tizen, fakeWindow());
  await alerts.arm([alert]);
  expect(tizen.alarms).toHaveLength(1);
  const [{ alarm, appId, control }] = tizen.alarms;
  expect(alarm.date.getTime()).toBe(alert.time);
  expect(appId).toBe('XtrmIptv01.XtreamIPTV');
  expect(control.operation).toBe(SCHEDULE_OPERATION);
  expect(control.data[0]).toMatchObject({ key: 'scheduleId', value: ['p|one|1'] });
  await alerts.arm([]);
  expect(tizen.alarms).toHaveLength(0);
  await alerts.arm([alert]);
  await alerts.disarm();
  expect(tizen.alarms).toHaveLength(0);
});

test('started by an alarm: the programme at once; brought to the front by one: from the appcontrol event', () => {
  const control = (id) => ({ operation: SCHEDULE_OPERATION, data: [{ key: 'scheduleId', value: [id] }] });
  const tizen = fakeTizen(control('p|one|1'));
  const win = fakeWindow();
  const opened = [];
  createTizenAlerts(tizen, win).onOpen((id, action) => opened.push(`${id}:${action}`));
  expect(opened).toEqual(['p|one|1:watch']);
  tizen.requested = control('p|two|2');
  win.fire('appcontrol');
  tizen.requested = { operation: 'http://tizen.org/appcontrol/operation/default', data: [] }; // a normal start
  win.fire('appcontrol');
  expect(opened).toEqual(['p|one|1:watch', 'p|two|2:watch']);
});

test('an alarm starts only a closed app: the adapter says so and can exit the app', () => {
  const tizen = fakeTizen();
  tizen.exit = jest.fn();
  const alerts = createTizenAlerts(tizen, { addEventListener: () => undefined });
  expect(alerts.startsOnlyWhenClosed).toBe(true);
  alerts.exit();
  expect(tizen.exit).toHaveBeenCalledTimes(1);
});
