import js from '@eslint/js';
import globals from 'globals';

const appGlobals = {
  __DEV__: 'readonly',
  __APP_VERSION__: 'readonly',
  tizen: 'readonly',
  webapis: 'readonly',
  __PLATFORM__: 'readonly',
  __JS_DEMUX__: 'readonly',
};

export default [
  // platforms/tizen/youtube/service.js is a template for the on-TV service (placeholders filled in by webpack), not app code.
  // platforms/android: its own node_modules (Capacitor) and the Android project (with a copy of the built app in its assets).
  { ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**', 'platforms/tizen/youtube/service.js', 'platforms/android/node_modules/**', 'platforms/android/android/**', 'release/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'platforms/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...appGlobals },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // The target TV runs Chromium 76: avoid APIs added later.
      'no-restricted-properties': [
        'error',
        { property: 'replaceAll', message: 'String.replaceAll needs Chromium 85+.' },
        { property: 'at', message: 'Array/String.at needs Chromium 92+.' },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'structuredClone', message: 'structuredClone needs Chromium 98+.' },
      ],
    },
  },
  {
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.jest, ...globals.node, ...appGlobals },
    },
  },
  {
    files: ['test/setup.js', 'test/svgTransform.js', 'platforms/*/build.js', 'platforms/*/electron/**/*.js', 'webpack.config.js', 'babel.config.js', 'postcss.config.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
];
