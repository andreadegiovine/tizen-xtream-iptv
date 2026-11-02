/* Minimal worker used only by the diagnostics page (milestone 0).
 *  - a number is answered with number + 1 (does a file worker run at all?)
 *  - {op: 'idb'} checks that IndexedDB is usable from inside a worker (the catalog worker needs it). */
self.onmessage = function (event) {
  var data = event.data;
  if (data && data.op === 'idb') {
    try {
      var open = indexedDB.open('xtream-iptv-diagnostics-worker', 1);
      open.onupgradeneeded = function () {
        open.result.createObjectStore('t', { keyPath: 'k' });
      };
      open.onerror = function () {
        self.postMessage({ ok: false, detail: String(open.error) });
      };
      open.onsuccess = function () {
        var db = open.result;
        var tx = db.transaction('t', 'readwrite');
        tx.objectStore('t').put({ k: 'a', v: 7 });
        tx.oncomplete = function () {
          var get = db.transaction('t').objectStore('t').get('a');
          get.onsuccess = function () {
            var ok = !!get.result && get.result.v === 7;
            db.close();
            indexedDB.deleteDatabase('xtream-iptv-diagnostics-worker');
            self.postMessage({ ok: ok, detail: ok ? 'read/write works in worker' : 'read-back failed' });
          };
        };
        tx.onerror = function () {
          self.postMessage({ ok: false, detail: String(tx.error) });
        };
      };
    } catch (err) {
      self.postMessage({ ok: false, detail: String(err && err.message) });
    }
    return;
  }
  self.postMessage(data + 1);
};
