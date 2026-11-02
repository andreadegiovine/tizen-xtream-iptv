// Kept apart because `import.meta` cannot be parsed by Jest.
export function createEpgWorker() {
  return new Worker(new URL('../workers/epg.worker.js', import.meta.url));
}
