import { maskSecrets, log } from '../../src/core/logger.js';

describe('logger', () => {
  test('masks stream URL credentials', () => {
    expect(maskSecrets('http://h:80/movie/bob/secret/12.mp4')).toBe('http://h:80/movie/***/***/12.mp4');
    expect(maskSecrets('http://h/live/u/p/5.m3u8')).toBe('http://h/live/***/***/5.m3u8');
  });

  test('masks query credentials', () => {
    expect(maskSecrets('http://h/player_api.php?username=bob&password=secret&action=x')).toBe(
      'http://h/player_api.php?username=***&password=***&action=x',
    );
  });

  test('entries never contain secrets', () => {
    log.clear();
    log.info('calling', 'http://h/series/bob/secret/9.mkv');
    expect(log.entries()[0].message).not.toContain('secret');
  });
});
