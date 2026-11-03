import js from '@eslint/js';
import globals from 'globals';

const appGlobals = {
  __DEV__: 'readonly',
  __APP_VERSION__: 'readonly',
  tizen: 'readonly',
  webapis: 'readonly',
};

export default [
  // tizen/youtube/service.js is a template for the on-TV service (placeholders filled in by webpack), not app code.
  { ignores: ['dist/**', 'build/**', 'coverage/**', 'node_modules/**', 'tizen/youtube/service.js'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
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
    files: ['test/setup.js', 'webpack.config.js', 'babel.config.js', 'postcss.config.js', 'scripts/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
];
