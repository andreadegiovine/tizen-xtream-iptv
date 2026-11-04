import { FocusManager, FocusZone } from '../../src/ui/focus/FocusManager.js';
import { ListModel } from '../../src/ui/focus/models.js';
import { createDialogService } from '../../src/ui/components/dialog.js';
import { Action } from '../../src/core/input.js';

Element.prototype.scrollIntoView = () => undefined; // not in jsdom

function setup() {
  const root = document.createElement('div');
  const focus = new FocusManager();
  focus.register(new FocusZone({ id: 'page', model: new ListModel({ orientation: 'vertical', getCount: () => 1 }) }));
  focus.focus('page', 0);
  return { root, focus, dialogs: createDialogService({ focus, root }) };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('search with a create row: collections are listed at once and the first row creates one named after the text', async () => {
  const { root, focus, dialogs } = setup();
  const run = jest.fn(async () => [{ key: 'c1', name: 'Marvel', collectionId: 'c1' }]);
  const promise = dialogs.search({ title: 'Add', run, minLength: 0, createLabel: (name) => `Create ${name}` });
  await tick();
  expect(run).toHaveBeenCalledWith('');
  expect(root.querySelectorAll('.choice-list .choice')).toHaveLength(1); // nothing typed: no create row
  const input = root.querySelector('input');
  input.value = 'Mar';
  input.dispatchEvent(new Event('input'));
  await new Promise((resolve) => setTimeout(resolve, 350));
  const rows = root.querySelectorAll('.choice-list .choice');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toBe('Create Mar');
  focus.handle(Action.DOWN);
  focus.handle(Action.ENTER);
  expect(await promise).toEqual({ create: true, name: 'Mar' });
});

test('edit box: rename and mark titles to take out; Back cancels', async () => {
  const { root, focus, dialogs } = setup();
  const options = { title: 'Edit', name: 'Marvel', nameLabel: 'Name', items: [{ key: 'a', name: 'A' }, { key: 'b', name: 'B' }], saveLabel: 'Save', cancelLabel: 'Cancel' };
  const promise = dialogs.editCollection(options);
  expect(focus.activeId).toBe('dialog');
  expect(root.querySelectorAll('.edit-item')).toHaveLength(2);
  root.querySelector('input').value = 'MCU';
  focus.handle(Action.ENTER); // first title: marked
  expect(root.querySelectorAll('.edit-item.removed')).toHaveLength(1);
  focus.handle(Action.DOWN);
  focus.handle(Action.DOWN);
  focus.handle(Action.DOWN); // Cancel, Save
  focus.handle(Action.ENTER);
  expect(await promise).toEqual({ name: 'MCU', remove: ['a'] });
  const second = dialogs.editCollection(options);
  dialogs.dismiss();
  expect(await second).toBeNull();
});
