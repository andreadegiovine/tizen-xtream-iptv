import { createPlayerController, cleanSubtitle, formatClock, neighborEpisode, subtitleLabel, nextAspect } from '../../src/services/playerController.js';
import { ASPECT_MODES } from '../../src/services/playerEngines.js';
import { parseAvPlayTracks } from '../../platforms/tizen/avplayEngine.js';

function fakeEngine() {
  const e = {
    handlers: null,
    time: 0,
    duration: 100000,
    calls: [],
    start: (url, o) => { e.calls.push(['start', url]); e.handlers = o.handlers; },
    play: () => e.calls.push(['play']),
    pause: () => e.calls.push(['pause']),
    seekTo: (ms) => { e.calls.push(['seek', ms]); e.time = ms; },
    getTime: () => e.time,
    getDuration: () => e.duration,
    stop: () => e.calls.push(['stop']),
  };
  return e;
}
const make = (extra = {}) => {
  const engine = fakeEngine();
  const ticks = [];
  const timeouts = [];
  const clock = { t: 0 };
  const c = createPlayerController({
    engine,
    poll: (fn) => { ticks.push(fn); return ticks.length; },
    unpoll: () => {},
    schedule: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
    unschedule: (id) => { timeouts[id - 1] = null; },
    now: () => clock.t,
    ...extra,
  });
  return { engine, c, clock, timeouts, tick: () => ticks.forEach((fn) => fn()) };
};

describe('player controller', () => {
  test('load → prepared → playing with resume position', () => {
    const { c, engine } = make();
    c.load('http://x/a.mp4', { startAt: 120 });
    expect(c.getState().status).toBe('loading');
    engine.handlers.onPrepared();
    expect(c.getState().status).toBe('playing');
    expect(engine.calls).toEqual([['stop'], ['start', 'http://x/a.mp4'], ['play'], ['seek', 120000]]);
  });

  test('clock is read on each tick', () => {
    const { c, engine, tick } = make();
    c.load('u');
    engine.handlers.onPrepared();
    engine.time = 42000;
    tick();
    expect(c.getState()).toMatchObject({ position: 42, duration: 100 });
  });

  test('pause/resume and relative seek clamped to the stream', () => {
    const { c, engine, tick } = make();
    c.load('u');
    engine.handlers.onPrepared();
    c.togglePause();
    expect(c.getState().status).toBe('paused');
    c.togglePause();
    expect(c.getState().status).toBe('playing');
    tick();
    c.seekBy(-30);
    expect(c.getState().position).toBe(0);
    c.seekBy(500);
    expect(c.getState().position).toBe(99);
  });

  test('live streams (no duration) ignore seeking', () => {
    const { c, engine, tick } = make();
    engine.duration = 0;
    c.load('u');
    engine.handlers.onPrepared();
    tick();
    c.seekBy(10);
    expect(engine.calls.some((call) => call[0] === 'seek')).toBe(false);
  });

  test('errors and end of stream are reported', () => {
    const { c, engine } = make({ retryDelays: [] });
    const seen = [];
    c.onChange((s) => seen.push(s.status));
    c.load('u');
    engine.handlers.onError('boom');
    expect(c.getState()).toMatchObject({ status: 'error', error: 'boom' });
    c.load('u');
    engine.handlers.onPrepared();
    engine.handlers.onEnded();
    expect(c.getState().status).toBe('ended');
  });
});

describe('playback recovery', () => {
  test('an error reopens the stream after a pause and resumes from where it stopped', () => {
    const { c, engine, tick, timeouts } = make();
    c.load('http://x/a.mp4');
    engine.handlers.onPrepared();
    engine.time = 60000;
    tick();
    engine.handlers.onError('network');
    expect(c.getState()).toMatchObject({ status: 'recovering', attempt: 1, attempts: 4, error: 'network' });
    expect(timeouts[0].ms).toBe(2000);
    timeouts[0].fn();
    expect(c.getState().status).toBe('loading');
    expect(engine.calls.filter((call) => call[0] === 'start')).toHaveLength(2);
    engine.handlers.onPrepared();
    expect(engine.calls.slice(-2)).toEqual([['play'], ['seek', 60000]]);
    expect(c.getState()).toMatchObject({ status: 'playing', error: null });
  });

  test('live streams reconnect from the start of the stream (no seek)', () => {
    const { c, engine, timeouts } = make();
    engine.duration = 0;
    c.load('live');
    engine.handlers.onPrepared();
    engine.handlers.onError('x');
    timeouts[0].fn();
    engine.handlers.onPrepared();
    expect(engine.calls.some((call) => call[0] === 'seek')).toBe(false);
  });

  test('pauses grow, then the error is final; stable playback gives the attempts back', () => {
    const { c, engine, timeouts, clock, tick } = make();
    c.load('u');
    engine.handlers.onError('1');
    timeouts[0].fn();
    engine.handlers.onError('2');
    expect(timeouts.map((t) => t && t.ms)).toEqual([2000, 4000]);
    timeouts[1].fn();
    engine.handlers.onPrepared();
    clock.t += 25000;
    tick();
    expect(c.getState().attempt).toBe(0);
    for (let i = 0; i < 4; i += 1) {
      engine.handlers.onError('again');
      if (timeouts[timeouts.length - 1]) timeouts[timeouts.length - 1].fn();
    }
    engine.handlers.onError('last');
    expect(c.getState()).toMatchObject({ status: 'error', error: 'last' });
  });

  test('stop cancels a pending retry', () => {
    const { c, engine, timeouts } = make();
    c.load('u');
    engine.handlers.onError('x');
    c.stop();
    expect(timeouts[0]).toBeNull();
    expect(c.getState().status).toBe('idle');
  });
});

test('clock format and episode neighbours', () => {
  expect(formatClock(65)).toBe('1:05');
  expect(formatClock(3725)).toBe('1:02:05');
  const list = [{ id: 1 }, { id: 2 }];
  expect(neighborEpisode(list, 0, 1)).toEqual({ episode: { id: 2 }, index: 1 });
  expect(neighborEpisode(list, 1, 1)).toBeNull();
  expect(neighborEpisode(list, 0, -1)).toBeNull();
});

describe('subtitles and aspect helpers', () => {
  test('track labels: known language, unknown code, no language', () => {
    expect(subtitleLabel({ language: 'ita' }, 1, 'Track {n}')).toBe('Italiano');
    expect(subtitleLabel({ language: 'xyz' }, 1, 'Track {n}')).toBe('XYZ');
    expect(subtitleLabel({ language: '' }, 3, 'Track {n}')).toBe('Track 3');
    expect(subtitleLabel({ language: 'und' }, 2, 'Track {n}')).toBe('Track 2');
  });

  test('aspect modes cycle', () => {
    expect(nextAspect(ASPECT_MODES, 'fit')).toBe('fill');
    expect(nextAspect(ASPECT_MODES, 'zoom')).toBe('fit');
  });

  test('AVPlay track info → text tracks only', () => {
    const list = [
      { index: 0, type: 'VIDEO', extra_info: '{}' },
      { index: 2, type: 'TEXT', extra_info: '{"track_lang":"eng"}' },
      { index: 3, type: 'TEXT', extra_info: 'not json' },
    ];
    expect(parseAvPlayTracks(list)).toEqual([{ index: 2, language: 'eng' }, { index: 3, language: '' }]);
    expect(parseAvPlayTracks(undefined)).toEqual([]);
    const audio = [{ type: 'AUDIO', index: 1, extra_info: JSON.stringify({ language: 'ita' }) }, { type: 'AUDIO', index: 6, extra_info: '{}' }, { type: 'TEXT', index: 2, extra_info: '{}' }];
    expect(parseAvPlayTracks(audio, 'AUDIO')).toEqual([{ index: 1, language: 'ita' }, { index: 6, language: '' }]);
  });
});

describe('cleanSubtitle', () => {
  test('AVPlay HTML: entities decoded after the tags are removed', () => {
    expect(cleanSubtitle('<font color="#fff">Tom &amp; Jerry</font><br>&lt;3 &#233;')).toBe('Tom & Jerry\n<3 é');
  });
  test('removes markup and ASS overrides, keeps line breaks', () => {
    expect(cleanSubtitle('<i>Hello</i>\\NWorld')).toBe('Hello\nWorld');
    expect(cleanSubtitle('{\\an8}Top line<br/>Second')).toBe('Top line\nSecond');
    expect(cleanSubtitle(null)).toBe('');
    expect(cleanSubtitle('  Plain &nbsp;text ')).toBe('Plain  text');
  });
});
