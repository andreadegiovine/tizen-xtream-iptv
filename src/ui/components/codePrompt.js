import qrcode from 'qrcode-generator';
import { h } from '../dom.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** QR code of `text` as an inline SVG (dark modules on a white square with a quiet zone), or null when it does not fit. */
export function createQrSvg(text, { margin = 2 } = {}) {
  let qr;
  try {
    qr = qrcode(0, 'M');
    qr.addData(String(text));
    qr.make();
  } catch {
    return null;
  }
  const count = qr.getModuleCount();
  const size = count + margin * 2;
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) path += `M${col + margin} ${row + margin}h1v1h-1z`;
    }
  }
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('class', 'qr');
  const back = document.createElementNS(SVG_NS, 'rect');
  back.setAttribute('width', String(size));
  back.setAttribute('height', String(size));
  back.setAttribute('fill', '#fff');
  const modules = document.createElementNS(SVG_NS, 'path');
  modules.setAttribute('d', path);
  modules.setAttribute('fill', '#000');
  svg.append(back, modules);
  return svg;
}

/**
 * Body of a "enter this code on the website" dialog: QR code of the site (centred), its address, what is going
 * to happen (left aligned) and the code to type, large and centred.
 */
export function createCodePrompt({ url, description, code }) {
  const qr = createQrSvg(url);
  return h('div', { class: 'code-prompt' }, qr ? h('div', { class: 'code-qr' }, qr) : null, h('p', { class: 'code-url', text: url }), h('p', { class: 'code-text', text: description }), h('p', { class: 'code-value', text: code }));
}
