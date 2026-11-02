/**
 * Decides what the Back key does:
 *   dialog open        -> close it
 *   page can go back   -> go back (router)
 *   other top section  -> go to Home
 *   Home / first run   -> ask for confirmation, then exit the app
 */
export function createBackHandler({ dialogs, router, getSection, goHome, requestExit, texts }) {
  return async function onBack() {
    if (dialogs.isOpen()) {
      dialogs.dismiss();
      return 'dialog';
    }
    if (router.back()) return 'router';
    const entry = router.current;
    const firstRun = Boolean(entry && entry.params && entry.params.firstRun);
    if (!firstRun && getSection(entry) !== 'home') {
      goHome();
      return 'home';
    }
    const confirmed = await dialogs.confirm(texts());
    if (confirmed) requestExit();
    return confirmed ? 'exit' : 'stay';
  };
}
