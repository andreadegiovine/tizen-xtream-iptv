import { icon, iconNames } from '../../src/ui/icons.js';

test('every icon renders an svg with a path', () => {
  expect(iconNames.length).toBeGreaterThan(10);
  iconNames.forEach((name) => {
    const svg = icon(name);
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.querySelector('path').getAttribute('d').length).toBeGreaterThan(10);
  });
});

test('unknown icons fail loudly and extra classes are kept', () => {
  expect(() => icon('nope')).toThrow(/Unknown icon/);
  expect(icon('star', 'big').getAttribute('class')).toBe('icon icon-star big');
});
