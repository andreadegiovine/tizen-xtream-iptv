import { t } from '../../i18n/index.js';

/** Asks for the PIN until it is right (or the dialog is cancelled). Resolves true / false. */
export async function askPin({ dialogs, parental, title = t('parental.enterPin'), message = '' }) {
  const pin = await dialogs.pin({ title, message, validate: async (value) => ((await parental.verify(value)) ? '' : t('parental.wrong')) });
  return pin !== null;
}

/** Two steps: new PIN, then the same PIN again. Resolves true when it was saved. */
export async function createPin({ dialogs, parental, title = t('parental.newPin') }) {
  for (;;) {
    const first = await dialogs.pin({ title, message: t('parental.newPinHelp') });
    if (first === null) return false;
    const again = await dialogs.pin({
      title: t('parental.confirmPin'),
      validate: async (value) => (value === first ? '' : t('parental.mismatch')),
    });
    if (again === null) return false;
    await parental.setPin(first);
    return true;
  }
}

/** Settings: first set when there is none, otherwise the current PIN is asked before the new one. */
export async function changePin({ dialogs, parental, notices }) {
  if (await parental.hasPin()) {
    if (!(await askPin({ dialogs, parental, title: t('parental.currentPin') }))) return false;
  }
  const saved = await createPin({ dialogs, parental });
  if (saved && notices) notices.success(t('parental.saved'), { key: 'parental' });
  return saved;
}

/**
 * Gate of an adult title: resolves true when the viewer may open it. Without a PIN yet, one is created first
 * (the title opens after that).
 */
export async function unlockAdult({ dialogs, parental, notices }) {
  if (!(await parental.hasPin())) {
    notices.info(t('parental.needPin'), { key: 'parental' });
    return createPin({ dialogs, parental });
  }
  return askPin({ dialogs, parental, title: t('parental.adultTitle'), message: t('parental.adultMessage') });
}
