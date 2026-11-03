/** 1536 * 1024 * 1024 -> "1.5 GB" */
export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.round(n / 1024 ** 2)} MB`;
}

function tizenDisplay(env) {
  return new Promise((resolve) => {
    try {
      const info = env.tizen && env.tizen.systeminfo;
      if (!info) {
        resolve(null);
        return;
      }
      info.getPropertyValue('DISPLAY', (d) => resolve(d && d.resolutionWidth ? { width: d.resolutionWidth, height: d.resolutionHeight } : null), () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}

/** Device-wide memory from Tizen (`getTotalMemory` / `getAvailableMemory`, bytes) when the firmware has them. */
function tizenMemory(env) {
  try {
    const info = env.tizen && env.tizen.systeminfo;
    if (!info || typeof info.getTotalMemory !== 'function' || typeof info.getAvailableMemory !== 'function') return null;
    const total = Number(info.getTotalMemory());
    const available = Number(info.getAvailableMemory());
    return total > 0 && available >= 0 && available <= total ? { used: total - available, total } : null;
  } catch {
    return null;
  }
}

/**
 * What the TV reports about itself, for the "Device" table. Every value can be missing (null) on browsers or
 * firmware that do not expose it: resolution (physical when Tizen says so, plus the page's own size),
 * app memory (JS heap used / limit), storage used / quota of this app, and the RAM (used / total, see `memory`).
 */
export async function collectDeviceInfo(env = globalThis) {
  const screen = env.screen || {};
  const panel = (await tizenDisplay(env)) || (screen.width ? { width: screen.width, height: screen.height } : null);
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
  // RAM: what Tizen says is in use on the device, else what this app's JS heap uses out of the device total.
  const device = tizenMemory(env);
  const memory = device ? { ...device, scope: 'device' } : heap && ram ? { used: heap.used, total: ram, scope: 'app' } : null;
  return { panel, page, ratio: env.devicePixelRatio || 1, heap, storage, ram, memory };
}
