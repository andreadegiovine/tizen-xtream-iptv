import fs from 'fs';
import path from 'path';
import { contractErrors, withDefaults, PLATFORM_API, createNoDiagnosticPlayer } from '../../src/platform/contract.js';
import { platform } from '../../src/platform/index.js';
import { KEY_MAP, Action } from '../../src/core/input.js';

const root = path.resolve(__dirname, '../../platforms');
const names = fs.readdirSync(root).filter((name) => fs.existsSync(path.join(root, name, 'platform.js')));

test('every platform folder has an adapter that keeps to the contract', () => {
  expect(names).toContain('tizen');
  names.forEach((name) => {
    const adapter = require(path.join(root, name, 'platform.js')).default;
    expect([name, contractErrors(adapter)]).toEqual([name, []]);
    expect(adapter.id).toBe(name);
  });
});

test('a missing entry is taken from a plain browser; the app sees every entry of the contract', async () => {
  const filled = withDefaults({ id: 'x' }, { createDefaultEngine: () => 'html5' });
  PLATFORM_API.forEach((key) => expect(filled[key]).not.toBeUndefined());
  expect(filled.createEngine()).toBe('html5');
  expect(filled.createTrailerEngine).toBeNull(); // the trailer opens in YouTube
  expect(await filled.display({})).toBeNull();
  const events = [];
  createNoDiagnosticPlayer().play('http://x', { onEvent: (m) => events.push(m) });
  expect(events).toHaveLength(1);
  expect(contractErrors({ id: 'x', exit: 'no', other: 1 })).toEqual(['exit', 'unknown: other']);
});

test('the build platform (Tizen in the tests) adds its remote keys to the common ones', () => {
  expect(platform.id).toBe('tizen');
  expect(KEY_MAP[10009]).toBe(Action.BACK); // Samsung Back
  expect(KEY_MAP[427]).toBe(Action.CHANNEL_UP);
  expect(KEY_MAP[37]).toBe(Action.LEFT); // common
  expect(KEY_MAP[415]).toBe(Action.PLAY);
});
