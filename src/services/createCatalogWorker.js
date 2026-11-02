// Kept apart from the service because `import.meta` cannot be parsed by Jest.
export function createCatalogWorker() {
  return new Worker(new URL('../workers/catalog.worker.js', import.meta.url));
}
