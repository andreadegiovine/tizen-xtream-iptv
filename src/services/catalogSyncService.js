import { EventBus } from '../core/eventBus.js';
import { createGate } from '../core/gate.js';
import { log } from '../core/logger.js';
import { openProviderDb } from '../db/providerDb.js';
import { MediaType } from './mediaType.js';
import { SYNC_ORDER, runSyncForProvider, getSyncStatus } from './catalogSync.js';

const emptyState = () => ({
  running: false,
  startedAt: 0,
  paused: false,
  mode: null, // 'worker' | 'main'
  providerId: null,
  error: null,
  types: Object.fromEntries(SYNC_ORDER.map((type) => [type, { phase: 'idle' }])),
});

/**
 * Main-thread side of the catalog sync. It prefers a Web Worker; when the worker cannot be created or
 * does not report ready in time (e.g. blocked by the CSP of a remote page) it runs the very same
 * code on the main thread instead.
 */
export class CatalogSyncService {
  constructor({ providers, settings, createWorker, getCleanTitles = () => true, getGrouping = async () => undefined, runLocal = runSyncForProvider, readyTimeoutMs = 4000 }) {
    this.providers = providers;
    this.settings = settings;
    this.createWorker = createWorker;
    this.getCleanTitles = getCleanTitles;
    this.getGrouping = getGrouping;
    this.runLocal = runLocal;
    this.readyTimeoutMs = readyTimeoutMs;
    this.bus = new EventBus();
    this.gate = createGate();
    this.state = emptyState();
    this.job = null;
    this.worker = null;
    this.controller = null;
    this.cancelWorkerRun = null;
  }

  onChange(handler) {
    return this.bus.on('change', handler);
  }

  getState() {
    return this.state;
  }

  /** Counts and timings saved by previous syncs, read straight from the provider database. */
  async readStatus(providerId) {
    const db = await openProviderDb(providerId);
    try {
      return await getSyncStatus(db);
    } finally {
      db.close();
    }
  }

  /** Starts (or restarts) a sync for the active provider. Resolves with the final `done` event, or null. */
  /** `rewrite`: every row written again, not only what changed (the forced update of one type from Settings). */
  async start({ force = false, types = SYNC_ORDER, rewrite = false } = {}) {
    const provider = await this.providers.getActive();
    if (!provider) return null;
    this.cancel();

    const excluded = {};
    for (const type of Object.values(MediaType)) {
      excluded[type] = Array.from(await this.settings.getExcluded(provider.id, type));
    }
    const job = {};
    this.job = job;
    this.state = { ...emptyState(), running: true, startedAt: Date.now(), paused: this.gate.isPaused(), providerId: provider.id };
    types.forEach((type) => {
      this.state.types[type] = { phase: 'queued' };
    });
    this.notify();

    const payload = {
      provider: { id: provider.id, type: provider.type || 'xtream', baseUrl: provider.baseUrl, username: provider.username, password: provider.password, playlistUrl: provider.playlistUrl || '', epgUrl: provider.epgUrl || '' },
      types,
      excluded,
      cleanTitles: Boolean(await this.getCleanTitles()),
      grouping: await this.getGrouping(provider.id),
      force,
      rewrite,
    };

    let outcome = null;
    try {
      outcome = await this.runInWorker(job, payload);
    } catch (err) {
      log.warn('Catalog worker unavailable, using the main thread:', err.message);
    }
    if (!outcome && this.job === job) outcome = await this.runOnMain(job, payload);
    return outcome;
  }

  runInWorker(job, payload) {
    return new Promise((resolve, reject) => {
      let worker;
      try {
        worker = this.createWorker();
      } catch (err) {
        reject(err);
        return;
      }
      this.worker = worker;
      let ready = false;
      const finish = () => {
        clearTimeout(timer);
        worker.terminate();
        if (this.worker === worker) {
          this.worker = null;
          this.cancelWorkerRun = null;
        }
      };
      // cancel() uses this to end the pending promise of a worker that is being terminated.
      this.cancelWorkerRun = () => {
        finish();
        resolve({ event: 'done', results: [], error: null, cancelled: true });
      };
      const timer = setTimeout(() => {
        if (ready) return;
        finish();
        reject(new Error('worker did not report ready'));
      }, this.readyTimeoutMs);

      worker.onmessage = (event) => {
        const message = event.data || {};
        if (message.event === 'ready') {
          ready = true;
          clearTimeout(timer);
          this.state.mode = 'worker';
          worker.postMessage({ op: 'start', ...payload });
          if (this.gate.isPaused()) worker.postMessage({ op: 'pause' });
          this.notify();
        } else if (message.event === 'done') {
          this.handle(job, message);
          finish();
          resolve(message);
        } else {
          this.handle(job, message);
        }
      };
      worker.onerror = (event) => {
        finish();
        reject(new Error((event && event.message) || 'worker error'));
      };
    });
  }

  async runOnMain(job, payload) {
    this.state.mode = 'main';
    this.controller = new AbortController();
    const excluded = Object.fromEntries(Object.entries(payload.excluded).map(([type, ids]) => [type, new Set(ids)]));
    return this.runLocal({
      provider: payload.provider,
      types: payload.types,
      excluded,
      cleanTitles: payload.cleanTitles,
      grouping: payload.grouping || undefined,
      force: payload.force,
      rewrite: payload.rewrite,
      signal: this.controller.signal,
      emit: (message) => this.handle(job, message),
      gate: this.gate.wait,
    });
  }

  handle(job, message) {
    if (this.job !== job) return; // stale event from a cancelled run
    if (message.event === 'account') {
      if (this.state.providerId && this.providers.update) this.providers.update(this.state.providerId, { expiresAt: message.expiresAt || null }).catch(() => undefined);
      return;
    }
    if (message.event === 'done') {
      this.state.running = false;
      this.state.error = message.error || null;
      this.job = null;
    } else if (message.event === 'progress') {
      if (message.mediaType) {
        this.state.types[message.mediaType] = { ...message };
        const m = message.meta;
        if (message.phase === 'done' && m) log.info(`Catalog ${message.mediaType}: ${m.itemCount} items, ${m.entryCount} entries, ${m.categoryCount} categories, ${m.changes === undefined ? "?" : m.changes} rows changed; fetch ${m.fetchMs} ms, write ${m.writeMs} ms, total ${m.durationMs} ms`);
        else if (message.phase === 'error') log.warn(`Catalog ${message.mediaType} failed: ${message.code || ''} ${message.message || ''}`);
      } else if (message.phase === 'error') this.state.error = { code: message.code, message: message.message };
    }
    this.notify();
  }

  /** Background work must not compete with a playing stream: call pause() when playback starts. */
  pause() {
    this.gate.pause();
    this.state.paused = true;
    if (this.worker) this.worker.postMessage({ op: 'pause' });
    this.notify();
  }

  resume() {
    this.gate.resume();
    this.state.paused = false;
    if (this.worker) this.worker.postMessage({ op: 'resume' });
    this.notify();
  }

  cancel() {
    if (!this.job && !this.worker) return;
    this.job = null;
    if (this.controller) this.controller.abort();
    this.controller = null;
    if (this.worker) {
      this.worker.postMessage({ op: 'cancel' });
      if (this.cancelWorkerRun) this.cancelWorkerRun();
      this.worker = null;
    }
    this.gate.release();
    this.state = { ...this.state, running: false, cancelled: true };
    this.notify();
  }

  notify() {
    this.bus.emit('change', this.state);
  }
}
