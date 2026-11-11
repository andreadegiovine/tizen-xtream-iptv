import { streamLabel } from '../../src/ui/streamLabel.js';

describe('streamLabel', () => {
  test('a channel: its own name', () => {
    expect(streamLabel({ id: 1, name: 'Rai 1 HD' })).toBe('Rai 1 HD');
  });
  test('a version: id, tags and file type', () => {
    expect(streamLabel({ id: 12, ext: 'mkv', tags: ['FHD', 'ITA'] })).toBe('#12 · FHD ITA · mkv');
  });
  test('a version without tags', () => {
    expect(streamLabel({ id: 12, ext: 'mp4' })).toBe('#12 · mp4');
    expect(streamLabel({ id: 12 })).toBe('#12');
  });
});
