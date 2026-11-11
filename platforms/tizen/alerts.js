/* Scheduled viewing on Samsung TVs: the Alarm API (mandatory on Tizen TV, public privilege http://tizen.org/privilege/alarm in config.xml)
 * starts the app at the time the channel would open, with an application control carrying the programme. A TV has no notifications for
 * apps: the app comes to the front and opens the channel (src/services/scheduleAlerts.js sets the alarms only while the app is hidden or
 * when it exits; a TV in standby does not wake up for them).
 * - the app was closed: it starts, and reads the control with getRequestedAppControl();
 * - the app was hidden (another app, the TV's home): the control comes as an `appcontrol` event, without reloading the page (config.xml:
 *   the operation below with reload="disable"). */
export const SCHEDULE_OPERATION = 'http://xtream-iptv.local/appcontrol/operation/schedule';
const DATA_KEY = 'scheduleId';

/** `tizen`: window.tizen; `win`: window (for the `appcontrol` event). */
export function createTizenAlerts(tizen, win) {
  const appId = () => tizen.application.getCurrentApplication().appInfo.id;
  // The programme of the control the app was started / brought to the front with, or null.
  const requested = () => {
    try {
      const req = tizen.application.getCurrentApplication().getRequestedAppControl();
      const control = req && req.appControl;
      if (!control || control.operation !== SCHEDULE_OPERATION) return null;
      const item = (control.data || []).find((d) => d.key === DATA_KEY);
      return item && item.value && item.value[0] ? item.value[0] : null;
    } catch {
      return null;
    }
  };

  return {
    whileHidden: true,
    arm(list) {
      tizen.alarm.removeAll(); // the app's alarms are only these
      list.forEach((alert) => {
        const control = new tizen.ApplicationControl(SCHEDULE_OPERATION, null, null, null, [new tizen.ApplicationControlData(DATA_KEY, [alert.scheduleId])]);
        tizen.alarm.add(new tizen.AlarmAbsolute(new Date(alert.time)), appId(), control);
      });
      return Promise.resolve();
    },
    disarm() {
      tizen.alarm.removeAll();
      return Promise.resolve();
    },
    onOpen(handler) {
      const id = requested();
      if (id) handler(id, 'watch');
      win.addEventListener('appcontrol', () => {
        const next = requested();
        if (next) handler(next, 'watch');
      });
    },
  };
}
