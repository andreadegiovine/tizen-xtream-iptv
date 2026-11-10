/* Search worker: keeps the search rows of the active provider in memory and answers queries, so loading the index (every title of
 * the catalog) and scanning it never happen on the UI thread. The rows are the same for every type (movies, series, channels,
 * channel groups and networks): the answer carries the flags the UI needs (`group`, `isNetwork`...). */
import { openProviderDb } from '../db/providerDb.js';
import { loadSearchRows, searchRows, mergeCandidates } from '../services/searchIndex.js';
import { derivedVersion, readDerivedList, writeDerivedList } from '../services/derivedStore.js';
import { loadProgrammeRows, searchProgrammeRows } from '../services/programmeSearch.js';

let rows = [];
let db = null;
let loading = 0;
let programmes = null; // { providerId, ready: Promise({ titles, rowOf }) }: the programme titles of the guide (see programmeSearch.js)

/** The programme titles of the provider's guide, read once (again after 'programmes-forget'). */
function programmeData(providerId, now) {
  if (!programmes || programmes.providerId !== providerId) {
    const ready = openProviderDb(providerId).then((pdb) =>
      loadProgrammeRows(pdb, now).finally(() => pdb.close()),
    );
    programmes = { providerId, ready };
    ready.catch(() => {
      if (programmes && programmes.ready === ready) programmes = null;
    });
  }
  return programmes.ready;
}

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
  } else if (message.op === 'programmes-load') {
    try {
      const started = Date.now();
      const data = await programmeData(message.providerId, message.now);
      self.postMessage({ event: 'programmes-ready', token: message.token, count: data.titles.length, ms: Date.now() - started });
    } catch (err) {
      self.postMessage({ event: 'programmes-ready', token: message.token, error: err && err.message });
    }
  } else if (message.op === 'programmes-search') {
    try {
      const data = await programmeData(message.providerId, message.options.now);
      self.postMessage({ event: 'result', id: message.id, rows: searchProgrammeRows(data, message.query, message.options) });
    } catch {
      self.postMessage({ event: 'result', id: message.id, rows: null });
    }
  } else if (message.op === 'programmes-forget') {
    programmes = null;
  } else if (message.op === 'merge') {
    self.postMessage({ event: 'result', id: message.id, rows: mergeCandidates(rows, message.query, message.options || {}) });
  } else if (message.op === 'search') {
    self.postMessage({ event: 'result', id: message.id, rows: searchRows(rows, message.query, message.options || {}) });
  }
};

self.postMessage({ event: 'started' });
