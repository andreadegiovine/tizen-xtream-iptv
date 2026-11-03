import { createQrSvg, createCodePrompt } from '../../src/ui/components/codePrompt.js';

test('QR code: svg with a quiet zone and dark modules', () => {
  const svg = createQrSvg('https://trakt.tv/activate');
  expect(svg.getAttribute('viewBox')).toBe('0 0 29 29'); // 25 modules + 2 × 2
  expect(svg.querySelector('path').getAttribute('d').length).toBeGreaterThan(100);
});

test('prompt order: QR, address, description, code', () => {
  const el = createCodePrompt({ url: 'https://trakt.tv/activate', description: 'Enter the code', code: 'AB12CD34' });
  expect(Array.from(el.children).map((c) => c.className)).toEqual(['code-qr', 'code-url', 'code-text', 'code-value']);
  expect(el.querySelector('.code-value').textContent).toBe('AB12CD34');
  expect(el.querySelector('.code-url').textContent).toBe('https://trakt.tv/activate');
});
