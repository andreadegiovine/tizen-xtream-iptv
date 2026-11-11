import { createField } from '../../src/ui/atoms/field.js';

describe('field and the on-screen keyboard', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    document.body.className = '';
  });

  test('the keyboard shows Done, not Next', () => {
    const field = createField({ label: 'TMDB' });
    expect(field.input.getAttribute('enterkeyhint')).toBe('done');
  });

  test('"Next" of a keyboard that moves to the following field saves the value and closes the keyboard', async () => {
    const saved = [];
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v) });
    const b = createField({ label: 'B' });
    document.body.append(a.root, b.root);
    a.input.focus();
    a.input.value = 'key123';
    b.input.focus(); // what Next does
    expect(saved).toEqual(['key123']);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(document.activeElement).not.toBe(b.input);
  });

  test('Enter saves once', () => {
    const saved = [];
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v) });
    document.body.append(a.root);
    a.input.focus();
    a.input.value = 'x';
    a.input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true }));
    expect(saved).toEqual(['x']);
  });

  test('with the pointer, a click on another field keeps it', () => {
    document.body.classList.add('pointer-mode');
    const saved = [];
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v) });
    const b = createField({ label: 'B' });
    document.body.append(a.root, b.root);
    a.input.focus();
    b.input.focus();
    expect(saved).toEqual([]);
    expect(document.activeElement).toBe(b.input);
  });

  test('leaving the field saves a changed value, once, and nothing when it did not change', () => {
    const saved = [];
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v) });
    document.body.append(a.root);
    a.setValue('old');
    a.input.focus();
    a.input.blur();
    expect(saved).toEqual([]);
    a.input.focus();
    a.input.value = 'new';
    a.input.blur(); // the keyboard closed with Back, a click elsewhere...
    expect(saved).toEqual(['new']);
    a.input.focus();
    a.input.blur();
    expect(saved).toEqual(['new']);
  });

  test('Cancel does not save on its blur; onLeave replaces onSubmit when leaving', () => {
    const saved = [];
    const left = [];
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v), onLeave: (v) => left.push(v), onCancel: () => a.setValue('stored') });
    document.body.append(a.root);
    a.input.focus();
    a.input.value = 'typed';
    a.input.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 65385, bubbles: true }));
    expect(saved).toEqual([]);
    expect(left).toEqual([]);
    expect(a.getValue()).toBe('stored');
    a.input.focus();
    a.input.value = 'other';
    a.input.blur();
    expect(left).toEqual(['other']);
    expect(saved).toEqual([]);
  });
});

describe('leaving with the remote, cancelling with Back', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });
  const key = (target, keyCode) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'keyCode', { get: () => keyCode });
    target.dispatchEvent(event);
    return event;
  };

  test('Up / Down save the typing and the key reaches the app (the focus moves)', () => {
    const saved = [];
    const reached = [];
    document.addEventListener('keydown', (e) => reached.push(e.keyCode));
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v) });
    document.body.append(a.root);
    a.setValue('old');
    a.input.focus();
    a.input.value = 'typed';
    key(a.input, 40);
    expect(saved).toEqual(['typed']);
    expect(document.activeElement).not.toBe(a.input);
    expect(reached).toContain(40);
  });

  test('Back / Esc cancel: the value before the typing comes back, nothing saved, the app does not go back', () => {
    const saved = [];
    const cancelled = jest.fn();
    const reached = [];
    document.addEventListener('keydown', (e) => reached.push(e.keyCode));
    const a = createField({ label: 'A', onSubmit: (v) => saved.push(v), onCancel: cancelled });
    document.body.append(a.root);
    a.setValue('old');
    a.input.focus();
    a.input.value = 'typed';
    key(a.input, 27);
    expect(a.getValue()).toBe('old');
    expect(saved).toEqual([]);
    expect(cancelled).toHaveBeenCalled();
    expect(reached).not.toContain(27);
  });

  test('Backspace deletes, it does not cancel; Left / Right stay in the text', () => {
    const cancelled = jest.fn();
    const a = createField({ label: 'A', onCancel: cancelled });
    document.body.append(a.root);
    a.input.focus();
    key(a.input, 8);
    key(a.input, 37);
    expect(cancelled).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(a.input);
  });
});
