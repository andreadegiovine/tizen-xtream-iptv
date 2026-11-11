/**
 * The pace of a batch of requests to one server (the provider's details, TMDB): as fast as the server takes it. It starts with a few
 * requests at a time and adds one each `growEvery` answers in a row that came back well and quickly; a failure, or an answer much
 * slower than usual (`slowFactor` times the running average), halves how many go at a time and adds a pause before each request,
 * doubled at each new problem (up to `maxDelayMs`) and shortened again as answers come back fine. So a server that answers well is
 * asked at full speed, one that struggles or limits us is asked gently, without a fixed rate or a daily cap.
 *
 * run(fn): runs `fn` when a slot is free (after the pause, if any), records how it went, resolves / rejects as `fn` does.
 */
export function createPacer({ min = 1, max = 8, start = 2, growEvery = 8, slowFactor = 3, maxDelayMs = 15000, firstDelayMs = 500, now = Date.now, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  let limit = Math.max(min, Math.min(max, start));
  let active = 0;
  let streak = 0;
  let delay = 0;
  let average = null; // running average of the answer times (ms)
  const waiting = [];

  const next = () => {
    while (waiting.length && active < limit) {
      active += 1;
      waiting.shift()();
    }
  };
  const slot = () =>
    new Promise((resolve) => {
      waiting.push(resolve);
      next();
    });

  function slowDown() {
    limit = Math.max(min, Math.floor(limit / 2));
    delay = delay ? Math.min(maxDelayMs, delay * 2) : firstDelayMs;
    streak = 0;
  }

  function record(ok, ms) {
    if (!ok) {
      slowDown();
      return;
    }
    const slow = average !== null && ms > average * slowFactor && ms > 1000;
    average = average === null ? ms : average * 0.8 + ms * 0.2;
    if (slow) {
      slowDown();
      return;
    }
    delay = delay > firstDelayMs ? Math.floor(delay / 2) : 0;
    streak += 1;
    if (streak >= growEvery && limit < max) {
      limit += 1;
      streak = 0;
    }
  }

  return {
    async run(fn) {
      await slot();
      try {
        if (delay) await wait(delay);
        const started = now();
        let result;
        try {
          result = await fn();
        } catch (err) {
          record(false, now() - started);
          throw err;
        }
        record(true, now() - started);
        return result;
      } finally {
        active -= 1;
        next();
      }
    },
    /** How many go at a time now, and the pause before each (for the logs and the tests). */
    state: () => ({ limit, delay, active, average }),
  };
}
