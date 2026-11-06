import { platform } from '../platform/index.js';

/** 1536 * 1024 * 1024 -> "1.5 GB" */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

/** "WIFI" / "wifi" / "ETHERNET" / "4g"... -> the kinds the UI has a word for, or '' */
export function connectionKind(raw) {
  const text = String(raw || '').toLowerCase();
  if (text === 'wifi' || text === 'wi-fi') return 'wifi';
  if (text.startsWith('ethernet')) return 'ethernet';
  if (text.startsWith('cell') || text === '2g' || text === '3g' || text === '4g' || text === '5g') return 'cellular';
  return '';
}

/**
 * Internet connection as far as the browser / firmware tell: { online, kind ('wifi' | 'ethernet' | 'cellular' | ''), effectiveType ('4g'...),
 * downlink (Mbit/s), rtt (ms) }. Quality fields are null when `navigator.connection` is not there.
 */
async function collectNetwork(env, hooks) {
  const nav = env.navigator || {};
  const conn = nav.connection || null;
  const type = await hooks.networkType(env);
  const online = type === 'NONE' ? false : nav.onLine !== false;
  const kind = connectionKind(type) || connectionKind(conn && conn.type);
  return {
    online,
    kind,
    effectiveType: (conn && conn.effectiveType) || null,
    downlink: conn && Number(conn.downlink) > 0 ? Number(conn.downlink) : null,
    rtt: conn && Number(conn.rtt) > 0 ? Number(conn.rtt) : null,
  };
}

/**
 * What the TV reports about itself, for the "Device" table. Every value can be missing (null) on browsers or
 * firmware that do not expose it: resolution (physical when the platform says so, plus the page's own size),
 * app memory (JS heap used / limit), storage used / quota of this app, and the RAM (used / total, see `memory`).
 * `hooks`: what the platform reads from the system (display, memory, networkType; see src/platform/contract.js).
 */
export async function collectDeviceInfo(env = globalThis, hooks = platform) {
  const screen = env.screen || {};
  const panel = (await hooks.display(env)) || (screen.width ? { width: screen.width, height: screen.height } : null);
  const page = env.innerWidth ? { width: env.innerWidth, height: env.innerHeight } : null;
  const heap = env.performance && env.performance.memory ? { used: env.performance.memory.usedJSHeapSize, limit: env.performance.memory.jsHeapSizeLimit } : null;
  let storage = null;
  try {
    const estimate = env.navigator && env.navigator.storage && env.navigator.storage.estimate ? await env.navigator.storage.estimate() : null;
    if (estimate && estimate.quota) storage = { used: estimate.usage || 0, quota: estimate.quota };
  } catch {
    storage = null;
  }
  const ram = env.navigator && env.navigator.deviceMemory ? env.navigator.deviceMemory * 1024 ** 3 : null;
  // RAM: what the platform says is in use on the device, else what this app's JS heap uses out of the device total.
  const device = hooks.memory(env);
  const memory = device ? { ...device, scope: 'device' } : heap && ram ? { used: heap.used, total: ram, scope: 'app' } : null;
  const network = await collectNetwork(env, hooks);
  return { panel, page, ratio: env.devicePixelRatio || 1, heap, storage, ram, memory, network };
}
