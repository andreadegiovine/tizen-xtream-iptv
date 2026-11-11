import { h } from '../dom.js';
import { icon } from '../icons.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';

/**
 * Labelled dropdown "input": a bordered box showing the current value and a chevron.
 * OK calls `onOpen` (the caller opens the option list, e.g. `dialogs.choose`).
 */
export function createSelectField({ id, label, text, onOpen }) {
  const value = h('span', { class: 'select-value', text });
  const box = h('div', { class: 'select-box' }, value, icon('chevron'));
  const el = h('div', { class: 'select-field' }, label ? h('span', { class: 'field-label', text: label }) : null, box);
  const zone = new FocusZone({
    id,
    nodes: () => [el],
    model: new ListModel({ orientation: 'vertical', getCount: () => 1 }),
    onFocus: () => {
      el.classList.add('focused');
      ensureVisible(el, { margin: 24 });
    },
    onBlur: () => el.classList.remove('focused'),
    onActivate: () => onOpen(),
  });
  return {
    el,
    zone,
    setText(next) {
      value.textContent = next;
    },
  };
}
