import { InputService, Action, actionFromKeyCode } from '../../src/core/input.js';

function press(keyCode) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'keyCode', { value: keyCode });
  document.dispatchEvent(event);
  return event;
}

describe('InputService', () => {
  test('maps remote and desktop keys', () => {
    expect(actionFromKeyCode(10009)).toBe(Action.BACK);
    expect(actionFromKeyCode(27)).toBe(Action.BACK);
    expect(actionFromKeyCode(427)).toBe(Action.CHANNEL_UP);
    expect(actionFromKeyCode(999)).toBeNull();
  });

  test('emits actions and throttles held navigation keys', () => {
    let t = 1000;
    const service = new InputService(document, { minRepeatMs: 80, now: () => t });
    const seen = [];
    service.onAction((a) => seen.push(a));
    service.start();
    press(39);
    t += 10;
    press(39);
    t += 100;
    press(39);
    press(13);
    service.stop();
    expect(seen).toEqual([Action.RIGHT, Action.RIGHT, Action.ENTER]);
  });

  test('stays silent while a text field is focused', () => {
    const service = new InputService(document);
    const seen = [];
    service.onAction((a) => seen.push(a));
    service.start();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press(37);
    input.remove();
    service.stop();
    expect(seen).toEqual([]);
  });
});
