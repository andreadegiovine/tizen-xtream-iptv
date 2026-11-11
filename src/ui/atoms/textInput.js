import { h } from '../dom.js';

/**
 * Text input with the attributes every field of the app needs on a TV (no autocomplete, no capitals, no spell check: the on-screen
 * keyboard would otherwise change what is typed).
 */
export function createTextInput({ type = 'text', className = '', placeholder = '', value = null, ariaLabel = null, inputmode = '' } = {}) {
  return h('input', {
    class: className || null,
    type,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    placeholder: placeholder || null,
    inputmode: inputmode || null,
    value,
    'aria-label': ariaLabel,
  });
}
