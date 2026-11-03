/**
 * Playback state machine on top of an engine (AVPlay on the TV, <video> in a desktop browser).
 * Engine contract: start(url, { bufferSeconds, handlers }), play(), pause(), seekTo(ms), getTime() ms,
 * getDuration() ms, stop(). Handlers: onPrepared, onBuffering(percent), onBufferingDone, onEnded, onError(msg).
 *
 * Recovery: when the engine reports an error the stream is opened again by itself, after a growing pause
 * (`retryDelays`, one attempt each), resuming from where it stopped (on-demand streams). Status "recovering"
 * with `attempt` / `attempts` in the state; once the attempts are used up the status is "error" (manual retry).
 * A run of `stableMs` of playback gives the attempts back.
 */
export const RETRY_DELAYS = [2000, 4000, 8000, 15000];

export function createPlayerController({
  engine,
  poll = (fn, ms) => setInterval(fn, ms),
  unpoll = (id) => clearInterval(id),
  schedule = (fn, ms) => setTimeout(fn, ms),
  unschedule = (id) => clearTimeout(id),
  retryDelays = RETRY_DELAYS,
  stableMs = 20000,
  now = Date.now,
}) {
  const state = { status: 'idle', position: 0, duration: 0, buffering: 0, error: null, attempt: 0, attempts: retryDelays.length };
  let current = null; // { url, options } of the stream being played
  let retryTimer = null;
  let playingSince = null;
  const listeners = new Set();
  let timer = null;
  let startAt = 0;

  const emit = () => listeners.forEach((fn) => fn({ ...state }));
  const set = (patch) => {
    Object.assign(state, patch);
    emit();
  };

  function readClock() {
    if (state.status === 'playing' && state.attempt > 0 && playingSince !== null && now() - playingSince >= stableMs) state.attempt = 0;
    if (state.status !== 'playing' && state.status !== 'paused') return;
    try {
      state.position = Math.max(0, engine.getTime() / 1000);
      state.duration = Math.max(0, engine.getDuration() / 1000);
    } catch {
      /* engine not ready */
    }
    emit();
  }

  const handlers = {
    onPrepared() {
      try {
        engine.play();
        if (startAt > 0) engine.seekTo(startAt * 1000);
        playingSince = now();
        set({ status: 'playing', buffering: 0, error: null });
      } catch (err) {
        set({ status: 'error', error: String((err && err.message) || err) });
      }
    },
    onBuffering: (percent) => set({ buffering: percent }),
    onBufferingDone: () => set({ buffering: 0 }),
    onEnded() {
      readClock();
      set({ status: 'ended' });
    },
    onError: (message) => fail(String(message)),
  };

  function open(url, options) {
    try {
      engine.start(url, { bufferSeconds: options.bufferSeconds, handlers });
    } catch (err) {
      fail(String((err && err.message) || err));
    }
  }

  /** Engine error: try again after a pause (resuming where it stopped), or give up when the attempts are used. */
  function fail(message) {
    if (!current || state.attempt >= retryDelays.length) {
      set({ status: 'error', error: message });
      return;
    }
    const delay = retryDelays[state.attempt];
    const resumeAt = state.duration > 0 && state.position > 0 ? state.position : 0; // live streams just reconnect
    playingSince = null;
    set({ status: 'recovering', error: message, attempt: state.attempt + 1, buffering: 0 });
    try {
      engine.stop();
    } catch {
      /* already gone */
    }
    retryTimer = schedule(() => {
      retryTimer = null;
      if (state.status !== 'recovering' || !current) return;
      startAt = resumeAt;
      state.position = resumeAt;
      state.duration = resumeAt > 0 ? state.duration : 0;
      set({ status: 'loading' });
      open(current.url, current.options);
    }, delay);
  }

  return {
    getState: () => ({ ...state }),
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    load(url, { startAt: from = 0, bufferSeconds = 10, onSubtitle = null } = {}) {
      this.stop();
      startAt = from;
      current = { url, options: { bufferSeconds } };
      handlers.onSubtitle = (text, durationMs) => onSubtitle && onSubtitle(text, durationMs);
      Object.assign(state, { status: 'loading', position: 0, duration: 0, buffering: 0, error: null, attempt: 0 });
      playingSince = null;
      timer = poll(readClock, 500);
      emit();
      open(url, current.options);
    },
    togglePause() {
      if (state.status === 'playing') {
        engine.pause();
        set({ status: 'paused' });
      } else if (state.status === 'paused') {
        engine.play();
        set({ status: 'playing' });
      }
    },
    /** Relative seek, clamped to the stream; no-op while loading and on live streams (no duration). */
    seekBy(seconds) {
      if ((state.status !== 'playing' && state.status !== 'paused') || !(state.duration > 0)) return;
      const target = Math.min(Math.max(0, state.position + seconds), Math.max(0, state.duration - 1));
      try {
        engine.seekTo(target * 1000);
        set({ position: target });
      } catch {
        /* seek not supported for this stream */
      }
    },
    /** Absolute seek (progress bar), clamped to the stream; no-op while loading and on live streams. */
    seekTo(seconds) {
      if ((state.status !== 'playing' && state.status !== 'paused') || !(state.duration > 0)) return;
      const target = Math.min(Math.max(0, seconds), Math.max(0, state.duration - 1));
      try {
        engine.seekTo(target * 1000);
        set({ position: target });
      } catch {
        /* seek not supported for this stream */
      }
    },
    stop() {
      if (timer !== null) unpoll(timer);
      timer = null;
      if (retryTimer !== null) unschedule(retryTimer);
      retryTimer = null;
      current = null;
      try {
        engine.stop();
      } catch {
        /* nothing playing */
      }
      if (state.status !== 'idle') set({ status: 'idle' });
    },
  };
}

export const formatClock = (seconds) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/** Next / previous episode inside a flat, ordered list. */
export function neighborEpisode(list, index, delta) {
  const next = index + delta;
  return next >= 0 && next < list.length ? { episode: list[next], index: next } : null;
}

const LANGUAGE_NAMES = { ita: 'Italiano', eng: 'English', spa: 'Español', fre: 'Français', fra: 'Français', ger: 'Deutsch', deu: 'Deutsch', por: 'Português', rus: 'Русский', ara: 'العربية', tur: 'Türkçe', rum: 'Română', ron: 'Română', alb: 'Shqip', sqi: 'Shqip' };

/** Name shown in the subtitle list; `position` (1-based) names tracks that carry no language. */
export function subtitleLabel(track, position, fallback) {
  const code = String(track.language || '').toLowerCase();
  if (!code || code === 'und') return fallback.replace('{n}', String(position));
  return LANGUAGE_NAMES[code] || code.toUpperCase();
}

/** Next aspect mode in the cycle. */
export const nextAspect = (modes, current) => modes[(modes.indexOf(current) + 1) % modes.length];

/** New scrub position after pressing left/right on the progress bar. */
export const scrubTarget = (position, delta, duration) => Math.min(Math.max(0, position + delta), Math.max(0, duration));

/** Position (seconds) under a pointer on the bar: `x` and `left` in the same coordinate space. */
export function positionFromPointer(x, left, width, duration) {
  if (!(width > 0) || !(duration > 0)) return 0;
  return Math.min(1, Math.max(0, (x - left) / width)) * duration;
}
