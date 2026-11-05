const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const pkg = require('./package.json');
const devProxy = require('./scripts/dev-proxy');
const devMediaProxy = require('./scripts/dev-media-proxy');

const YOUTUBE_SERVICE_PORT = 8125; // keep in sync with src/services/youtubeEngine.js

module.exports = (env = {}, argv = {}) => {
  const isProd = argv.mode === 'production';

  return {
    mode: isProd ? 'production' : 'development',
    entry: './src/main.js',
    output: {
      path: path.resolve(__dirname, 'dist'),
      filename: 'js/[name].js',
      chunkFilename: 'js/[name].js',
      publicPath: '',
      clean: true,
    },
    devtool: isProd ? false : 'cheap-module-source-map',
    module: {
      rules: [
        { test: /\.js$/, exclude: /node_modules/, use: 'babel-loader' },
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
      }),
      new HtmlWebpackPlugin({
        template: 'src/index.html',
        inject: 'body',
        scriptLoading: 'blocking',
        // webapis.js only exists inside a packaged Tizen app.
        includeWebapis: isProd,
      }),
      new CopyPlugin({
        patterns: [
          {
            from: 'tizen/config.xml',
            to: 'config.xml',
            transform: (content) => content.toString().replace(/__VERSION__/g, pkg.version),
          },
          { from: 'tizen/icon.png', to: 'icon.png' },
          // Inter (SIL Open Font License), shipped with the app: the same letters on the TV and on a PC (the TV has no "Netflix Sans" and
          // fell back to whatever it had). Latin and Latin-extended, the four weights the stylesheet uses.
          ...[400, 600, 700, 800].flatMap((weight) =>
            ['latin', 'latin-ext'].map((subset) => ({ from: `node_modules/@fontsource/inter/files/inter-${subset}-${weight}-normal.woff2`, to: `fonts/inter-${subset}-${weight}.woff2` })),
          ),
          // YouTube player page: served by the on-TV service (service/service.js) and, for development, by the dev server.
          { from: 'tizen/youtube/player.html', to: 'yt-player.html' },
          {
            from: 'tizen/youtube/service.js',
            to: 'service/service.js',
            transform: (content) =>
              content
                .toString()
                .replace(/__PORT__/g, String(YOUTUBE_SERVICE_PORT))
                .replace('__PLAYER_HTML__', () => JSON.stringify(fs.readFileSync(path.resolve(__dirname, 'tizen/youtube/player.html'), 'utf8'))),
          },
        ],
      }),
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
