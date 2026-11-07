import { FocusManager } from '../../src/ui/focus/FocusManager.js';
import { createForm, formModel, framedPage } from '../../src/ui/components/formPage.js';
import { createField } from '../../src/ui/components/field.js';
import { Action } from '../../src/core/input.js';
import { Dir } from '../../src/ui/focus/models.js';

Element.prototype.scrollIntoView = () => undefined;

test('formModel: fields one under the other, Confirm / Cancel on one line, Down from the last field lands on Confirm', () => {
  const model = formModel({ fieldCount: 4, actionCount: 2 });
  expect(model.getCount()).toBe(6);
  expect(model.navigate(Dir.DOWN, 0)).toEqual({ type: 'move', index: 1 });
  expect(model.navigate(Dir.DOWN, 3)).toEqual({ type: 'move', index: 4 }); // Confirm
  expect(model.navigate(Dir.RIGHT, 4)).toEqual({ type: 'move', index: 5 }); // Cancel
  expect(model.navigate(Dir.LEFT, 5)).toEqual({ type: 'move', index: 4 });
  expect(model.navigate(Dir.LEFT, 4).type).toBe('exit');
  expect(model.navigate(Dir.UP, 5)).toEqual({ type: 'move', index: 3 }); // back to the last field
  expect(model.navigate(Dir.DOWN, 5).type).toBe('exit');
  expect(model.navigate(Dir.UP, 0).type).toBe('exit');
  expect(model.navigate(Dir.RIGHT, 1).type).toBe('exit'); // fields have no horizontal moves
});

test('form: Enter in a field moves to the next one, the last one to Confirm; the actions run on OK', () => {
  const focus = new FocusManager();
  const run = jest.fn();
  const cancel = jest.fn();
  const form = createForm({ id: 'f', focus, fields: [{ label: 'A' }, { label: 'B' }], actions: [{ label: 'Ok', primary: true, run }, { label: 'No', run: cancel }] });
  focus.register(form.zone);
  document.body.appendChild(form.el);
  focus.focus('f', 0);
  form.fields[0].input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true, cancelable: true }));
  expect(focus.active.index).toBe(1);
  form.fields[1].input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 65376, bubbles: true, cancelable: true }));
  expect(focus.active.index).toBe(2);
  expect(form.actionButtons[0].classList.contains('focused')).toBe(true);
  focus.handle(Action.ENTER);
  expect(run).toHaveBeenCalledTimes(1);
  focus.handle(Action.RIGHT);
  focus.handle(Action.ENTER);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(form.el.querySelectorAll('.form-actions .btn')).toHaveLength(2);
  form.el.remove();
});

test('field: label above the input, Done saves, Cancel restores, keys never reach the page', () => {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  const reset = document.createElement('button');
  const field = createField({ label: 'Key', placeholder: '—', onSubmit, onCancel, trailing: reset });
  expect(field.root).not.toBe(field.el); // a trailing button wraps the field
  expect(field.root.classList.contains('field-line')).toBe(true);
  expect(field.el.querySelector('.field-label').textContent).toBe('Key');
  field.setValue('abc');
  const seen = jest.fn();
  document.addEventListener('keydown', seen);
  document.body.appendChild(field.root);
  field.input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true, cancelable: true }));
  expect(onSubmit).toHaveBeenCalledWith('abc', expect.anything());
  field.input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 65385, bubbles: true, cancelable: true }));
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(seen).not.toHaveBeenCalled();
  document.removeEventListener('keydown', seen);
  field.root.remove();
  expect(createField({ label: 'x' }).root.classList.contains('field')).toBe(true);
});

test('field x: empties the field, or puts back its default value', () => {
  const plain = createField({ label: 'Key' });
  plain.setValue('abc');
  plain.clear();
  expect(plain.getValue()).toBe('');
  const withDefault = createField({ label: 'Similarity', defaultValue: '80' });
  withDefault.setValue('55');
  withDefault.clearEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(withDefault.getValue()).toBe('80');
});

test('framedPage: centred container for title and content', () => {
  const page = framedPage(document.createElement('h1'), document.createElement('div'));
  expect(page.className).toBe('page framed');
  expect(page.querySelector('.page-container').children).toHaveLength(2);
});

describe('search page and top bar', () => {
  const { createSearchPage } = require('../../src/ui/pages/searchPage.js');
  const { createTopbar, TOPBAR_ZONE } = require('../../src/ui/components/topbar.js');
  const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

  function makeCtx(history = ['batman', 'dune']) {
    const search = jest.fn(async () => []);
    const setSearchText = jest.fn();
    const added = [];
    const focus = new FocusManager();
    focus.register({ id: TOPBAR_ZONE, canFocus: () => true, count: 1, clamp: (i) => i, model: { getCount: () => 1, navigate: () => ({ type: 'exit' }) }, onFocus() {}, onBlur() {}, onActivate() {}, index: 0 });
    return { ctx: { focus, search: { search }, setSearchText, searchHistory: { list: async () => history, add: async (x) => added.push(x) }, active: { get: async () => null }, syncSearchLinks: jest.fn() }, search, setSearchText, added };
  }

  test('opens with the last searches, the typing placeholders replace them, an emptied field brings them back', async () => {
    const { ctx } = makeCtx();
    const page = createSearchPage(ctx, {});
    document.body.appendChild(page.el);
    page.mount();
    await tick();
    expect(page.el.querySelectorAll('.search-recent .row')).toHaveLength(2);
    expect(page.el.querySelector('.search-recent').style.display).toBe('');
    expect(ctx.focus.zones.has('searchRecent')).toBe(true);
    page.showSkeleton();
    expect(page.el.querySelector('.search-recent').style.display).toBe('none');
    expect(page.el.querySelector('.search-skeleton').style.display).toBe('');
    expect(ctx.focus.zones.has('searchRecent')).toBe(false);
    await page.showRecent();
    expect(page.el.querySelector('.search-skeleton').style.display).toBe('none');
    expect(page.el.querySelector('.search-recent').style.display).toBe('');
    page.destroy();
    page.el.remove();
  });

  test('Down / Done on the TV keyboard with the same text leaves the results, never the placeholders', async () => {
    const { ctx } = makeCtx();
    ctx.search.search = jest.fn(async () => [{ key: 'series:i1', type: 'series', name: 'Euphoria' }]);
    const page = createSearchPage(ctx, {});
    document.body.appendChild(page.el);
    page.mount();
    await tick();
    await page.setQuery('eup');
    await tick();
    const skeleton = page.el.querySelector('.search-skeleton');
    expect(skeleton.style.display).toBe('none');
    page.showSkeleton('eup'); // input event of the keyboard closing: same text
    expect(skeleton.style.display).toBe('none');
    page.showSkeleton(); // a caller that does not say the text: placeholders shown...
    await page.setQuery('eup'); // ...and the same query takes them away again
    expect(skeleton.style.display).toBe('none');
    expect(ctx.search.search).toHaveBeenCalledTimes(1);
    page.destroy();
    page.el.remove();
  });

  test('picking a recent search puts it in the field and runs it', async () => {
    const { ctx, search, setSearchText, added } = makeCtx();
    const page = createSearchPage(ctx, {});
    document.body.appendChild(page.el);
    page.mount();
    await tick();
    ctx.focus.focus('searchRecent', 1);
    ctx.focus.handle(Action.ENTER);
    await tick();
    expect(setSearchText).toHaveBeenCalledWith('dune');
    expect(added).toContain('dune');
    expect(search).toHaveBeenCalledWith('dune', expect.anything());
    page.destroy();
    page.el.remove();
  });

  test('no history: nothing to show', async () => {
    const { ctx } = makeCtx([]);
    const page = createSearchPage(ctx, {});
    page.mount();
    await tick();
    expect(page.el.querySelector('.search-recent').style.display).toBe('none');
    page.destroy();
  });

  test('the search icon opens the search page at once; emptying the field asks for the recent searches', () => {
    const onOpen = jest.fn();
    const onCleared = jest.fn();
    const onTyping = jest.fn();
    const bar = createTopbar({ focus: new FocusManager() }, { onOpen, onCleared, onTyping });
    bar.openSearch();
    expect(onOpen).toHaveBeenCalledTimes(1);
    bar.setQuery('abc');
    const input = bar.el.querySelector('input');
    expect(input.value).toBe('abc');
    input.value = 'ab';
    input.dispatchEvent(new Event('input'));
    expect(onTyping).toHaveBeenCalledTimes(1);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    expect(onCleared).toHaveBeenCalledTimes(1);
    bar.closeSearch({ notify: false });
  });
});

test('formModel with the x of the fields: Right from a field to its x, Left back, Up / Down as from the field', () => {
  const model = formModel({ fieldCount: 3, actionCount: 2, clearable: true });
  expect(model.getCount()).toBe(8);
  expect(model.navigate(Dir.RIGHT, 1)).toEqual({ type: 'move', index: 6 }); // x of field 1
  expect(model.navigate(Dir.LEFT, 6)).toEqual({ type: 'move', index: 1 });
  expect(model.navigate(Dir.RIGHT, 6).type).toBe('exit');
  expect(model.navigate(Dir.DOWN, 6)).toEqual({ type: 'move', index: 2 });
  expect(model.navigate(Dir.UP, 6)).toEqual({ type: 'move', index: 0 });
  expect(model.navigate(Dir.DOWN, 7)).toEqual({ type: 'move', index: 3 }); // x of the last field: down to Confirm
  expect(model.navigate(Dir.RIGHT, 3)).toEqual({ type: 'move', index: 4 }); // actions unchanged
});

test('the x of a field: inside the box, shown with the focus, OK empties the field and opens the keyboard', async () => {
  const focus = new FocusManager();
  const form = createForm({ id: 'g', focus, fields: [{ label: 'URL' }, { label: 'User' }], actions: [{ label: 'Ok', run: () => undefined }] });
  focus.register(form.zone);
  document.body.appendChild(form.el);
  const [url] = form.fields;
  expect(url.el.contains(url.clearEl)).toBe(true);
  url.setValue('http://old');
  focus.focus('g', 0);
  focus.handle(Action.RIGHT);
  expect(url.clearEl.classList.contains('focused')).toBe(true);
  await Promise.resolve();
  expect(url.el.classList.contains('clearing')).toBe(true); // the box stays highlighted
  focus.handle(Action.ENTER);
  expect(url.getValue()).toBe('');
  expect(document.activeElement).toBe(url.input); // keyboard
  url.input.blur();
  focus.handle(Action.LEFT);
  expect(url.el.classList.contains('focused')).toBe(true);
  url.setValue('x');
  url.clearEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(url.getValue()).toBe('');
  expect(createField({ label: 'n', clearable: false }).clearEl).toBeNull();
  form.el.remove();
});
