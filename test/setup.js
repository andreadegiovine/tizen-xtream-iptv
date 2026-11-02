// jsdom does not expose structuredClone, which fake-indexeddb relies on.
if (typeof globalThis.structuredClone === 'undefined') {
  globalThis.structuredClone = (value) =>
    value === undefined ? value : JSON.parse(JSON.stringify(value));
}
require('fake-indexeddb/auto');
