import { h } from '../dom.js';
import { FocusZone } from '../focus/FocusManager.js';
import { GridModel, ListModel } from '../focus/models.js';
import { icon } from '../icons.js';

const PIN_LENGTH = 4;

export const DIALOG_ZONE = 'dialog';

/**
 * Modal confirmation dialog. It traps focus (its zone has no links) and gives focus back to the
 * zone that owned it. Left = cancel (default focus), right = confirm.
 */
export function createDialogService({ focus, root = document.body }) {
  let current = null;

  function close(result) {
    if (!current) return;
    const { overlay, previous, resolve, cleanup } = current;
    current = null;
    if (cleanup) cleanup();
    overlay.remove();
    focus.unregister(DIALOG_ZONE);
    if (previous.id && focus.zones.has(previous.id)) focus.focus(previous.id, previous.index);
    resolve(result);
  }

  /** `content` (a DOM node) replaces the plain `message` paragraph. */
  function confirm({ title, message, content = null, confirmLabel, cancelLabel }) {
    if (current) return current.promise;
    const previous = { id: focus.activeId, index: focus.active ? focus.active.index : 0 };
    const buttons = [
      h('button', { class: 'btn', type: 'button', text: cancelLabel }),
      h('button', { class: 'btn primary', type: 'button', text: confirmLabel }),
    ];
    const overlay = h(
      'div',
      { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'dialog' }, h('h2', { text: title }), content || h('p', { text: message }), h('div', { class: 'dialog-actions' }, buttons)),
    );
    root.appendChild(overlay);

    const zone = new FocusZone({
      id: DIALOG_ZONE,
      model: new ListModel({ orientation: 'horizontal', getCount: () => buttons.length }),
      onFocus: (i) => buttons[i].classList.add('focused'),
      onBlur: (i) => buttons[i].classList.remove('focused'),
      onActivate: (i) => close(i === 1),
    });
    focus.register(zone);
    const promise = new Promise((resolve) => {
      current = { overlay, previous, resolve, promise: null };
    });
    current.promise = promise;
    focus.focus(DIALOG_ZONE, 0);
    return promise;
  }

  /** Modal list of options (custom dropdown). Resolves with the chosen value, or null when dismissed. */
  function choose({ title, options, selected }) {
    if (current) return current.promise;
    const previous = { id: focus.activeId, index: focus.active ? focus.active.index : 0 };
    const nodes = options.map((option, i) =>
      h('div', { class: `choice${option.value === selected ? ' current' : ''}`, text: option.label, 'data-i': i }),
    );
    const list = h('div', { class: 'choice-list' }, nodes);
    const overlay = h('div', { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dialog' }, h('h2', { text: title }), list));
    root.appendChild(overlay);
    const start = Math.max(0, options.findIndex((o) => o.value === selected));
    const zone = new FocusZone({
      id: DIALOG_ZONE,
      model: new ListModel({ orientation: 'vertical', getCount: () => options.length }),
      onFocus: (i) => {
        nodes[i].classList.add('focused');
        nodes[i].scrollIntoView({ block: 'nearest' });
      },
      onBlur: (i) => nodes[i].classList.remove('focused'),
      onActivate: (i) => close(options[i].value),
    });
    focus.register(zone);
    const promise = new Promise((resolve) => {
      current = { overlay, previous, resolve, promise: null, cancelValue: null };
    });
    current.promise = promise;
    focus.focus(DIALOG_ZONE, start);
    return promise;
  }

  /**
   * PIN pad: digits from the remote's number keys or from the on-screen keypad (3 columns: 1-9, delete, 0, cancel).
   * `validate(pin)` may return an error text (shown, the digits are cleared) or '' to accept. Resolves with the PIN, or null when cancelled.
   */
  function pin({ title, message = '', validate = null }) {
    if (current) return current.promise;
    const previous = { id: focus.activeId, index: focus.active ? focus.active.index : 0 };
    let digits = '';
    let busy = false;
    const dots = Array.from({ length: PIN_LENGTH }, () => h('span', { class: 'pin-dot' }));
    const error = h('p', { class: 'pin-error' });
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'cancel'];
    const nodes = keys.map((key) => {
      if (key === 'back') return h('div', { class: 'pin-key', 'aria-label': 'delete' }, icon('backspace'));
      if (key === 'cancel') return h('div', { class: 'pin-key', 'aria-label': 'cancel' }, icon('close'));
      return h('div', { class: 'pin-key', text: key });
    });
    const paint = () => dots.forEach((dot, i) => dot.classList.toggle('filled', i < digits.length));
    const overlay = h(
      'div',
      { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'dialog pin-dialog' }, h('h2', { text: title }), message ? h('p', { text: message }) : null, h('div', { class: 'pin-dots' }, dots), error, h('div', { class: 'pin-pad' }, nodes)),
    );
    root.appendChild(overlay);

    async function press(key) {
      if (busy) return;
      if (key === 'cancel') {
        close(null);
        return;
      }
      error.textContent = '';
      if (key === 'back') digits = digits.slice(0, -1);
      else if (digits.length < PIN_LENGTH) digits += key;
      paint();
      if (digits.length < PIN_LENGTH) return;
      busy = true;
      const problem = validate ? await validate(digits) : '';
      busy = false;
      if (!current || current.overlay !== overlay) return;
      if (!problem) close(digits);
      else {
        error.textContent = problem;
        digits = '';
        paint();
      }
    }

    const onKey = (event) => {
      const code = event.keyCode;
      const digit = code >= 48 && code <= 57 ? code - 48 : code >= 96 && code <= 105 ? code - 96 : -1;
      if (digit < 0) return;
      event.preventDefault();
      event.stopPropagation();
      press(String(digit));
    };
    document.addEventListener('keydown', onKey, true);

    const zone = new FocusZone({
      id: DIALOG_ZONE,
      model: new GridModel({ columns: 3, getCount: () => keys.length }),
      onFocus: (i) => nodes[i].classList.add('focused'),
      onBlur: (i) => nodes[i].classList.remove('focused'),
      onActivate: (i) => press(keys[i]),
    });
    focus.register(zone);
    const promise = new Promise((resolve) => {
      current = { overlay, previous, resolve, promise: null, cancelValue: null, cleanup: () => document.removeEventListener('keydown', onKey, true) };
    });
    current.promise = promise;
    focus.focus(DIALOG_ZONE, 4); // the 5 key, the middle of the pad
    return promise;
  }

  return {
    confirm,
    choose,
    pin,
    isOpen: () => current !== null,
    /** Back key: closes the dialog as "cancel". */
    dismiss: () => close(current && 'cancelValue' in current ? current.cancelValue : false),
  };
}
