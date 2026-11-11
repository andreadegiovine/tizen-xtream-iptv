import { log } from '../core/logger.js';
import { t } from '../i18n/index.js';
import { IS_DEV, APP_VERSION } from '../core/env.js';
import { checkForUpdate, installUpdate, runningVersions } from '../services/updates.js';

/**
 * Checks version.json in the background, once the app is up (the start never waits for the network). A newer build this package can run
 * is downloaded and used from the next start (the loader in index.html picks it), and `askRestart(version)` offers to restart now;
 * a newer version that needs a new package: a notice.
 */
export async function updateInBackground(notices, askRestart) {
  const versions = runningVersions();
  log.info(`App ${versions.bundle || APP_VERSION} (package ${versions.shell || APP_VERSION})`);
  // Only the "_autoupdate" packages (Tizen, webOS) update themselves, each from the online build of the same variant.
  if (IS_DEV || !versions.shell || typeof __AUTOUPDATE__ === 'undefined' || !__AUTOUPDATE__) return;
  let update = null;
  try {
    update = await checkForUpdate({ platform: __UPDATE_CHANNEL__, running: versions.bundle || APP_VERSION, shell: versions.shell, timeoutMs: 20000 });
  } catch (err) {
    log.warn('Update check failed', err && err.message);
    return;
  }
  if (!update) return;
  if (update.needsPackage) {
    log.info(`Version ${update.version} needs a new package`);
    notices.show({ type: 'info', message: t('update.needsPackage', { version: update.version }), permanent: true, key: 'update' });
    return;
  }
  try {
    await installUpdate(update);
    log.info(`Update ${update.version} downloaded: used from the next start`);
  } catch (err) {
    log.warn('Update failed', err && err.message);
    return;
  }
  if (askRestart) await askRestart(update.version);
  else notices.show({ type: 'info', message: t('update.ready', { version: update.version }), key: 'update' });
}

/**
 * The dialog of a downloaded update: "Restart now" reloads the app (the loader starts the new build), "Stay" keeps this one until the next
 * start (with the usual notice). It waits until no other dialog or search is open (one dialog at a time).
 */
export function restartDialog({ dialogs, isBusy, notices }) {
  return async (version) => {
    while (isBusy()) await new Promise((resolve) => setTimeout(resolve, 2000));
    const now = await dialogs.confirm({
      title: t('update.dialogTitle'),
      message: t('update.dialogMessage', { version }),
      confirmLabel: t('update.restartNow'),
      cancelLabel: t('update.stay'),
    });
    if (now) window.location.reload();
    else notices.show({ type: 'info', message: t('update.ready', { version }), key: 'update' });
  };
}

