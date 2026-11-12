import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createTopbar } from '../../src/ui/components/topbar.js';

test('the search field sits between the logo and the clock, not across the whole bar', () => {
  const bar = createTopbar({ focus: new FocusManager() }, {});
  bar.openSearch({ silent: true });
  const kinds = Array.from(bar.el.children).map((node) => (node.classList.contains('topbar-back') ? 'back' : node.classList.contains('logo') ? 'logo' : node.classList.contains('topbar-search') ? 'field' : node.classList.contains('topbar-clock') ? 'clock' : 'other'));
  expect(kinds).toEqual(['logo', 'back', 'field', 'other', 'clock']); // `back`: the pointer's Back after the logo (hidden without the pointer); `other`: the close button
  bar.closeSearch({ notify: false });
  expect(bar.el.querySelector('.topbar-clock')).not.toBeNull();
});

test('the bar entry of the page on screen only gives it the focus; another entry (or a page opened over it) loads the section', async () => {
  const { Action } = await import('../../src/core/input.js');
  const { TOPBAR_ZONE } = await import('../../src/ui/components/topbar.js');
  const focus = new FocusManager();
  const takeFocusFromBar = jest.fn(() => true);
  const router = { depth: 1, current: { name: 'browse', params: { type: 'movie', section: 'movies' } }, page: { takeFocusFromBar }, reset: jest.fn() };
  const bar = createTopbar({ focus, router }, {});
  document.body.appendChild(bar.el);
  const labels = () => Array.from(bar.el.querySelectorAll('.topbar-item:not(.topbar-back)')).map((n) => n.getAttribute('aria-label') || n.textContent);
  focus.focus(TOPBAR_ZONE, labels().indexOf('Movies'));
  focus.handle(Action.ENTER);
  expect(takeFocusFromBar).toHaveBeenCalledTimes(1);
  expect(router.reset).not.toHaveBeenCalled();
  focus.focus(TOPBAR_ZONE, labels().indexOf('TV Series'));
  focus.handle(Action.ENTER);
  expect(router.reset).toHaveBeenCalledWith('browse', expect.objectContaining({ type: 'series', fromBar: true }));
  router.depth = 2; // a title opened over Movies
  focus.focus(TOPBAR_ZONE, labels().indexOf('Movies'));
  focus.handle(Action.ENTER);
  expect(router.reset).toHaveBeenCalledTimes(2);
  expect(takeFocusFromBar).toHaveBeenCalledTimes(1);
  document.body.innerHTML = '';
});
