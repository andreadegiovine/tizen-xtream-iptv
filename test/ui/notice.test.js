import { FocusManager, FocusZone } from '../../src/ui/focus/FocusManager.js';
import { ListModel } from '../../src/ui/focus/models.js';
import { createNoticeService, NOTICE_ZONE } from '../../src/ui/components/notice.js';
import { Action } from '../../src/core/input.js';

function setup(extra = {}) {
  jest.useFakeTimers();
  const root = document.createElement('div');
  const focus = new FocusManager();
  focus.register(new FocusZone({ id: 'page', model: new ListModel({ orientation: 'vertical', getCount: () => 3 }) }));
  focus.focus('page', 1);
  return { root, focus, notices: createNoticeService({ focus, root, ...extra }) };
}
afterEach(() => jest.useRealTimers());

describe('notices', () => {
  test('a notice takes the focus, OK closes it and the focus goes back', () => {
    const { root, focus, notices } = setup();
    notices.success('Saved');
    expect(root.querySelector('.notice.success .notice-text').textContent).toBe('Saved');
    expect(focus.activeId).toBe(NOTICE_ZONE);
    focus.handle(Action.ENTER);
    expect(root.querySelector('.notice')).toBeNull();
    expect(focus.activeId).toBe('page');
    expect(focus.active.index).toBe(1);
  });

  test('timed notices close by themselves, permanent ones stay', () => {
    const { root, notices } = setup();
    notices.info('Soon gone');
    notices.show({ type: 'warning', message: 'Stays', permanent: true });
    jest.advanceTimersByTime(10000);
    const left = Array.from(root.querySelectorAll('.notice-text')).map((n) => n.textContent);
    expect(left).toEqual(['Stays']);
    notices.dismissTop();
    expect(notices.isOpen()).toBe(false);
  });

  test('a notice with the same key replaces the previous one', () => {
    const { root, notices } = setup();
    notices.info('One', { key: 'k' });
    notices.info('Two', { key: 'k' });
    expect(root.querySelectorAll('.notice')).toHaveLength(1);
    expect(root.querySelector('.notice-text').textContent).toBe('Two');
  });

  test('during playback only playback notices appear, without taking the focus', () => {
    const { root, focus, notices } = setup();
    notices.setPlayback(true);
    expect(notices.info('Dropped')).toBeNull();
    expect(notices.error('Stream failed', { scope: 'playback' })).not.toBeNull();
    expect(root.querySelectorAll('.notice')).toHaveLength(1);
    expect(focus.activeId).toBe('page');
  });

  test('an open dialog keeps the focus', () => {
    const { focus, notices } = setup({ isDialogOpen: () => true });
    notices.info('Hello');
    expect(focus.activeId).toBe('page');
  });

  test('click closes a notice', () => {
    const { root, notices } = setup();
    notices.info('Click me');
    root.querySelector('.notice').click();
    expect(notices.isOpen()).toBe(false);
  });
});
