/*
 * The app icons of a platform, drawn at build time from logo.svg (repository root): no picture is kept in platforms/<name>/. The
 * platform's build.js lists them as [{ file, size }] (square) or [{ file, width, height }] (a banner: the logo in the middle of a
 * background of its colour) in `icons`; webpack.config.js adds them to the build with this plugin.
 */
const fs = require('fs');
const path = require('path');

const LOGO = path.resolve(__dirname, '..', 'logo.svg');

/** PNG (Buffer) of an SVG at `size` x `size` pixels. */
function renderPng(svg, size) {
  const { Resvg } = require('@resvg/resvg-js'); // loaded only when a build needs icons
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/** Background of the logo (its square), around it on a banner. */
const BANNER_BACKGROUND = '#0c0c12';

/** PNG of one icon of the list (see above). */
function renderIcon(svg, { size, width, height }) {
  if (!width || !height) return renderPng(svg, size);
  const side = Math.round(Math.min(width, height) * 0.9);
  const inner = svg.replace('<svg ', `<svg x="${Math.round((width - side) / 2)}" y="${Math.round((height - side) / 2)}" width="${side}" height="${side}" `);
  const banner = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${BANNER_BACKGROUND}"/>${inner}</svg>`;
  return renderPng(banner, width);
}

class PlatformIconsPlugin {
  constructor(icons, logo = LOGO) {
    this.icons = icons || [];
    this.logo = logo;
  }

  apply(compiler) {
    const { RawSource } = compiler.webpack.sources;
    compiler.hooks.thisCompilation.tap('PlatformIconsPlugin', (compilation) => {
      compilation.hooks.processAssets.tap({ name: 'PlatformIconsPlugin', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        if (!this.icons.length) return;
        compilation.fileDependencies.add(this.logo); // the dev server draws them again when the logo changes
        const svg = fs.readFileSync(this.logo, 'utf8');
        this.icons.forEach((icon) => compilation.emitAsset(icon.file, new RawSource(renderIcon(svg, icon))));
      });
    });
  }
}

module.exports = { PlatformIconsPlugin, renderPng, renderIcon, LOGO };
