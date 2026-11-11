import { h } from '../dom.js';
import { createButton } from '../atoms/button.js';
import { createChoice } from '../atoms/choice.js';
import { createHeading } from '../atoms/heading.js';
import { createHint } from '../atoms/hint.js';
import { createTextInput } from '../atoms/textInput.js';
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

  /** Where the focus goes back to when the dialog closes. */
  function snapshot() {
    return { id: focus.activeId, index: focus.active ? focus.active.index : 0 };
  }

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
    const previous = snapshot();
    const buttons = [
      createButton({ label: cancelLabel }),
      createButton({ label: confirmLabel, variant: 'primary' }),
    ];
    const overlay = h(
      'div',
      { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'dialog' }, createHeading({ text: title }), content || createHint({ text: message, muted: false }), h('div', { class: 'dialog-actions' }, buttons)),
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
    const previous = snapshot();
    // An option can carry an icon (`option.icon`) before its label: the actions of a programme, say.
    const nodes = options.map((option, i) => createChoice({ label: option.label, icon: option.icon || null, current: option.value === selected, index: i }));
    const list = h('div', { class: 'choice-list' }, nodes);
    const overlay = h('div', { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dialog' }, createHeading({ text: title }), list));
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
   * Search box + results list. `run(query)` returns [{ key, name, group, count }] (groups are highlighted). OK on the field opens the
   * keyboard, Done moves to the results. Resolves with the chosen result, or null when dismissed.
   * `minLength` is how many characters start a search (0: the list is there as soon as the dialog opens).
   * `autoFocus: false` does not open the keyboard on the field when the dialog opens (the first result takes the focus once listed). With `allowCreate`
   * the first result is a "create" row (icon + the typed name, no label) (`{ create: true, name: text }`) as long as something is typed.
   */
  function search({ title, placeholder = '', run, emptyLabel = '', minLength = 2, allowCreate = false, autoFocus = true }) {
    if (current) return current.promise;
    const previous = snapshot();
    let results = [];
    let timer = null;
    let token = 0;
    const input = createTextInput({ className: 'value-input', placeholder });
    const field = h('div', { class: 'choice search-field' }, icon('search'), input);
    const list = h('div', { class: 'choice-list' });
    const status = createHint({ className: 'search-status' });
    const overlay = h('div', { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dialog search-dialog' }, createHeading({ text: title }), field, status, list));
    root.appendChild(overlay);
    let nodes = [];
    const rowsAt = (i) => (i === 0 ? field : nodes[i - 1]);

    function paint() {
      while (list.firstChild) list.removeChild(list.firstChild);
      nodes = results.map((r) => {
        if (r.create) return createChoice({ label: r.name, icon: 'add', className: 'merge-group', iconLayout: false });
        if (r.group) return createChoice({ label: `${r.name} (${r.count})`, icon: 'all', className: 'merge-group', iconLayout: false });
        return h('div', { class: 'choice' }, h('span', { text: r.name }));
      });
      nodes.forEach((n) => list.appendChild(n));
      status.textContent = !results.length && input.value.trim().length >= Math.max(1, minLength) ? emptyLabel : '';
    }

    async function query() {
      const mine = (token += 1);
      const text = input.value.trim();
      const found = text.length < minLength ? [] : await run(text).catch(() => []);
      if (mine !== token || !current || current.overlay !== overlay) return;
      results = allowCreate && text ? [{ create: true, name: text }].concat(found) : found;
      paint();
    }

    input.addEventListener('keydown', (event) => {
      event.stopPropagation(); // the text field owns its keys
      if (event.keyCode === 13 || event.keyCode === 65376) {
        event.preventDefault();
        input.blur();
        clearTimeout(timer);
        query().then(() => focus.focus(DIALOG_ZONE, results.length ? 1 : 0));
      } else if (event.keyCode === 65385) input.blur();
    });
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(query, 300);
    });

    const zone = new FocusZone({
      id: DIALOG_ZONE,
      model: new ListModel({ orientation: 'vertical', getCount: () => 1 + results.length }),
      onFocus: (i) => {
        const node = rowsAt(i);
        if (!node) return;
        node.classList.add('focused');
        node.scrollIntoView({ block: 'nearest' });
      },
      onBlur: (i) => rowsAt(i) && rowsAt(i).classList.remove('focused'),
      onActivate: (i) => {
        if (i === 0) input.focus();
        else close(results[i - 1]);
      },
    });
    focus.register(zone);
    const promise = new Promise((resolve) => {
      current = { overlay, previous, resolve, promise: null, cancelValue: null, cleanup: () => clearTimeout(timer) };
    });
    current.promise = promise;
    focus.focus(DIALOG_ZONE, 0);
    if (minLength === 0) query().then(() => !autoFocus && results.length && current && current.overlay === overlay && focus.focus(DIALOG_ZONE, 1));
    if (autoFocus) input.focus();
    return promise;
  }

  /**
   * Edit box of a collection: its name, the titles it holds (OK marks one to be taken out) and Save / Cancel.
   * Resolves with `{ name, remove: [keys] }`, or null when cancelled.
   */
  function editCollection({ title, name = '', items, nameLabel = null, saveLabel, cancelLabel }) {
    if (current) return current.promise;
    const previous = snapshot();
    const gone = new Set();
    const named = Boolean(nameLabel); // a network cannot be renamed: its box has only the titles
    const input = createTextInput({ className: 'value-input', value: name, ariaLabel: nameLabel || '' });
    const field = h('div', { class: 'choice search-field' }, icon('edit'), input);
    const lead = named ? 1 : 0; // rows before the titles
    const rows = items.map((item) => createChoice({ label: item.name, className: 'edit-item', trailingIcon: 'remove' }));
    const list = h('div', { class: 'choice-list' }, rows);
    const buttons = [createButton({ label: cancelLabel }), createButton({ label: saveLabel, variant: 'primary' })];
    const overlay = h('div', { class: 'dialog-backdrop', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'dialog search-dialog' }, createHeading({ text: title }), named ? field : null, list, h('div', { class: 'dialog-actions stacked' }, buttons)));
    root.appendChild(overlay);
    const total = () => lead + items.length + 2;
    const nodeAt = (i) => (i < lead ? field : i < lead + items.length ? rows[i - lead] : buttons[i - lead - items.length]);
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.keyCode === 13 || event.keyCode === 65376) {
        event.preventDefault();
        input.blur();
        focus.focus(DIALOG_ZONE, lead + items.length + 1); // Save
      } else if (event.keyCode === 65385) input.blur();
    });
    const zone = new FocusZone({
      id: DIALOG_ZONE,
      model: new ListModel({ orientation: 'vertical', getCount: total }),
      onFocus: (i) => {
        nodeAt(i).classList.add('focused');
        nodeAt(i).scrollIntoView({ block: 'nearest' });
      },
      onBlur: (i) => nodeAt(i) && nodeAt(i).classList.remove('focused'),
      onActivate: (i) => {
        if (i < lead) input.focus();
        else if (i < lead + items.length) {
          const key = items[i - lead].key;
          if (gone.has(key)) gone.delete(key);
          else gone.add(key);
          rows[i - lead].classList.toggle('removed', gone.has(key));
        } else if (i === lead + items.length) close(null);
        else close({ name: input.value.trim() || name, remove: Array.from(gone) });
      },
    });
    focus.register(zone);
    const promise = new Promise((resolve) => {
      current = { overlay, previous, resolve, promise: null, cancelValue: null };
    });
    current.promise = promise;
    focus.focus(DIALOG_ZONE, items.length ? lead : lead + 1);
    return promise;
  }

  /**
   * PIN pad: digits from the remote's number keys or from the on-screen keypad (3 columns: 1-9, delete, 0, cancel).
   * `validate(pin)` may return an error text (shown, the digits are cleared) or '' to accept. Resolves with the PIN, or null when cancelled.
   */
  function pin({ title, message = '', validate = null }) {
    if (current) return current.promise;
    const previous = snapshot();
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
      h('div', { class: 'dialog pin-dialog' }, createHeading({ text: title }), message ? createHint({ text: message, muted: false }) : null, h('div', { class: 'pin-dots' }, dots), error, h('div', { class: 'pin-pad' }, nodes)),
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
    search,
    editCollection,
    pin,
    isOpen: () => current !== null,
    /** Back key: closes the dialog as "cancel". */
    dismiss: () => close(current && 'cancelValue' in current ? current.cancelValue : false),
  };
}
