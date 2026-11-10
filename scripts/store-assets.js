#!/usr/bin/env node
/*
 * Store images drawn from logo.svg (npm run store-assets): Samsung Seller Office icons (512x423, and the 1920x1080 tile with its separate
 * logo and background) in platforms/tizen/store/, the LG Seller Lounge icon (400x400) in platforms/webos/store/. The screenshots come
 * from `npm run screenshots`.
 */
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const ROOT = path.resolve(__dirname, '..');
const logo = fs.readFileSync(path.join(ROOT, 'logo.svg'), 'utf8');
const inner = logo.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const mark = inner.replace(/<rect width="1024" height="1024" fill="#0c0c12"\/>/, ''); // the X without its square background
const BG = '#0c0c12';

const png = (svg, width) => new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } }).render().asPng();
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  console.log(`${path.relative(ROOT, file)}: ${Math.round(data.length / 1024)} kB`);
};

/** The logo (the X and the name) on a dark gradient, `w` x `h`, the X `size` px tall. */
function tile(w, h, size, { withName = true, background = true } = {}) {
  const x = withName ? w / 2 - size * 1.95 : (w - size) / 2; // the X and the name centred together
  const y = (h - size) / 2;
  const name = withName
    ? `<text x="${x + size * 1.12}" y="${h / 2 + size * 0.16}" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${size * 0.42}" fill="#ffffff">XTREAM <tspan fill="#e5202f">IPTV</tspan></text>`
    : '';
  const bg = background ? `<defs><radialGradient id="bg" cx="50%" cy="45%" r="75%"><stop offset="0" stop-color="#2a0a10"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs><rect width="${w}" height="${h}" fill="url(#bg)"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bg}<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 1024 1024">${mark}</svg>${name}</svg>`;
}

const tizen = path.join(ROOT, 'platforms/tizen/store');
const webos = path.join(ROOT, 'platforms/webos/store');
write(path.join(tizen, 'icon-512x423.png'), png(tile(512, 423, 210, { withName: false }), 512));
write(path.join(tizen, 'icon-1920x1080.png'), png(tile(1920, 1080, 360), 1920));
write(path.join(tizen, 'icon-1920x1080-logo.png'), png(tile(1920, 1080, 360, { background: false }), 1920));
write(path.join(tizen, 'icon-1920x1080-background.png'), png(tile(1920, 1080, 0, { withName: false }).replace(/<svg x=[^]*?<\/svg><\/svg>$/, '</svg>'), 1920));
write(path.join(webos, 'icon-400x400.png'), png(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 1024 1024">${inner}</svg>`, 400));
write(path.join(webos, 'icon-80x80.png'), png(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 1024 1024">${inner}</svg>`, 80));
write(path.join(webos, 'icon-130x130.png'), png(`<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130" viewBox="0 0 1024 1024">${inner}</svg>`, 130));
