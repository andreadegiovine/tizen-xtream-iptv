import { createButton } from '../../src/ui/atoms/button.js';
import { createIconButton, setIconButtonActive, setIconButtonLabel } from '../../src/ui/atoms/iconButton.js';
import { createPlayerButton, setPlayerButtonIcon, setPlayerButtonLabel } from '../../src/ui/atoms/playerButton.js';
import { createChip, createChipLabel } from '../../src/ui/atoms/chip.js';
import { createToggle, setToggle } from '../../src/ui/atoms/toggle.js';
import { createTextInput } from '../../src/ui/atoms/textInput.js';
import { createChoice } from '../../src/ui/atoms/choice.js';
import { createListRow } from '../../src/ui/atoms/listRow.js';
import { createSidebarItem, createSidebarItemSkeleton } from '../../src/ui/atoms/sidebarItem.js';
import { createTopbarItem } from '../../src/ui/atoms/topbarItem.js';
import { createTableRow, createRowButtons } from '../../src/ui/atoms/tableRow.js';
import { createPanel, createPanelButtons } from '../../src/ui/atoms/panel.js';
import { createHeading } from '../../src/ui/atoms/heading.js';
import { createHint } from '../../src/ui/atoms/hint.js';
import { createPlaceholder } from '../../src/ui/atoms/placeholder.js';
import { createSkeletonLine, createSkeletonBlock } from '../../src/ui/atoms/skeleton.js';
import { createMetaSeparator, createMetaRating } from '../../src/ui/atoms/metaParts.js';

const classes = (el) => Array.from(el.classList).sort().join(' ');

test('button: text, primary, icon only with its accessible name and tooltip', () => {
  const text = createButton({ label: 'Save', variant: 'primary' });
  expect(text.tagName).toBe('BUTTON');
  expect(text.type).toBe('button');
  expect(classes(text)).toBe('btn primary');
  expect(text.textContent).toBe('Save');
  expect(text.getAttribute('data-tip')).toBeNull(); // its text is on it
  const only = createButton({ label: 'Remove', icon: 'remove', variant: 'danger', iconOnly: true, className: 'panel-button' });
  expect(classes(only)).toBe('btn danger icon-only panel-button');
  expect(only.getAttribute('aria-label')).toBe('Remove');
  expect(only.getAttribute('data-tip')).toBe('Remove');
  expect(only.getAttribute('data-tip-dir')).toBeNull(); // above
  expect(only.textContent).toBe('');
  expect(only.querySelector('svg.icon-remove')).not.toBeNull();
});

test('icon box, player button and their states', () => {
  const box = createIconButton({ icon: 'heart', label: 'Favourite', active: true });
  expect(classes(box)).toBe('active icon-btn');
  setIconButtonActive(box, false);
  expect(classes(box)).toBe('icon-btn');
  expect(createIconButton({ icon: 'pin', tag: 'span', className: 'browse-fav' }).tagName).toBe('SPAN');
  expect(box.getAttribute('data-tip')).toBe('Favourite');
  setIconButtonLabel(box, 'Not favourite');
  expect(box.getAttribute('aria-label')).toBe('Not favourite');
  expect(box.getAttribute('data-tip')).toBe('Not favourite');
  const { el } = createPlayerButton({ icon: 'pause', label: 'Pause' });
  expect(el.className).toBe('player-btn');
  expect(el.getAttribute('data-tip')).toBe('Pause');
  setPlayerButtonLabel(el, 'Next channel', 'Rai 1');
  expect(el.getAttribute('aria-label')).toBe('Next channel');
  expect(el.getAttribute('data-tip')).toBe('Rai 1');
  setPlayerButtonIcon(el, 'play');
  expect(el.firstChild.getAttribute('class')).toContain('icon-play');
  expect(el.querySelectorAll('svg')).toHaveLength(1);
});

test('chip, toggle, text input, choice', () => {
  expect(classes(createChip({ text: 'Drama', link: true }))).toBe('chip link');
  expect(createChipLabel('Genres').className).toBe('detail-label');
  const toggle = createToggle();
  setToggle(toggle, true);
  expect(classes(toggle)).toBe('on toggle');
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  const input = createTextInput({ className: 'value-input', placeholder: 'Name' });
  ['autocomplete', 'autocapitalize'].forEach((a) => expect(input.getAttribute(a)).toBe('off'));
  expect(input.getAttribute('spellcheck')).toBe('false');
  expect(input.className).toBe('value-input');
  const withIcon = createChoice({ label: 'Watch', icon: 'play', current: true, index: 2 });
  expect(classes(withIcon)).toBe('choice current with-icon');
  expect(withIcon.getAttribute('data-i')).toBe('2');
  expect(createChoice({ label: 'Plain' }).textContent).toBe('Plain');
  expect(classes(createChoice({ label: 'Group', icon: 'all', className: 'merge-group', iconLayout: false }))).toBe('choice merge-group');
});

test('list row, sidebar entry, top bar entry', () => {
  const row = createListRow({ label: 'Language', value: 'Automatic' });
  expect(row.el.className).toBe('row');
  expect(row.valueEl.className).toBe('value');
  expect(row.el.textContent).toBe('LanguageAutomatic');
  const entry = createSidebarItem({ name: 'Genres', icon: 'genres', count: '12', current: true, trailingIcon: 'chevron', open: true });
  expect(classes(entry)).toBe('browse-cat current');
  expect(Array.from(entry.children).map((c) => c.getAttribute('class').split(' ')[0])).toEqual(['browse-cat-icon', 'browse-cat-name', 'browse-cat-count', 'icon']);
  expect(entry.lastChild.getAttribute('class')).toContain('open');
  expect(createSidebarItemSkeleton().className).toBe('browse-cat sub skeleton-cat');
  const item = createTopbarItem({ label: 'Search', icon: 'search', iconOnly: true });
  expect(classes(item)).toBe('icon-only topbar-item');
  expect(item.getAttribute('aria-label')).toBe('Search');
  expect(item.querySelector('span')).toBeNull();
  expect(item.getAttribute('data-tip')).toBe('Search');
  expect(item.getAttribute('data-tip-dir')).toBe('down'); // the bar's tooltips open below
  expect(createTopbarItem({ label: 'Movies' }).getAttribute('data-tip')).toBeNull();
});

test('table row and panel', () => {
  const buttons = createRowButtons(createButton({ label: 'x', icon: 'remove' }));
  const row = createTableRow({ name: 'Movies', buttons });
  expect(classes(row.el)).toBe('sync-row with-buttons');
  expect(row.status.className).toBe('sync-status');
  expect(createTableRow({ name: 'Op', statusText: 'since 8', buttons, className: 'op-row', withButtons: false }).el.className).toBe('sync-row op-row');
  const panel = createPanel({ title: 'Trakt', aside: createPanelButtons([]), rows: [row.el] });
  expect(panel.el.querySelector('.panel-head h2').textContent).toBe('Trakt');
  expect(panel.el.querySelector('.panel-head .panel-buttons')).not.toBeNull();
  expect(panel.body.className).toBe('sync');
  expect(panel.body.firstChild).toBe(row.el);
});

test('heading, hint, placeholder, skeleton, meta parts', () => {
  expect(createHeading({ level: 1, text: 'Title', className: 'detail-title' }).outerHTML).toBe('<h1 class="detail-title">Title</h1>');
  expect(createHint({ text: 'Empty', className: 'browse-empty' }).outerHTML).toBe('<p class="muted browse-empty">Empty</p>');
  expect(createHint({ text: 'Plain', muted: false }).outerHTML).toBe('<p>Plain</p>');
  expect(createPlaceholder({ icon: 'lock', className: 'locked' }).className).toBe('card-placeholder locked');
  expect(createSkeletonLine({ className: 'card-title' }).className).toBe('card-title skeleton-line');
  expect(createSkeletonLine({ className: 'carousel-title', tag: 'h2' }).tagName).toBe('H2');
  expect(createSkeletonBlock({ className: 'epg-channel-skeleton' }).className).toBe('skeleton-block epg-channel-skeleton');
  expect(createMetaSeparator().textContent).toBe('·');
  expect(createMetaRating('8.2').textContent).toBe('8.2');
});
