import { createDesktopAlerts } from '../../../platforms/desktop/alerts.js';

function setup({ visible = 'hidden', focused = false, permission = 'granted' } = {}) {
  const shown = [];
  const timers = [];
  function Notification(title, options) {
    this.title = title;
    this.options = options;
    this.close = jest.fn();
    shown.push(this);
  }
  Notification.permission = permission;
  Notification.requestPermission = jest.fn(async () => 'granted');
  const env = {
    Notification,
    setTimeout: (fn, ms) => timers.push({ fn, ms }) - 1,
    clearTimeout: (id) => {
      if (timers[id]) timers[id].cleared = true;
    },
    doc: { visibilityState: visible, hasFocus: () => focused },
    now: () => 1000,
    show: jest.fn(),
  };
  return { alerts: createDesktopAlerts(env), env, shown, timers, Notification };
}

const alert = { id: 7, time: 61000, title: 'Xtream IPTV', body: '"News" is about to start', scheduleId: 'p|one|1' };
const run = (timers) => timers.filter((t) => !t.cleared).forEach((t) => t.fn());

test('the notification comes at its time while the window is not in use; a click brings the window and opens the channel', () => {
  const { alerts, env, shown, timers } = setup();
  const opened = [];
  alerts.onOpen((id, action) => opened.push([id, action]));
  alerts.arm([alert]);
  expect(timers[0].ms).toBe(60000);
  run(timers);
  expect(shown).toHaveLength(1);
  expect(shown[0].title).toBe('Xtream IPTV');
  expect(shown[0].options.body).toBe('"News" is about to start');
  shown[0].onclick();
  expect(env.show).toHaveBeenCalled();
  expect(opened).toEqual([['p|one|1', 'watch']]);
});

test('none while the window is in use (the app opens the channel itself), none once removed or not allowed', () => {
  const inUse = setup({ visible: 'visible', focused: true });
  inUse.alerts.arm([alert]);
  run(inUse.timers);
  expect(inUse.shown).toHaveLength(0);
  const removed = setup();
  removed.alerts.arm([alert]);
  removed.alerts.disarm();
  run(removed.timers);
  expect(removed.shown).toHaveLength(0);
  const denied = setup({ permission: 'denied' });
  denied.alerts.arm([alert]);
  run(denied.timers);
  expect(denied.shown).toHaveLength(0);
});

test('prepare asks the permission only when it was never asked', async () => {
  const fresh = setup({ permission: 'default' });
  await fresh.alerts.prepare();
  expect(fresh.Notification.requestPermission).toHaveBeenCalled();
  const granted = setup();
  await granted.alerts.prepare();
  expect(granted.Notification.requestPermission).not.toHaveBeenCalled();
});
