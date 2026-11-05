/**
 * Tells when the device goes offline or comes back: `onChange(online)` fires at every change (and once at the start when the
 * device is already offline). Returns a function that stops watching.
 */
export function watchConnectivity({ win = window, onChange }) {
  const isOnline = () => !win.navigator || win.navigator.onLine !== false;
  const up = () => onChange(true);
  const down = () => onChange(false);
  win.addEventListener('online', up);
  win.addEventListener('offline', down);
  if (!isOnline()) onChange(false);
  return () => {
    win.removeEventListener('online', up);
    win.removeEventListener('offline', down);
  };
}
