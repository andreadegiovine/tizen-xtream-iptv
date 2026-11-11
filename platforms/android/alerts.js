/* Scheduled viewing alerts on Android TV / Fire TV: notifications of the system through the official Capacitor plugin
 * @capacitor/local-notifications (AlarmManager; it sets them again after a restart of the device). See createScheduleAlerts
 * (src/services/scheduleAlerts.js) for when they are set.
 * - Android 13+: the notification permission is asked the first time a programme is scheduled (`prepare`);
 * - Android 12+: exact alarms need "Alarms & reminders" (SCHEDULE_EXACT_ALARM); without it the plugin sets an inexact one (it may come
 *   late), so `prepare` offers the settings screen, opened by TvHost only when the device has one (some TVs do not);
 * - the channel "schedule" has high importance: a heads-up notification on Fire TV (Amazon: priority high), in its notification centre
 *   otherwise; Android TV shows notifications of other apps very little;
 * - no title (the system shows the app's name), the body says what is about to start, two buttons: "Cancel" (the scheduled viewing is
 *   removed) and "Watch programme"; a tap is "Watch programme". Each opens the app (an action of this plugin is an activity: it is
 *   started if it was closed, the plugin keeps the event until the app listens);
 * - `isExactNotification` only when exact alarms are allowed: with it and without the permission, the plugin itself would open the
 *   "Alarms & reminders" screen while scheduling (with the app being hidden), and crash the app where a TV has no such screen. */
const PLUGIN = 'LocalNotifications';
const CHANNEL = 'schedule';
const ACTIONS = 'schedule'; // the action type with the two buttons

/**
 * `cap`: window.Capacitor (the native bridge); `texts`: { channelName, cancel, watch, exactTitle, exactMessage, exactConfirm, exactCancel }.
 */
export function createAndroidAlerts(cap, { texts = () => ({}), storage = typeof localStorage !== 'undefined' ? localStorage : null } = {}) {
  const call = (method, options = {}) => cap.nativePromise(PLUGIN, method, options);
  // The ids set last (kept across starts): removed before new ones are set. The calls are sent at once, without waiting for each
  // other (the plugin runs them in order): the app is being hidden and may be paused right after.
  const IDS_KEY = 'xi.alertIds';
  const readIds = () => {
    try {
      const ids = JSON.parse((storage && storage.getItem(IDS_KEY)) || '[]');
      return Array.isArray(ids) ? ids : [];
    } catch {
      return [];
    }
  };
  const writeIds = (ids) => {
    try {
      if (storage) storage.setItem(IDS_KEY, JSON.stringify(ids));
    } catch {
      /* not kept: a later start removes nothing it does not know */
    }
  };
  const cancelKnown = () => {
    const ids = readIds();
    writeIds([]);
    return ids.length ? call('cancel', { notifications: ids.map((id) => ({ id })) }) : Promise.resolve();
  };
  let channelMade = false;
  const ensureChannel = () => {
    if (channelMade) return Promise.resolve();
    channelMade = true;
    return call('createChannel', { id: CHANNEL, name: texts().channelName || 'Scheduled viewing', importance: 4, visibility: 1 }).catch(() => {
      channelMade = false; // tried again with the next alerts
    });
  };

  // Whether the notifications (Android 13+ asks) and exact alarms (Android 12+) are allowed, read at start, when the app is shown again
  // and after the permissions were asked: the alerts are set while the app is being hidden, without waiting for these answers.
  let allowed = false;
  let exact = false;
  const readState = () =>
    Promise.all([
      call('checkPermissions').then((state) => {
        allowed = Boolean(state && state.display === 'granted');
      }),
      call('checkExactNotificationSetting').then((state) => {
        exact = Boolean(state && state.exact_alarm === 'granted');
      }),
    ]).catch(() => undefined);
  readState();
  // The buttons, registered with the texts of the current language.
  const registerActions = () => {
    const words = texts();
    return call('registerActionTypes', {
      types: [{ id: ACTIONS, actions: [{ id: 'cancel', title: words.cancel || 'Cancel' }, { id: 'watch', title: words.watch || 'Watch programme' }] }],
    }).catch(() => undefined);
  };

  return {
    whileHidden: true,
    arm(list) {
      const steps = [cancelKnown()];
      if (list.length && allowed) {
        steps.push(ensureChannel());
        steps.push(registerActions());
        steps.push(
          call('schedule', {
            notifications: list.map((a) => ({
              id: a.id,
              body: a.body,
              channelId: CHANNEL,
              actionTypeId: ACTIONS,
              smallIcon: 'ic_stat_schedule',
              autoCancel: true,
              schedule: { at: new Date(a.time).toISOString(), allowWhileIdle: true },
              isExactNotification: exact,
              extra: { scheduleId: a.scheduleId },
            })),
          }),
        );
        writeIds(list.map((a) => a.id));
      }
      return Promise.all(steps);
    },
    disarm() {
      readState(); // the app is shown again: the user may have changed them in the settings
      return cancelKnown();
    },
    onOpen(handler) {
      cap.addListener(PLUGIN, 'localNotificationActionPerformed', (event) => {
        const extra = event && event.notification && event.notification.extra;
        if (extra && extra.scheduleId) handler(extra.scheduleId, event.actionId === 'cancel' ? 'cancel' : 'watch');
      });
    },
    async prepare({ confirm }) {
      ensureChannel();
      await call('requestPermissions').catch(() => null); // Android 13+: the system's dialog; before: granted
      await readState();
      if (!allowed || exact) return; // no notifications (nothing else to ask), or exact alarms already allowed
      const words = texts();
      const open = await confirm({ title: words.exactTitle, message: words.exactMessage, confirmLabel: words.exactConfirm, cancelLabel: words.exactCancel });
      if (open) await cap.nativePromise('TvHost', 'openExactAlarmSettings', {}).catch(() => undefined); // read again when the app is shown
    },
  };
}
