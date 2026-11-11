import { h } from '../dom.js';
import { t } from '../../i18n/index.js';
import { icon } from '../icons.js';
import { createTextInput } from './textInput.js';
import { actionFromKeyCode, Action } from '../../core/input.js';

// Samsung on-screen keyboard: "Done" and "Cancel" arrive as these key codes.
export const IME_DONE = 65376;
export const IME_CANCEL = 65385;

/**
 * Labelled text field (label above, input below, boxed): the same everywhere a value is typed (provider form, Settings...).
 * OK on the focused field opens the on-screen keyboard (`focus()`); Enter / Done blurs it and calls `onSubmit(value)`,
 * Cancel blurs it and calls `onCancel()`. The field owns its keys: they never reach the global input handler.
 * Leaving the field any other way (Up / Down of the remote, the keyboard closed, a click elsewhere, the focus moved) saves it too when its
 * value changed: `onLeave(value)` when given, otherwise `onSubmit` (which saves it, or puts the stored value back when it is not valid).
 * Only Back / Esc (and the Cancel of the Samsung keyboard) cancel: the value before the typing comes back, nothing is saved.
 * `trailing` (a button, say) is placed at the right of the box; `root` is then the node to insert in the page, otherwise it is `el`.
 * `clearable`: an "x" at the right edge inside the box (`clearEl`), shown while the field (or the x) has the focus; the page makes it
 * reachable with Right, and `clear()` (OK on it, or a click) empties the field (or puts its default back) and saves it, without the keyboard.
 * Returns { el (gets the `focused` class), root, input, clearEl, focus, clear, getValue, setValue }.
 */
export function createField({ label, type = 'text', placeholder = '', inputmode = '', onSubmit = null, onCancel = null, onLeave = null, trailing = null, clearable = true, defaultValue = '', onClear = null }) {
  const input = createTextInput({ type, placeholder, inputmode });
  const clearEl = clearable ? h('span', { class: 'field-clear', 'aria-label': t('field.clear') }, icon('close')) : null;
  const el = h('label', { class: clearable ? 'field clearable' : 'field' }, h('span', { class: 'field-label', text: label }), input, clearEl);
  // The x empties the field (or puts its default value back) and saves it at once, without the keyboard: `onClear(value)` when
  // given (a form that only empties it), otherwise the same `onSubmit` as Done.
  let committed = ''; // the value last shown or saved: leaving the field saves only a different one
  let leaving = false; // the blur of Enter / Done / Cancel: already handled
  const clear = () => {
    input.value = defaultValue === null || defaultValue === undefined ? '' : String(defaultValue);
    committed = input.value;
    if (onClear) onClear(input.value);
    else if (onSubmit) onSubmit(input.value, null);
  };
  if (clearEl) {
    clearEl.addEventListener('click', (event) => {
      event.preventDefault(); // inside the label: no default focus, `clear` does it
      clear();
    });
    // While the x has the focus, the box stays highlighted like the field.
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => el.classList.toggle('clearing', clearEl.classList.contains('focused'))).observe(clearEl, { attributes: true, attributeFilter: ['class'] });
    }
  }
  const root = trailing ? h('div', { class: 'field-line' }, el, trailing) : el;
  const blurQuietly = () => {
    leaving = true;
    input.blur();
    leaving = false;
  };
  const submit = (event) => {
    committed = input.value;
    if (onSubmit) onSubmit(input.value, event);
  };
  const cancel = () => {
    input.value = committed; // what was there before the typing
    blurQuietly();
    if (onCancel) onCancel();
  };
  input.addEventListener('keydown', (event) => {
    const action = actionFromKeyCode(event.keyCode);
    // Up / Down leave the field (saved as it is left, see blur) and move the focus as anywhere else: the key goes on to the app once the
    // field no longer has it. Left / Right stay in the text (the cursor).
    if (action === Action.UP || action === Action.DOWN) {
      input.blur();
      return;
    }
    event.stopPropagation(); // the text field owns its other keys
    if (event.keyCode === 13 || event.keyCode === IME_DONE) {
      event.preventDefault();
      blurQuietly();
      submit(event);
    } else if (event.keyCode === IME_CANCEL || (action === Action.BACK && event.keyCode !== 8)) {
      // Back of the remote, Esc (not Backspace: it deletes a character): the typing is cancelled, the app does not go back.
      event.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', (event) => {
    if (leaving) return;
    const next = event.relatedTarget;
    if (next && (next.tagName === 'INPUT' || next.tagName === 'TEXTAREA') && !document.body.classList.contains('pointer-mode')) {
      // A keyboard that ignores `enterkeyhint` (older Android WebViews): its "Next" moves the focus straight to the following text
      // field, with no Enter. Taken as Done: the value is saved and the keyboard closed (the other field gets the focus only after
      // this event). With the pointer, a click on another field keeps it.
      setTimeout(() => {
        if (document.activeElement === next && next.blur) next.blur();
      }, 0);
      submit(null);
      return;
    }
    if (input.value === committed) return;
    committed = input.value;
    if (onLeave) onLeave(input.value);
    else if (onSubmit) onSubmit(input.value, null);
  });
  return {
    el,
    root,
    input,
    clearEl,
    focus: () => input.focus(),
    clear,
    getValue: () => input.value,
    setValue: (value) => {
      input.value = value === null || value === undefined ? '' : String(value);
      committed = input.value;
    },
  };
}
