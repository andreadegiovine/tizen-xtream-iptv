import { cssUrl } from '../../src/ui/cssUrl.js';

test('addresses are quoted so that they cannot break the CSS rule', () => {
  expect(cssUrl('http://a/b.jpg')).toBe('url("http://a/b.jpg")');
  expect(cssUrl('http://a/"x").jpg')).toBe('url("http://a/\\"x\\").jpg")');
  expect(cssUrl('http://a/b\\c\n.jpg')).toBe('url("http://a/b\\\\c.jpg")');
  expect(cssUrl(null)).toBe('url("")');
});
