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
