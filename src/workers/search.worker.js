/* Search worker: keeps the search rows of the active provider in memory and answers queries, so loading the index (every title of
 * the catalog) and scanning it never happen on the UI thread. The rows are the same for every type (movies, series, channels,
 * channel groups and networks): the answer carries the flags the UI needs (`group`, `isNetwork`...). */
import { openProviderDb } from '../db/providerDb.js';
import { loadSearchRows, searchRows } from '../services/searchIndex.js';
import { derivedVersion, readDerivedList, writeDerivedList } from '../services/derivedStore.js';

let rows = [];
let db = null;
let loading = 0;

self.onmessage = async function (event) {
  const message = event.data || {};
  if (message.op === 'load') {
    const mine = (loading += 1);
    try {
      if (db) db.close();
      db = await openProviderDb(message.providerId);
      const version = await derivedVersion(db); // read before working out: a sync during the build leaves the saved rows invalid
      const name = `search:${message.types.join(',')}`;
      const started = Date.now();
      let cached = true;
      let next = await readDerivedList(db, name, version).catch(() => null);
      if (!next) {
        cached = false;
        next = await loadSearchRows(db, message.types);
        await writeDerivedList(db, name, next, version).catch(() => undefined);
      }
      if (mine === loading) rows = next;
      self.postMessage({ event: 'ready', token: message.token, count: next.length, cached, ms: Date.now() - started });
    } catch (err) {
      self.postMessage({ event: 'error', token: message.token, message: err && err.message });
    }
  } else if (message.op === 'search') {
    self.postMessage({ event: 'result', id: message.id, rows: searchRows(rows, message.query, message.options || {}) });
  }
};

self.postMessage({ event: 'started' });
