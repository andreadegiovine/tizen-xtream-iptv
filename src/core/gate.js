/** Pausable gate: long jobs `await gate.wait()` between steps; pause() makes them wait, resume() releases them. */
export function createGate() {
  let paused = false;
  let waiters = [];
  return {
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      const release = waiters;
      waiters = [];
      release.forEach((fn) => fn());
    },
    /** Lets current waiters continue without un-pausing (used to let a cancelled job end). */
    release() {
      const release = waiters;
      waiters = [];
      release.forEach((fn) => fn());
    },
    wait() {
      return paused ? new Promise((resolve) => waiters.push(resolve)) : Promise.resolve();
    },
    isPaused: () => paused,
  };
}
