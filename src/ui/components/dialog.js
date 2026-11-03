import { h } from '../dom.js';
import { FocusZone } from '../focus/FocusManager.js';
import { ListModel } from '../focus/models.js';

export const DIALOG_ZONE = 'dialog';

/**
 * Modal confirmation dialog. It traps focus (its zone has no links) and gives focus back to the
 * zone that owned it. Left = cancel (default focus), right = confirm.
 */
export function createDialogService({ focus, root = document.body }) {
  let current = null;

  function close(result) {
    if (!current) return;
    const { overlay, previous, resolve } = current;
    current = null;
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

  return {
    confirm,
    choose,
    isOpen: () => current !== null,
    /** Back key: closes the dialog as "cancel". */
    dismiss: () => close(current && 'cancelValue' in current ? current.cancelValue : false),
  };
}
