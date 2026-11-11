// Kept apart from the service because `import.meta` cannot be parsed by Jest.
export function createTitleInfoWorker() {
  return new Worker(new URL('../workers/titleInfo.worker.js', import.meta.url));
}
