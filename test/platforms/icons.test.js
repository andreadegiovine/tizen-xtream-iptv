import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const { renderPng, LOGO } = require('../../scripts/platform-icons.js');

test('the platform icons are drawn from logo.svg (no picture is kept in platforms/)', () => {
  const svg = fs.readFileSync(LOGO, 'utf8');
  const png = renderPng(svg, 80);
  expect(png.slice(1, 4).toString()).toBe('PNG');
  expect(png.readUInt32BE(16)).toBe(80); // width in the IHDR chunk
  expect(png.readUInt32BE(20)).toBe(80);
  fs.readdirSync(path.join(root, 'platforms')).forEach((name) => {
    const files = fs.readdirSync(path.join(root, 'platforms', name));
    expect([name, files.filter((file) => /\.(png|jpe?g)$/i.test(file))]).toEqual([name, []]);
    const build = require(path.join(root, 'platforms', name, 'build.js'));
    expect(Array.isArray(build.icons) && build.icons.length > 0).toBe(true);
  });
});
