/**
 * Start-up and background work, one task at a time, by priority (lower number first, in order of arrival inside a priority).
 * A task is `{ name, priority, run }`; adding a task with a name already waiting replaces it (and keeps the better priority).
 * `block()` / `unblock()` hold the queue (a catalog sync running wins over everything); `promote(name)` runs a waiting task next
 * (the search icon was clicked). Tasks never overlap and a failing task does not stop the queue.
 */
export const Priority = { VISIBLE: 0, SIDEBAR: 1, METADATA: 2, TRAKT: 3, SEARCH: 4, EPG: 5 };

export function createBackgroundQueue({ onError = () => {}, onTask = () => {}, now = Date.now } = {}) {
  let waiting = [];
  let running = null;
  let blocks = 0;
  let seq = 0;
  let idleWaiters = [];

  function settle() {
    if (running || waiting.length) return;
    const list = idleWaiters;
    idleWaiters = [];
    list.forEach((resolve) => resolve());
  }

  async function pump() {
    if (running || blocks > 0 || !waiting.length) return settle();
    waiting.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
    const task = waiting.shift();
    running = task;
    const started = now();
    let failure = null;
    try {
      await task.run();
    } catch (err) {
      failure = err;
      onError(task.name, err);
    }
    onTask({ name: task.name, ms: now() - started, error: failure });
    running = null;
    return pump();
  }

  return {
    add({ name, priority, run }) {
      const same = waiting.find((task) => task.name === name);
      if (same) {
        same.run = run;
        same.priority = Math.min(same.priority, priority);
      } else {
        seq += 1;
        waiting.push({ name, priority, run, seq });
      }
      pump();
    },
    /** Runs the waiting task `name` before the others. */
    promote(name) {
      const task = waiting.find((t) => t.name === name);
      if (task) task.priority = -1;
      pump();
    },
    block() {
      blocks += 1;
    },
    unblock() {
      blocks = Math.max(0, blocks - 1);
      pump();
    },
    /** Forgets what is waiting (the provider changed). */
    clear() {
      waiting = [];
      settle();
    },
    pending: () => waiting.map((task) => task.name),
    isRunning: () => (running ? running.name : null),
    idle: () => (running || waiting.length ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve()),
  };
}
