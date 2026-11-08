/* global __webpack_public_path__: writable */ /* eslint-disable-line no-unused-vars */
/*
 * First module of the app: when the loader in index.html started a build published online (window.__XI_BASE__), the chunks, the workers
 * and the fonts come from there too. A worker cannot be started from another origin: it is started from a blob that imports the script.
 */
const base = typeof window !== 'undefined' ? window.__XI_BASE__ : '';
if (base) {
  __webpack_public_path__ = base;
  const NativeWorker = window.Worker;
  if (NativeWorker) {
    const remote = (url) => /^https?:/i.test(String(url)) && String(url).indexOf(window.location.origin) !== 0;
    const Patched = function Worker(url, options) {
      if (!remote(url)) return new NativeWorker(url, options);
      const blob = new Blob([`importScripts(${JSON.stringify(String(url))});`], { type: 'text/javascript' });
      return new NativeWorker(URL.createObjectURL(blob), options);
    };
    Patched.prototype = NativeWorker.prototype;
    window.Worker = Patched;
  }
}
