/**
 * Registry of what the app is doing in the background right now (catalog sync, genre search, guide,
 * TMDB / Trakt refresh): name, start time and a way to stop it. The settings page lists it.
 */
export function createOperations({ now = Date.now } = {}) {
  const running = new Map();
  const handlers = new Set();
  const notify = () => handlers.forEach((handler) => handler(list()));
  const list = () => Array.from(running.values()).sort((a, b) => a.startedAt - b.startedAt);

  return {
    list,
    onChange(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    /** Registers an operation; returns `end()`. The same id twice keeps the first one. */
    start(id, { cancel = null, startedAt = now() } = {}) {
      if (running.has(id)) return () => undefined;
      const entry = { id, startedAt, cancel };
      running.set(id, entry);
      notify();
      return () => {
        if (running.get(id) === entry) {
          running.delete(id);
          notify();
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
      }
      return true;
    },
  };
}
