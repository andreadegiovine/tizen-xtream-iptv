/*
 * The app icons of a platform, drawn at build time from logo.svg (repository root): no picture is kept in platforms/<name>/. The
 * platform's build.js lists them as [{ file, size }] (`icons`); webpack.config.js adds them to the build with this plugin.
 */
const fs = require('fs');
const path = require('path');

const LOGO = path.resolve(__dirname, '..', 'logo.svg');

/** PNG (Buffer) of an SVG at `size` x `size` pixels. */
function renderPng(svg, size) {
  const { Resvg } = require('@resvg/resvg-js'); // loaded only when a build needs icons
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
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
        this.icons.forEach(({ file, size }) => compilation.emitAsset(file, new RawSource(renderPng(svg, size))));
      });
    });
  }
}

module.exports = { PlatformIconsPlugin, renderPng, LOGO };
