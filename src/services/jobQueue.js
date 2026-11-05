/**
 * The work asked from Settings (update a catalog type, TMDB, genres, rebuild the databases): one at a time, in the order asked. A job
 * asked while something else runs (another job, the start-up sync, the background genre search) is listed at once among the operations
 * in progress as "queued" (it can be removed from there) and starts when the way is free. The same job asked twice stays one.
 *
 * `isBusy()`: true while work that must not overlap runs (a catalog sync, a genre / TMDB job, a rebuild).
 */
export function createJobQueue({ operations, isBusy = () => false, pollMs = 1000, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), onError = () => {} }) {
  const jobs = [];
  let running = false;

  async function pump() {
    if (running || !jobs.length) return;
    running = true;
    try {
      while (jobs.length) {
        while (isBusy()) await wait(pollMs);
        const job = jobs.shift();
        if (!job) break;
        job.end(); // its "queued" row goes: the job's own operation shows while it runs
        try {
          await job.run();
        } catch (err) {
          onError(job.key, err);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    /** Queues `run` under `key` (label: the name shown among the operations). False when the same job is already waiting. */
    add(key, label, run) {
      if (jobs.some((job) => job.key === key)) return false;
      const job = { key, run, end: () => undefined };
      job.end = operations.start(`queue:${key}`, {
        queued: true,
        label,
        cancel: () => {
          const i = jobs.indexOf(job);
          if (i >= 0) jobs.splice(i, 1);
        },
      });
      jobs.push(job);
      pump();
      return true;
    },
    pending: () => jobs.map((job) => job.key),
    isRunning: () => running,
  };
}
