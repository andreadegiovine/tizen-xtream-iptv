const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const pkg = require('./package.json');
const devProxy = require('./scripts/dev-proxy');

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
        // webapis.js only exists inside a packaged Tizen app (or when explicitly requested).
        includeWebapis: isProd || Boolean(env.webapis),
      }),
      new CopyPlugin({
        patterns: [
          {
            from: 'tizen/config.xml',
            to: 'config.xml',
            transform: (content) => content.toString().replace(/__VERSION__/g, pkg.version),
          },
          { from: 'tizen/icon.png', to: 'icon.png' },
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
    optimization: { splitChunks: false, runtimeChunk: false },
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
        return middlewares;
      },
    },
  };
};
