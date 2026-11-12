import { isLanguage, preferredAudioTrack } from '../../src/services/playerController.js';

test('a track language matches the app language in any spelling', () => {
  ['it', 'IT', 'ita', 'it-IT', 'Italian', 'italiano'].forEach((code) => expect(isLanguage(code, 'it-IT')).toBe(true));
  ['eng', 'en', '', 'und', 'iti'].forEach((code) => expect(isLanguage(code, 'it-IT')).toBe(false));
  expect(isLanguage('ger', 'de-DE')).toBe(true);
  expect(isLanguage('en-US', 'en-GB')).toBe(true);
});

test('the track in the language of the app: switched to only when another one plays', () => {
  const tracks = [{ index: 3, language: 'eng', current: true }, { index: 5, language: 'ita', current: false }];
  expect(preferredAudioTrack(tracks, 'it-IT')).toBe(5);
  expect(preferredAudioTrack(tracks, 'en-US')).toBeNull(); // already in English
  expect(preferredAudioTrack(tracks, 'de-DE')).toBeNull(); // none in German: the file's default
  expect(preferredAudioTrack([{ index: 0, language: 'ita', current: true }], 'en-US')).toBeNull(); // one track only
  expect(preferredAudioTrack([{ index: 0, language: 'und' }, { index: 1, language: 'it' }], 'it-IT')).toBe(1); // none marked current
});
