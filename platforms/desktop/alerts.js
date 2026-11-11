/* Scheduled viewing alerts of the desktop app: notifications of the system (Windows, macOS, Linux) through the page's Notification API,
 * which Electron shows as native ones (permission granted by default in Electron; Windows needs the app's AppUserModelID, set in
 * electron/main.js as the installer's shortcut has it). Nothing runs while the app is closed: they come while it is open, minimized or
 * behind other windows; one that comes while the window is in use is skipped (the app's own notice and the channel opening take over).
 * Title: the app's name (required here); a click brings the window to the front and opens the channel (no buttons: a page's
 * notification has them only from a service worker, Electron's own only on macOS). */

/** `env`: { Notification, setTimeout, clearTimeout, doc, show() (brings the window to the front), now() }. */
export function createDesktopAlerts(env) {
  const Notify = env.Notification;
  const timers = new Map();
  let open = () => undefined;
  const inUse = () => env.doc.visibilityState === 'visible' && (typeof env.doc.hasFocus !== 'function' || env.doc.hasFocus());

  function fire(alert) {
    timers.delete(alert.id);
    if (inUse() || Notify.permission !== 'granted') return;
    const note = new Notify(alert.title, { body: alert.body, tag: String(alert.id) });
    note.onclick = () => {
      env.show();
      open(alert.scheduleId, 'watch');
      note.close();
    };
  }

  const disarm = () => {
    timers.forEach((timer) => env.clearTimeout(timer));
    timers.clear();
    return Promise.resolve();
  };

  return {
    whileHidden: false,
    arm(list) {
      disarm();
      // Timers of a background page are slowed down by the browser (up to a minute late): the alert still comes before the start.
      list.forEach((alert) => timers.set(alert.id, env.setTimeout(() => fire(alert), Math.min(2147483647, Math.max(0, alert.time - env.now())))));
      return Promise.resolve();
    },
    disarm,
    onOpen(handler) {
      open = handler;
    },
    async prepare() {
      if (Notify.permission === 'default' && Notify.requestPermission) await Notify.requestPermission();
    },
  };
}
