import webos, { WEBOS_KEY_CODES } from '../../../platforms/webos/platform.js';
import { lunaCall, openYouTube, YOUTUBE_APP_ID } from '../../../platforms/webos/luna.js';
import { Action } from '../../../src/core/actions.js';

/** A PalmServiceBridge that records the calls and answers `answer`. */
function fakeBridge(answer, calls) {
  return function PalmServiceBridge() {
    this.call = (uri, params) => {
      calls.push([uri, JSON.parse(params)]);
      setTimeout(() => this.onservicecallback(JSON.stringify(answer)), 0);
    };
  };
}

test('remote: Back is 461; the rest are the common keys', () => {
  expect(WEBOS_KEY_CODES[461]).toBe(Action.BACK);
  expect(webos.keyCodes).toBe(WEBOS_KEY_CODES);
});

test('trailers open in the YouTube app of the TV; the video plays in the page', async () => {
  const calls = [];
  const env = { PalmServiceBridge: fakeBridge({ returnValue: true }, calls) };
  await openYouTube('abcdefghijk', env);
  expect(calls).toEqual([['luna://com.webos.applicationManager/launch', { id: YOUTUBE_APP_ID, params: { contentTarget: 'https://www.youtube.com/tv?v=abcdefghijk' } }]]);
  expect(webos.createTrailerEngine).toBeNull();
  expect(typeof webos.openTrailer).toBe('function');
  expect(webos.createEngine().kind).toBe('html5');
});

test('a Luna call fails when the service says so, or outside webOS', async () => {
  await expect(lunaCall('luna://x/y', {}, { PalmServiceBridge: fakeBridge({ returnValue: false, errorText: 'denied' }, []) })).rejects.toThrow('denied');
  await expect(lunaCall('luna://x/y', {}, {})).rejects.toThrow('not available');
});
