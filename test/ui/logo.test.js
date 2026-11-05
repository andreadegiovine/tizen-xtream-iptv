import { createLogo } from '../../src/ui/components/logo.js';

test('the logo holds the mark and is named for screen readers', () => {
  const logo = createLogo();
  expect(logo.querySelector('.logo-mark svg')).not.toBeNull();
  expect(logo.getAttribute('aria-label')).toBe('Xtream IPTV');
});
