/**
 * Registry of what the app is doing in the background right now (catalog sync, genre search, guide,
 * TMDB / Trakt refresh): name, start time and a way to stop it. The settings page lists it.
 */
export function createOperations({ now = Date.now } = {}) {
  const running = new Map();
  const handlers = new Set();
  const listeners = new Set();
  const emit = (kind, id) => listeners.forEach((fn) => fn({ kind, id }));
  const notify = () => handlers.forEach((handler) => handler(list()));
  const list = () => Array.from(running.values()).sort((a, b) => a.startedAt - b.startedAt);

  return {
    list,
    /** Lifecycle events: { kind: 'start' | 'end' | 'cancel', id } (an operation waiting its turn starts when it is promoted). */
    onEvent(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    /**
     * Registers an operation; returns `end()`. `queued` lists it as waiting its turn; starting it again
     * (not queued) promotes the waiting entry in place. Any other repeated id keeps the first one.
     */
    start(id, { cancel = null, startedAt = now(), queued = false } = {}) {
      const existing = running.get(id);
      if (existing && !(existing.queued && !queued)) return () => undefined;
      const entry = existing || { id };
      Object.assign(entry, { startedAt, cancel, queued });
      running.set(id, entry);
      notify();
      if (!queued) emit('start', id);
      return () => {
        if (running.get(id) === entry) {
          running.delete(id);
          notify();
          if (!entry.queued) emit('end', id);
        }
      };
    },
    /** Stops an operation at once (when it can be stopped) and removes it from the list. */
    cancel(id) {
      const entry = running.get(id);
      if (!entry) return false;
      running.delete(id);
      try {
        if (entry.cancel) entry.cancel();
      } finally {
        notify();
        if (!entry.queued) emit('cancel', id);
      }
      return true;
    },
  };
}
