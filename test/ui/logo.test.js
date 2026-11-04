import fs from 'fs';
import path from 'path';
import { MARK, createLogo } from '../../src/ui/components/logo.js';

test('tizen/icon.svg is the same drawing as the top bar mark (square, no wordmark)', () => {
  const file = fs.readFileSync(path.join(__dirname, '../../tizen/icon.svg'), 'utf8').trim();
  expect(file).toBe(MARK.replace(' aria-hidden="true"', ''));
  expect(file).not.toMatch(/rx="224"|<text/);
});

test('the logo holds the mark and the name', () => {
  const logo = createLogo();
  expect(logo.querySelector('.logo-mark svg')).not.toBeNull();
  expect(logo.textContent).toContain('XTREAM');
});
