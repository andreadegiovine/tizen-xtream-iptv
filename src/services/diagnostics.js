import { openDb, deleteDb, dbPut, dbGet } from '../core/idb.js';
import { XtreamClient } from './xtreamClient.js';
import { platform } from '../platform/index.js';

const ok = (id, detail = '') => ({ id, status: 'ok', detail });
const warn = (id, detail = '') => ({ id, status: 'warn', detail });
const fail = (id, detail = '') => ({ id, status: 'fail', detail });

function checkRuntime() {
  const results = [];
  const match = /Chrom(?:e|ium)\/(\d+)/.exec(navigator.userAgent);
  if (match) results.push(Number(match[1]) >= 76 ? ok('chromium', `Chromium ${match[1]}`) : warn('chromium', `Chromium ${match[1]} (< 76)`));
  else results.push(warn('chromium', navigator.userAgent));
  results.push(...platform.runtimeChecks()); // what the platform has (on Tizen: tizen, webapis, AVPlay)
  results.push(ok('screen', `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`));
  return results;
}

function checkBlobWorker() {
  return new Promise((resolve) => {
    let url;
    try {
      const blob = new Blob(['self.onmessage=function(e){self.postMessage(e.data+1)}'], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
      const worker = new Worker(url);
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(fail('worker', 'no answer within 3 s'));
      }, 3000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        URL.revokeObjectURL(url);
        resolve(event.data === 2 ? ok('worker', 'blob worker runs') : fail('worker', 'unexpected answer'));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        resolve(fail('worker', 'worker error'));
      };
      worker.postMessage(1);
    } catch (err) {
      resolve(fail('worker', err.message));
    }
  });
}

/** Same-origin worker file, emitted by webpack: the alternative when blob workers are blocked by the CSP. */
function checkFileWorker() {
  return new Promise((resolve) => {
    try {
      const worker = new Worker(new URL('../workers/ping.worker.js', import.meta.url));
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(fail('workerFile', 'no answer within 3 s'));
      }, 3000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(event.data === 2 ? ok('workerFile', 'file worker runs') : fail('workerFile', 'unexpected answer'));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(fail('workerFile', 'worker error'));
      };
      worker.postMessage(1);
    } catch (err) {
      resolve(fail('workerFile', err.message));
    }
  });
}

/** The catalog worker writes to IndexedDB itself, so this must work from a worker too. */
function checkWorkerIdb() {
  return new Promise((resolve) => {
    try {
      const worker = new Worker(new URL('../workers/ping.worker.js', import.meta.url));
      const timer = setTimeout(() => {
        worker.terminate();
        resolve(fail('workerIdb', 'no answer within 5 s'));
      }, 5000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        const { ok: success, detail } = event.data || {};
        resolve(success ? ok('workerIdb', detail) : fail('workerIdb', detail || 'failed'));
      };
      worker.onerror = () => {
        clearTimeout(timer);
        worker.terminate();
        resolve(fail('workerIdb', 'worker error'));
      };
      worker.postMessage({ op: 'idb' });
    } catch (err) {
      resolve(fail('workerIdb', err.message));
    }
  });
}

async function checkIndexedDb() {
  const name = 'xtream-iptv-diagnostics';
  try {
    const db = await openDb(name, 1, { upgrade: (d) => d.createObjectStore('t', { keyPath: 'k' }) });
    await dbPut(db, 't', { k: 'a', v: 1 });
    const record = await dbGet(db, 't', 'a');
    db.close();
    await deleteDb(name);
    return record && record.v === 1 ? ok('indexeddb', 'read/write works') : fail('indexeddb', 'read-back failed');
  } catch (err) {
    return fail('indexeddb', err.message);
  }
}

async function checkStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return warn('storage', 'StorageManager not available');
  try {
    const { usage, quota } = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const mb = (n) => `${Math.round((n || 0) / 1048576)} MB`;
    return ok('storage', `used ${mb(usage)} of ${mb(quota)}, persistent: ${persisted}`);
  } catch (err) {
    return warn('storage', err.message);
  }
}

/** Reaches the active provider the same way the app will (CORS / mixed content / certificates). */
async function checkProvider(provider) {
  if (!provider) return warn('provider', 'no provider configured');
  try {
    const client = new XtreamClient(provider);
    const auth = await client.authenticate();
    return ok('provider', `authenticated, status ${auth.user.status}`);
  } catch (err) {
    return fail('provider', `${err.code || 'ERROR'}: ${err.message}`);
  }
}

export async function runDiagnostics({ provider } = {}) {
  const results = checkRuntime();
  results.push(await checkBlobWorker());
  results.push(await checkFileWorker());
  results.push(await checkWorkerIdb());
  results.push(await checkIndexedDb());
  results.push(await checkStorage());
  results.push(await checkProvider(provider));
  return results;
}
