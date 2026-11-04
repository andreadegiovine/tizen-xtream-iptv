import { createNoticeService } from '../../src/ui/components/notice.js';

function setup() {
  jest.useFakeTimers();
  const root = document.createElement('div');
  return { root, notices: createNoticeService({ root }) };
}
afterEach(() => jest.useRealTimers());

describe('notices', () => {
  test('a notice shows its text and never takes the focus', () => {
    const { root, notices } = setup();
    notices.success('Saved');
    expect(root.querySelector('.notice.success .notice-text').textContent).toBe('Saved');
  });

  test('timed notices close by themselves, permanent ones stay', () => {
    const { root, notices } = setup();
    notices.info('Soon gone');
    notices.show({ type: 'warning', message: 'Stays', permanent: true });
    jest.advanceTimersByTime(10000);
    expect(Array.from(root.querySelectorAll('.notice-text')).map((n) => n.textContent)).toEqual(['Stays']);
  });

  test('a notice with the same key replaces the previous one', () => {
    const { root, notices } = setup();
    notices.info('One', { key: 'k' });
    notices.info('Two', { key: 'k' });
    expect(root.querySelectorAll('.notice')).toHaveLength(1);
    expect(root.querySelector('.notice-text').textContent).toBe('Two');
  });

  test('during playback only playback notices appear', () => {
    const { root, notices } = setup();
    notices.setPlayback(true);
    expect(notices.info('Dropped')).toBeNull();
    expect(notices.error('Stream failed', { scope: 'playback' })).not.toBeNull();
    expect(root.querySelectorAll('.notice')).toHaveLength(1);
  });

  test('click closes a notice', () => {
    const { root, notices } = setup();
    notices.info('Click me');
    root.querySelector('.notice').click();
    expect(notices.isOpen()).toBe(false);
  });
});
