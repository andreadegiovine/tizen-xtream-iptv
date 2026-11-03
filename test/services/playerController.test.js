import { createPlayerController, formatClock, neighborEpisode, subtitleLabel, nextAspect } from '../../src/services/playerController.js';
import { parseAvPlayTracks, ASPECT_MODES } from '../../src/services/playerEngines.js';

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
const make = () => {
  const engine = fakeEngine();
  const ticks = [];
  const c = createPlayerController({ engine, poll: (fn) => { ticks.push(fn); return ticks.length; }, unpoll: () => {} });
  return { engine, c, tick: () => ticks.forEach((fn) => fn()) };
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
    const { c, engine } = make();
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
  });
});
