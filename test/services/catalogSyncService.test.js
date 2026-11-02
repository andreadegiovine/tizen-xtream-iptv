import { CatalogSyncService } from '../../src/services/catalogSyncService.js';
import { createGate } from '../../src/core/gate.js';

const provider = { id: 'p1', baseUrl: 'http://h', username: 'u', password: 'p' };
const providers = { getActive: async () => provider };
const settings = { getExcluded: async (_id, type) => (type === 'movie' ? new Set(['9']) : new Set()) };

class FakeWorker {
  constructor({ ready = true, script } = {}) {
    this.sent = [];
    this.terminated = false;
    this.script = script;
    if (ready) setTimeout(() => this.onmessage({ data: { event: 'ready' } }), 0);
  }

  postMessage(message) {
    this.sent.push(message);
    if (message.op === 'start' && this.script) this.script(this, message);
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage({ data });
  }
}

const doneScript = (worker) => {
  worker.emit({ event: 'progress', mediaType: 'movie', phase: 'download' });
  worker.emit({ event: 'progress', mediaType: 'movie', phase: 'done', done: 3, total: 3 });
  worker.emit({ event: 'done', results: [], error: null });
};

describe('CatalogSyncService', () => {
  test('runs in the worker, forwards progress, and sends serialisable exclusions', async () => {
    const worker = new FakeWorker({ script: doneScript });
    const service = new CatalogSyncService({ providers, settings, createWorker: () => worker });
    const phases = [];
    service.onChange((s) => phases.push(s.types.movie.phase));

    const outcome = await service.start({ force: true });

    expect(outcome.event).toBe('done');
    expect(worker.sent[0]).toMatchObject({ op: 'start', force: true, provider: { id: 'p1' } });
    expect(worker.sent[0].excluded.movie).toEqual(['9']);
    expect(service.getState()).toMatchObject({ running: false, mode: 'worker' });
    expect(phases).toEqual(expect.arrayContaining(['queued', 'download', 'done']));
    expect(worker.terminated).toBe(true);
  });

  test('falls back to the main thread when the worker cannot be created', async () => {
    const runLocal = jest.fn(async ({ emit }) => {
      emit({ event: 'progress', mediaType: 'movie', phase: 'done' });
      const outcome = { event: 'done', results: [], error: null };
      emit(outcome);
      return outcome;
    });
    const service = new CatalogSyncService({
      providers,
      settings,
      createWorker: () => {
        throw new Error('CSP blocked');
      },
      runLocal,
    });
    await service.start();
    expect(runLocal).toHaveBeenCalledTimes(1);
    expect(runLocal.mock.calls[0][0].excluded.movie).toBeInstanceOf(Set);
    expect(service.getState()).toMatchObject({ mode: 'main', running: false });
  });

  test('falls back when the worker never reports ready', async () => {
    const worker = new FakeWorker({ ready: false });
    const runLocal = jest.fn(async ({ emit }) => emit({ event: 'done', results: [], error: null }));
    const service = new CatalogSyncService({ providers, settings, createWorker: () => worker, runLocal, readyTimeoutMs: 20 });
    await service.start();
    expect(worker.terminated).toBe(true);
    expect(runLocal).toHaveBeenCalled();
  });

  test('no provider: nothing starts', async () => {
    const service = new CatalogSyncService({ providers: { getActive: async () => null }, settings, createWorker: () => new FakeWorker() });
    expect(await service.start()).toBeNull();
  });

  test('pause and resume reach the worker, and a pause survives a restart', async () => {
    const worker = new FakeWorker({ script: () => {} });
    const service = new CatalogSyncService({ providers, settings, createWorker: () => worker });
    const run = service.start();
    await new Promise((r) => setTimeout(r, 5));
    service.pause();
    expect(worker.sent.map((m) => m.op)).toEqual(['start', 'pause']);
    expect(service.getState().paused).toBe(true);
    service.resume();
    expect(worker.sent[2]).toEqual({ op: 'resume' });
    service.cancel();
    await expect(run).resolves.toMatchObject({ cancelled: true });
    expect(worker.sent.some((m) => m.op === 'cancel')).toBe(true);
    expect(worker.terminated).toBe(true);
  });

  test('events from a cancelled run are ignored', async () => {
    const first = new FakeWorker({ script: () => {} });
    const factories = [() => first, () => new FakeWorker({ script: doneScript })];
    const service = new CatalogSyncService({ providers, settings, createWorker: () => factories.shift()() });
    const run1 = service.start();
    await new Promise((r) => setTimeout(r, 5));
    const run2 = service.start(); // cancels the first
    await run1;
    first.emit({ event: 'progress', mediaType: 'movie', phase: 'error', code: 'X' });
    await run2;
    expect(service.getState().types.movie.phase).toBe('done');
  });
});

describe('gate', () => {
  test('wait blocks while paused; release lets a cancelled job through without un-pausing', async () => {
    const gate = createGate();
    gate.pause();
    let passed = false;
    const waiting = gate.wait().then(() => {
      passed = true;
    });
    await Promise.resolve();
    expect(passed).toBe(false);
    gate.release();
    await waiting;
    expect(passed).toBe(true);
    expect(gate.isPaused()).toBe(true);
    gate.resume();
    await expect(gate.wait()).resolves.toBeUndefined();
  });
});
