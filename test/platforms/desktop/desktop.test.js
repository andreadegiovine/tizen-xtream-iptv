import desktop, { DESKTOP_KEY_CODES, electronVersion } from '../../../platforms/desktop/platform.js';
import { Action } from '../../../src/core/actions.js';
import { streamKind } from '../../../src/services/playerEngines.js';

test('keyboard: Space and the media keys besides the common keys', () => {
  expect(DESKTOP_KEY_CODES[32]).toBe(Action.PLAY_PAUSE);
  expect(DESKTOP_KEY_CODES[179]).toBe(Action.PLAY_PAUSE);
  expect(DESKTOP_KEY_CODES[176]).toBe(Action.CHANNEL_UP);
});

test('the <video> engine with the JS demuxers; HLS and MPEG-TS go through them', () => {
  expect(desktop.createEngine().kind).toBe('html5');
  expect(streamKind('http://h/live/u/p/12.m3u8')).toBe('hls');
  expect(streamKind('http://h/live/u/p/12.ts')).toBe('ts');
  expect(streamKind('http://h/live/u/p/12')).toBe('ts');
  expect(streamKind('http://h/movie/u/p/12.mkv')).toBe('native');
});

test('trailers open in the system browser; the version of the shell in the checks', () => {
  const open = jest.spyOn(window, 'open').mockImplementation(() => null);
  expect(desktop.openTrailer('abcdefghijk')).toBe(true);
  expect(open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abcdefghijk', '_blank');
  open.mockRestore();
  expect(electronVersion('Mozilla/5.0 Chrome/140 Electron/44.9.3 Safari/537.36')).toBe('44.9.3');
  expect(electronVersion('Mozilla/5.0 Chrome/140')).toBeNull();
});

test('full screen: through the preload bridge of the window, or the page own full screen in a plain browser', async () => {
  window.xtreamDesktop = { toggleFullscreen: jest.fn(async () => true), isFullscreen: jest.fn(async () => true) };
  expect(await desktop.toggleFullscreen()).toBe(true);
  expect(await desktop.isFullscreen()).toBe(true);
  expect(window.xtreamDesktop.toggleFullscreen).toHaveBeenCalledTimes(1);
  delete window.xtreamDesktop;
  expect(await desktop.isFullscreen()).toBe(false); // no bridge, nothing full screen
  expect(await desktop.toggleFullscreen()).toBe(false); // jsdom cannot go full screen: it just says so
});
