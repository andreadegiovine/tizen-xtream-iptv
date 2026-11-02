import { IS_DEV } from './env.js';

const MAX_ENTRIES = 500;
const buffer = [];
const listeners = new Set();

const MASKS = [
  [/(\/(?:movie|series|live|timeshift)\/)([^/\s?#]+)\/([^/\s?#]+)\//g, '$1***/***/'],
  [/([?&](?:username|password)(?:=|%3D))[^&\s#]*/gi, '$1***'],
];

/** Credentials appear inside stream URLs and API queries: never let them reach logs. */
export function maskSecrets(text) {
  return MASKS.reduce((out, [pattern, replacement]) => out.replace(pattern, replacement), String(text));
}

function stringify(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function push(level, args) {
  const message = maskSecrets(args.map(stringify).join(' '));
  const entry = { ts: Date.now(), level, message };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  listeners.forEach((fn) => fn(entry));
  if (IS_DEV && typeof console !== 'undefined') {
    (console[level] || console.log)(message);
  }
}

export const log = {
  debug: (...args) => push('debug', args),
  info: (...args) => push('info', args),
  warn: (...args) => push('warn', args),
  error: (...args) => push('error', args),
  entries: () => buffer.slice(),
  clear: () => {
    buffer.length = 0;
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
