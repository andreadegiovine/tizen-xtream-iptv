// Kept apart from the service because `import.meta` cannot be parsed by Jest.
export function createSearchWorker() {
  return new Worker(new URL('../workers/search.worker.js', import.meta.url));
}
