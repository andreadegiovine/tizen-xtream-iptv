import { dbPutMany, dbGetAllKeys, dbDeleteMany, dbGet, dbPut, dbClear, dbDelete } from '../core/idb.js';
import { openProviderDb } from '../db/providerDb.js';
import { createXmltvParser } from './xmltv.js';
import { createChannelSummary, EPG_CHANNELS_KEY } from './epgChannels.js';
import { wrapApiUrl } from '../core/env.js';
import { toAppError, AppError, ErrorCode } from '../core/errors.js';

export const EPG_BATCH = 2000;
export const EPG_TTL_MS = 24 * 3600 * 1000;
const META_KEY = 'epg';

export const xmltvUrl = (provider) =>
  `${provider.baseUrl}/xmltv.php?username=${encodeURIComponent(provider.username)}&password=${encodeURIComponent(provider.password)}`;

/** Channel ids used by the live entries: only their programmes are worth storing. */
export function liveChannelIds(db) {
  // A cursor reads one channel at a time: the whole list of live entries is never held in memory just to pick one field.
  return new Promise((resolve, reject) => {
    const ids = new Set();
    const tx = db.transaction('entries', 'readonly');
    const request = tx.objectStore('entries').index('byTypeAdded').openCursor(IDBKeyRange.bound(['live', 0], ['live', Number.MAX_SAFE_INTEGER]));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.epgChannelId) ids.add(cursor.value.epgChannelId);
      cursor.continue();
    };
    tx.oncomplete = () => resolve(ids);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export const shouldSyncEpg = (meta, now = Date.now()) => !meta || now - meta.lastSync >= EPG_TTL_MS;

/** Deletes the downloaded guide (programmes, channel summary, last download): the next start downloads it again. */
export async function clearEpg(db) {
  await dbClear(db, 'epg');
  await dbDelete(db, 'meta', EPG_CHANNELS_KEY);
  await dbDelete(db, 'meta', META_KEY);
}

export async function getEpgMeta(db) {
  return dbGet(db, 'meta', META_KEY);
}

/** Streams the guide through the parser (chunk by chunk when the browser can, whole text otherwise). */
export async function readGuide(url, onText, { signal, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) throw new AppError(ErrorCode.HTTP, `HTTP ${res.status}`, { details: { status: res.status } });
  if (res.body && res.body.getReader && typeof TextDecoder !== 'undefined') {
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onText(decoder.decode(value, { stream: true }));
    }
    onText(decoder.decode());
  } else {
    onText(await res.text());
  }
}

/** Downloads the XMLTV guide and replaces the stored programmes. Old programmes are deleted afterwards. */
export async function syncEpg({ db, url, now = Date.now(), signal, emit = () => {}, fetchImpl, channels }) {
  const wanted = channels || (await liveChannelIds(db));
  if (wanted.size === 0) {
    emit({ event: 'progress', phase: 'skipped' });
    return { programmes: 0, skipped: true };
  }
  // Programmes are written as they are read, EPG_BATCH at a time: a big guide never sits in memory as one array.
  let buffer = [];
  let written = 0;
  let writes = Promise.resolve();
  const flush = () => {
    const batch = buffer;
    buffer = [];
    written += batch.length;
    writes = writes.then(() => dbPutMany(db, 'epg', batch));
    writes.catch(() => undefined); // a failed write is thrown where `writes` is awaited, not as an unhandled rejection meanwhile
  };
  const summary = createChannelSummary(); // span and genres of every channel, for the guide page and the Live TV sidebar
  const parser = createXmltvParser({
    now,
    channels: wanted,
    onProgramme: (p) => {
      summary.add(p);
      buffer.push(p);
      if (buffer.length >= EPG_BATCH) flush();
    },
  });
  emit({ event: 'progress', phase: 'download' });
  const t0 = Date.now();
  await readGuide(url, (text) => parser.push(text), { signal, fetchImpl });
  if (written + buffer.length === 0 && parser.stats().total === 0) throw new AppError(ErrorCode.BAD_RESPONSE, 'Guide is empty');
  emit({ event: 'progress', phase: 'write', done: 0, total: written + buffer.length });
  if (buffer.length) flush();
  await writes;
  const total = written;
  const stale = await dbGetAllKeys(db, 'epg', { index: 'byStop', range: IDBKeyRange.upperBound(now) });
  await dbDeleteMany(db, 'epg', stale);
  const perChannel = summary.result();
  await dbPut(db, 'meta', perChannel);
  const meta = {
    key: META_KEY,
    lastSync: now,
    programmes: total,
    channels: wanted.size,
    guided: Object.keys(perChannel.channels).length,
    genres: Object.keys(perChannel.genres).length,
    until: perChannel.until,
    totalInFile: parser.stats().total,
    durationMs: Date.now() - t0,
  };
  await dbPut(db, 'meta', meta);
  return meta;
}

/** Reads the start of a guide address and says whether it looks like an XMLTV file. Resolves true / false, never throws. */
export async function probeGuide(url, { fetchImpl = fetch, signal } = {}) {
  try {
    const res = await fetchImpl(wrapApiUrl(url), { signal });
    if (!res.ok) return false;
    let head = '';
    if (res.body && res.body.getReader && typeof TextDecoder !== 'undefined') {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      while (head.length < 4096) {
        const { done, value } = await reader.read();
        if (done) break;
        head += decoder.decode(value, { stream: true });
      }
      reader.cancel().catch(() => undefined);
    } else {
      head = (await res.text()).slice(0, 4096);
    }
    return /<tv[\s>]/i.test(head);
  } catch {
    return false;
  }
}

export async function runEpgForProvider({ provider, customUrl = '', force = false, signal, emit = () => {}, openDb = openProviderDb, fetchImpl, now = Date.now() }) {
  let db = null;
  let failure = null;
  let meta = null;
  try {
    db = await openDb(provider.id);
    if (!force && !shouldSyncEpg(await getEpgMeta(db), now)) {
      emit({ event: 'progress', phase: 'skipped' });
    } else {
      // The custom guide replaces the provider's; when it cannot be read, the provider's is used.
      if (customUrl) {
        try {
          meta = await syncEpg({ db, url: wrapApiUrl(customUrl), now, signal, emit, fetchImpl });
        } catch (err) {
          if (signal && signal.aborted) throw err;
        }
      }
      if (!meta) meta = await syncEpg({ db, url: wrapApiUrl(xmltvUrl(provider)), now, signal, emit, fetchImpl });
    }
  } catch (err) {
    const error = toAppError(err);
    failure = { code: error.code, message: error.message };
  } finally {
    if (db) db.close();
  }
  const outcome = { event: 'done', meta, error: failure };
  emit(outcome);
  return outcome;
}
