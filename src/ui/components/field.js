import { h } from '../dom.js';

// Samsung on-screen keyboard: "Done" and "Cancel" arrive as these key codes.
export const IME_DONE = 65376;
export const IME_CANCEL = 65385;

/**
 * Labelled text field (label above, input below, boxed): the same everywhere a value is typed (provider form, Settings...).
 * OK on the focused field opens the on-screen keyboard (`focus()`); Enter / Done blurs it and calls `onSubmit(value)`,
 * Cancel blurs it and calls `onCancel()`. The field owns its keys: they never reach the global input handler.
 * `trailing` (a button, say) is placed at the right of the box; `root` is then the node to insert in the page, otherwise it is `el`.
 * Returns { el (gets the `focused` class), root, input, focus, getValue, setValue }.
 */
export function createField({ label, type = 'text', placeholder = '', inputmode = '', onSubmit = null, onCancel = null, trailing = null }) {
  const input = h('input', { type, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: placeholder || null, inputmode: inputmode || null });
  const el = h('label', { class: 'field' }, h('span', { class: 'field-label', text: label }), input);
  const root = trailing ? h('div', { class: 'field-line' }, el, trailing) : el;
  input.addEventListener('keydown', (event) => {
    event.stopPropagation(); // the text field owns its keys
    if (event.keyCode === 13 || event.keyCode === IME_DONE) {
      event.preventDefault();
      input.blur();
      if (onSubmit) onSubmit(input.value, event);
    } else if (event.keyCode === IME_CANCEL) {
      input.blur();
      if (onCancel) onCancel();
    }
  });
  return {
    el,
    root,
    input,
    focus: () => input.focus(),
    getValue: () => input.value,
    setValue: (value) => {
      input.value = value === null || value === undefined ? '' : String(value);
    },
  };
}
