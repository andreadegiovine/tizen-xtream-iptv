import { kvGet, kvSet } from '../db/kv.js';
import { LEAD_MS, scheduleId } from './scheduledViewing.js';

const ASKED_KEY = 'scheduleAlertsAsked';
export const EXIT_DELAY_MS = 300; // the other handlers of the hiding start their saves first
export const EXIT_WAIT_MS = 1500; // at most this long for them

/** The numeric id of an alert (the systems want an integer): a 31-bit hash of the schedule id, never 0. */
export function alertId(id) {
  let hash = 0;
  const text = String(id);
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return (hash & 0x7fffffff) || 1;
}

/**
 * The alerts of the system for the scheduled programmes, at the time the app would open the channel (LEAD_MS before the start): only
 * the programmes still to come. `texts(s)` gives { title, body } of one.
 */
export function alertsFor(list, { now = Date.now(), texts }) {
  return list
    .filter((s) => !s.started && s.start - LEAD_MS > now)
    .map((s) => ({ id: alertId(scheduleId(s)), time: s.start - LEAD_MS, scheduleId: scheduleId(s), ...texts(s) }));
}

/**
 * Scheduled viewing outside the app: the platform's alerts (`alerts` of the adapter, see src/platform/contract.js) say a scheduled
 * programme is about to start while the app is in the background or closed; opening one gives `onOpen(scheduleId, action)`: 'watch'
 * opens its channel, 'cancel' removes the scheduled viewing.
 * - `alerts.whileHidden`: the system shows them (Android, Tizen): they are set while the app is hidden and removed when it is shown again,
 *   where the app's own notice and the channel opening (main.js) take over; otherwise (desktop) they stay set and the adapter skips the
 *   ones that come while the window is in use.
 * - `alerts.startsOnlyWhenClosed`: the system starts a closed app only (Tizen): hidden with an alert set, the app exits (`alerts.exit()`)
 *   once `idle()` resolves (what it was saving, the point reached in a title) or EXIT_WAIT_MS went by, unless it is shown again first.
 * - `prepare()`: the permissions, asked the first time a programme is scheduled (`confirm` asks the user before a settings screen).
 * Without `alerts` (webOS, a browser) everything here does nothing.
 */
export function createScheduleAlerts({ alerts, schedules, db, texts, confirm = async () => false, onOpen = () => undefined, doc = typeof document !== 'undefined' ? document : null, now = Date.now, log = null, idle = () => Promise.resolve(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const warn = (what, err) => log && log.warn(what, err && err.message);
  // Alerts of the system may be left from the last session (the app was closed while hidden): the first sync removes them.
  let armed = Boolean(alerts && alerts.whileHidden);
  let scheduled = []; // the scheduled programmes, kept up to date: hiding the app sets the alerts at once (a TV suspends a hidden app)
  const hidden = () => Boolean(doc && doc.visibilityState === 'hidden');
  const settle = (result) => Promise.resolve(result).catch((err) => warn('Schedule alerts failed', err));

  let exitToken = 0;
  /** Hidden with an alert set on a system that starts closed apps only: the app exits once its saves are done, if still hidden. */
  function exitForAlarm() {
    const token = (exitToken += 1);
    return wait(EXIT_DELAY_MS)
      .then(() => Promise.race([Promise.resolve(idle()).catch(() => undefined), wait(EXIT_WAIT_MS)]))
      .then(() => {
        if (token !== exitToken || !hidden()) return;
        if (log) log.info('Scheduled viewing: the app exits so that the alarm can start it');
        alerts.exit();
      });
  }

  /** Sets or removes the alerts as the state of the app asks, starting at once (no wait before the system calls). */
  function apply() {
    if (!alerts) return Promise.resolve();
    if (alerts.whileHidden && !hidden()) {
      exitToken += 1; // shown again: no exit
      if (!armed) return Promise.resolve();
      armed = false;
      return settle(alerts.disarm());
    }
    const list = alertsFor(scheduled, { now: now(), texts });
    if (!list.length && !armed) return Promise.resolve();
    armed = list.length > 0;
    const set = settle(alerts.arm(list));
    if (list.length && hidden() && alerts.startsOnlyWhenClosed && alerts.exit) return set.then(() => settle(exitForAlarm()));
    return set;
  }
  const refresh = async () => {
    scheduled = await schedules.list();
  };
  const refreshAndApply = () => refresh().then(apply, (err) => warn('Schedule alerts failed', err));

  if (alerts) {
    if (alerts.onOpen) alerts.onOpen((id, action) => onOpen(id, action === 'cancel' ? 'cancel' : 'watch'));
    schedules.onChange(refreshAndApply);
    if (doc) doc.addEventListener('visibilitychange', apply);
  }

  return {
    available: Boolean(alerts),
    /** Reads the scheduled programmes and sets the alerts as they should be now (at start). */
    sync: refreshAndApply,
    /** Before the app closes (a TV app that exits is not "hidden" first): the alerts of a system that shows them are set. */
    beforeExit() {
      if (!alerts || !alerts.whileHidden) return Promise.resolve();
      const list = alertsFor(scheduled, { now: now(), texts });
      armed = list.length > 0;
      return list.length ? settle(alerts.arm(list)) : Promise.resolve();
    },
    /** The permissions the alerts need, asked once: the first time a programme is scheduled. */
    async prepare() {
      if (!alerts || !alerts.prepare) return;
      if (db && (await kvGet(db, ASKED_KEY, false).catch(() => false))) return;
      if (db) await kvSet(db, ASKED_KEY, true).catch(() => undefined);
      await settle(alerts.prepare({ confirm }));
    },
  };
}
