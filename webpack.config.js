const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const pkg = require('./package.json');
const devProxy = require('./scripts/dev-proxy');
const devMediaProxy = require('./scripts/dev-media-proxy');
const { PlatformIconsPlugin, LOGO } = require('./scripts/platform-icons');

/**
 * One build per platform: `--env platform=<name>` (default tizen) picks platforms/<name>/: its adapter (imported by the app as `@platform`,
 * see src/platform/contract.js) and its build.js (files to copy next to the app, page options). The app code is the same for all.
 */
function platformOf(env) {
  const name = String(env.platform || process.env.PLATFORM || 'tizen');
  const dir = path.resolve(__dirname, 'platforms', name);
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(path.join(dir, 'platform.js'))) throw new Error(`Unknown platform "${name}": no platforms/${name}/platform.js`);
  const build = fs.existsSync(path.join(dir, 'build.js')) ? require(path.join(dir, 'build.js')) : {};
  return { name, dir, build };
}

module.exports = (env = {}, argv = {}) => {
  const isProd = argv.mode === 'production';
  const target = platformOf(env);
  // Package variants (release workflow): `--env youtube` the Tizen trailer service, `--env autoupdate` the updates from the app itself
  // (only the "_autoupdate" packages of Tizen and webOS; the store packages never load code from outside the package).
  const flag = (name) => Boolean(env[name] && env[name] !== 'false' && env[name] !== '0');
  const youtube = flag('youtube');
  const autoupdate = flag('autoupdate');
  const channel = `${target.name}${youtube ? '_youtube' : ''}`; // the online build an "_autoupdate" package follows (same variant)
  const buildOptions = { isProd, version: pkg.version, youtube, autoupdate };

  return {
    mode: isProd ? 'production' : 'development',
    entry: ['./src/boot/publicPath.js', './src/main.js'],
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'js/[name].js',
      chunkFilename: 'js/[name].js',
      publicPath: '',
      clean: true,
    },
    devtool: isProd ? false : 'cheap-module-source-map',
    resolve: { alias: { '@platform$': path.join(target.dir, 'platform.js') } },
    module: {
      rules: [
        { test: /\.js$/, exclude: /node_modules/, use: 'babel-loader' },
        // logo.svg is imported as text (the top bar and the screensaver put it in the page).
        { test: /\.svg$/, type: 'asset/source' },
        {
          test: /\.scss$/,
          use: [
            // Always an external stylesheet (<link>), also in dev: the prod build works on the TV,
            // while the inline <style> tags injected by style-loader were not applied there.
            MiniCssExtractPlugin.loader,
            { loader: 'css-loader', options: { url: false } },
            'postcss-loader',
            'sass-loader',
          ],
        },
      ],
    },
    plugins: [
      new webpack.DefinePlugin({
        __DEV__: JSON.stringify(!isProd),
        __APP_VERSION__: JSON.stringify(pkg.version),
        __PLATFORM__: JSON.stringify(target.name),
        __YOUTUBE__: JSON.stringify(youtube),
        __AUTOUPDATE__: JSON.stringify(autoupdate),
        __UPDATE_CHANNEL__: JSON.stringify(channel),
        // hls.js / mpegts.js in the build: development, and the platforms that play HLS / MPEG-TS with them (build.js `demux`).
        __JS_DEMUX__: JSON.stringify(!isProd || Boolean(target.build.demux)),
      }),
      new HtmlWebpackPlugin({
        template: 'src/index.html',
        inject: false, // the loader at the end of the page adds the script and the stylesheet (the package's, or a newer build's)
        scriptLoading: 'blocking',
        // Options of the page template given by the platform (Tizen: webapis.js, which only exists inside a packaged app).
        includeWebapis: false,
        appVersion: pkg.version,
        autoupdate,
        logoSvg: fs.readFileSync(LOGO, 'utf8'), // the start screen shows the logo while the app loads
        ...(target.build.html ? target.build.html(buildOptions) : {}),
      }),
      new CopyPlugin({
        patterns: [
          // Inter (SIL Open Font License), shipped with the app: the same letters on the TV and on a PC (the TV has no "Netflix Sans" and
          // fell back to whatever it had). Latin and Latin-extended, the four weights the stylesheet uses.
          ...[400, 600, 700, 800].flatMap((weight) =>
            ['latin', 'latin-ext'].map((subset) => ({ from: `node_modules/@fontsource/inter/files/inter-${subset}-${weight}-normal.woff2`, to: `fonts/inter-${subset}-${weight}.woff2` })),
          ),
          // The platform's own files (Tizen: config.xml, icon, the YouTube service).
          ...(target.build.copy ? target.build.copy(buildOptions) : []),
        ],
      }),
      // The platform's icons, drawn from logo.svg (no pictures kept in platforms/).
      new PlatformIconsPlugin(target.build.icons),
      new MiniCssExtractPlugin({ filename: 'css/[name].css' }),
    ],
    // The TV runs Chromium ~76: the minifier must not write `??` / `?.` (it rewrites `x == null ? a : x` into `x ?? a` by default).
    optimization: {
      splitChunks: false,
      runtimeChunk: false,
      minimizeOptions: { javascript: { ecma: 2019, compress: { passes: 2, ecma: 2019 }, format: { ecma: 2019 } } },
    },
    performance: { hints: false },
    devServer: {
      host: '0.0.0.0',
      port: Number(env.port) || 8080,
      allowedHosts: 'all',
      hot: true,
      client: { overlay: true },
      setupMiddlewares: (middlewares) => {
        // Same-origin proxy for provider API calls (avoids CORS while developing).
        middlewares.unshift({ name: 'xtream-dev-proxy', path: '/__proxy', middleware: devProxy });
        // Video streams (Range, redirects, HLS playlists rewritten) for the desktop player.
        middlewares.unshift({ name: 'xtream-dev-media-proxy', path: '/__media', middleware: devMediaProxy });
        return middlewares;
      },
    },
  };
};
