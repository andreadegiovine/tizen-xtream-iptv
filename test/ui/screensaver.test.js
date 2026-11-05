import { createScreensaver, randomSpot } from '../../src/ui/screensaver.js';
import { applyTextSize } from '../../src/core/textSize.js';
import { rotatePoster, rotatingCount, tickRotation } from '../../src/ui/components/imageRotator.js';
import { SettingsService } from '../../src/services/settings.js';
import { openAppDb } from '../../src/db/appDb.js';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const key = () => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 13, bubbles: true, cancelable: true }));

test('screensaver: starts after the idle time, moves, and the first key ends it without reaching the app', () => {
  const saver = createScreensaver({ idleMs: 1000, moveMs: 100 });
  const seen = jest.fn();
  document.addEventListener('keydown', seen);
  jest.advanceTimersByTime(999);
  expect(saver.isActive()).toBe(false);
  jest.advanceTimersByTime(2);
  expect(saver.isActive()).toBe(true);
  expect(document.querySelector('.screensaver .screensaver-mark svg')).not.toBeNull();
  const before = document.querySelector('.screensaver-mark').style.transform;
  jest.advanceTimersByTime(100);
  expect(document.querySelector('.screensaver-mark').style.transform).toMatch(/translate\(\d+px, \d+px\) scale\(0?\.\d+|1\)/);
  key();
  expect(saver.isActive()).toBe(false);
  expect(seen).not.toHaveBeenCalled(); // swallowed
  key();
  expect(seen).toHaveBeenCalledTimes(1);
  expect(before).toBeDefined();
  document.removeEventListener('keydown', seen);
  saver.destroy();
});

test('screensaver: activity postpones it; disabled or suspended it never starts', () => {
  const saver = createScreensaver({ idleMs: 1000 });
  jest.advanceTimersByTime(800);
  key();
  jest.advanceTimersByTime(800);
  expect(saver.isActive()).toBe(false);
  saver.setSuspended(true);
  jest.advanceTimersByTime(5000);
  expect(saver.isActive()).toBe(false);
  saver.setSuspended(false);
  saver.setMinutes(0);
  jest.advanceTimersByTime(5000);
  expect(saver.isActive()).toBe(false);
  saver.setMinutes(1);
  jest.advanceTimersByTime(59999);
  expect(saver.isActive()).toBe(false);
  jest.advanceTimersByTime(2);
  expect(saver.isActive()).toBe(true);
  saver.setMinutes(0);
  expect(saver.isActive()).toBe(false); // switched off while showing
  saver.destroy();
  expect(document.querySelector('.screensaver')).toBeNull();
});

test('random spot stays inside the screen', () => {
  for (let i = 0; i < 20; i += 1) {
    const s = randomSpot(1920, 1080);
    expect(s.left + s.size).toBeLessThanOrEqual(1920);
    expect(s.top + s.size).toBeLessThanOrEqual(1080);
  }
});

test('text size: 75 / 100 / 125 % set the font of <html>; anything else is 100 %', () => {
  const root = document.createElement('html');
  applyTextSize(75, root);
  expect(root.style.fontSize).toBe('12px');
  applyTextSize(125, root);
  expect(root.style.fontSize).toBe('20px');
  applyTextSize(90, root);
  expect(root.style.fontSize).toBe('16px');
});

test('settings: text size 100 and screensaver on by default; invalid values fall back', async () => {
  jest.useRealTimers();
  const s = new SettingsService(await openAppDb('settings-text-size'));
  expect(await s.get()).toMatchObject({ textSize: 100, screensaver: 15 });
  expect(await s.update({ textSize: 125, screensaver: 5 })).toMatchObject({ textSize: 125, screensaver: 5 });
  expect((await s.update({ screensaver: 7 })).screensaver).toBe(15); // not in the list
  expect((await s.update({ screensaver: false })).screensaver).toBe(0); // old on / off value
  expect((await s.update({ screensaver: true })).screensaver).toBe(15);
  expect((await s.update({ textSize: 99 })).textSize).toBe(100);
});

test('card posters rotate on a shared clock; cards that left the page drop out', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const picks = [0.9, 0];
  rotatePoster({ host, urls: ['a', 'b', 'c'], random: () => picks.shift(), preload: (url, done) => done(true) });
  expect(rotatingCount()).toBe(1);
  jest.advanceTimersByTime(8000 + 2000);
  expect(host.querySelectorAll('.rot-layer.visible')).toHaveLength(1);
  expect(host.querySelector('.rot-layer.visible').style.backgroundImage).toContain('c');
  host.remove();
  tickRotation();
  expect(rotatingCount()).toBe(0);
});
