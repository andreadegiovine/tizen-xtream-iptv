import { h } from '../dom.js';

/**
 * Text input with the attributes every field of the app needs on a TV (no autocomplete, no capitals, no spell check: the on-screen
 * keyboard would otherwise change what is typed).
 * `enterkeyhint`: the action key of the on-screen keyboard. "done" by default: Android (Fire TV, Android TV) would otherwise show "Next"
 * when another field follows, which moves the focus to it without an Enter (the keyboard stays open and nothing is saved).
 */
export function createTextInput({ type = 'text', className = '', placeholder = '', value = null, ariaLabel = null, inputmode = '', enterkeyhint = 'done' } = {}) {
  return h('input', {
    class: className || null,
    type,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: placeholder || null,
    inputmode: inputmode || null,
    enterkeyhint: enterkeyhint || null,
    value,
    'aria-label': ariaLabel,
  });
}
