// jsdom does not expose structuredClone, which fake-indexeddb relies on.
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (value) =>
    value === undefined ? value : JSON.parse(JSON.stringify(value));
}
require('fake-indexeddb/auto');
// Downloads that fail or come back empty are tried again after a pause: no waiting in tests.
require('../src/services/catalogSync.js').retryPolicy.delays = [0, 0];
