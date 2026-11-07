import { h } from '../dom.js';
import { FocusZone } from '../focus/FocusManager.js';
import { Dir } from '../focus/models.js';
import { ensureVisible } from '../scroll.js';
import { createField } from './field.js';

/** A page in the centred, full-width frame (Settings, Visible categories, Diagnostics, provider form): title, then the content. */
export function framedPage(...children) {
  return h('section', { class: 'page framed' }, h('div', { class: 'page-container' }, ...children));
}

/**
 * Navigation of a form: the fields one under the other, then the actions on ONE line. Down from the last field lands on the first
 * action ("Confirm"); Left / Right move between the actions; Up from an action goes back to the last field.
 * `clearable`: each field also has its "x" (index `fieldCount + actionCount + field`), reached with Right from the field, Left goes back.
 */
export function formModel({ fieldCount, actionCount, clearable = false }) {
  const total = fieldCount + actionCount;
  const move = (index) => ({ type: 'move', index });
  const exit = (dir) => ({ type: 'exit', dir });
  return {
    getCount: () => total + (clearable ? fieldCount : 0),
    navigate(dir, at) {
      let index = at;
      if (index >= total) {
        // On the x of a field: Left back to the field, Up / Down as from the field.
        index -= total;
        if (dir === Dir.LEFT) return move(index);
        if (dir === Dir.RIGHT) return exit(dir);
      } else if (clearable && index < fieldCount && dir === Dir.RIGHT) return move(total + index);
      const inActions = index >= fieldCount;
      if (dir === Dir.UP) {
        if (!inActions) return index > 0 ? move(index - 1) : exit(dir);
        return fieldCount > 0 ? move(fieldCount - 1) : exit(dir);
      }
      if (dir === Dir.DOWN) {
        if (!inActions) return index < fieldCount - 1 ? move(index + 1) : actionCount > 0 ? move(fieldCount) : exit(dir);
        return exit(dir);
      }
      if (!inActions) return exit(dir);
      if (dir === Dir.LEFT) return index > fieldCount ? move(index - 1) : exit(dir);
      if (dir === Dir.RIGHT) return index < total - 1 ? move(index + 1) : exit(dir);
      return exit(dir);
    },
  };
}

/**
 * A form: `fields` (specs of createField: { label, type... }) one under the other, a status line, then `actions`
 * ([{ label, primary, run }]) side by side. Enter / Done in a field moves to the next one (the last one moves to the first
 * action). Returns { el, zone, status, fields (the created fields), actionButtons } — the page registers `zone` with `focus`
 * and puts `el` where it wants.
 */
export function createForm({ id, focus, fields: specs, actions }) {
  const status = h('div', { class: 'status', role: 'status' });
  const actionButtons = actions.map((a) => h('button', { class: `btn${a.primary ? ' primary' : ''}`, type: 'button', text: a.label }));
  const total = specs.length + actions.length;
  const fields = specs.map((spec, i) => createField({ ...spec, onSubmit: () => focus.focus(id, Math.min(i + 1, total - 1)) }));
  const nodes = fields.map((f) => f.el).concat(actionButtons, fields.map((f) => f.clearEl));
  const el = h('div', { class: 'form' }, fields.map((f) => f.root), status, h('div', { class: 'form-actions' }, actionButtons));
  const zone = new FocusZone({
    id,
    model: formModel({ fieldCount: fields.length, actionCount: actions.length, clearable: true }),
    onFocus: (i) => {
      nodes[i].classList.add('focused');
      ensureVisible(nodes[i], { first: i === 0 });
    },
    onBlur: (i) => nodes[i] && nodes[i].classList.remove('focused'),
    onActivate: (i) => {
      if (i < fields.length) fields[i].focus();
      else if (i < total) actions[i - fields.length].run();
      else fields[i - total].clear();
    },
  });
  return { el, zone, status, fields, actionButtons };
}
