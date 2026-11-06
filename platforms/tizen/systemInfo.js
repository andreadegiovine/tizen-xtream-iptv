/* Tizen system information for the "Device" table (tizen.systeminfo): every value is null when the firmware does not have it. */

/** Panel resolution { width, height } (the physical one, e.g. 3840x2160 on a 4K TV). */
export function tizenDisplay(env) {
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
export function tizenMemory(env) {
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

/** Tizen's NETWORK property ("WIFI", "ETHERNET", "CELLULAR", "NONE"...) when the firmware has it. */
export function tizenNetwork(env) {
  return new Promise((resolve) => {
    try {
      const info = env.tizen && env.tizen.systeminfo;
      if (!info) {
        resolve(null);
        return;
      }
      info.getPropertyValue('NETWORK', (n) => resolve(n && n.networkType ? String(n.networkType) : null), () => resolve(null));
    } catch {
      resolve(null);
    }
  });
}
