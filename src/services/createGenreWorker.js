// Kept apart from the service because `import.meta` cannot be parsed by Jest.
export function createGenreWorker() {
  return new Worker(new URL('../workers/genres.worker.js', import.meta.url));
}
