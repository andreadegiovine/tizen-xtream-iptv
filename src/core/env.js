export const IS_DEV = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

export function isTizen() {
  return typeof window !== 'undefined' && typeof window.tizen !== 'undefined';
}

/**
 * Single place deciding how API URLs reach the provider.
 * In development the dev server proxies them (same origin, no CORS); in production they go direct.
 */
export function wrapApiUrl(url) {
  return IS_DEV ? `/__proxy?u=${encodeURIComponent(url)}` : url;
}

export function exitApp() {
  try {
    if (isTizen()) window.tizen.application.getCurrentApplication().exit();
  } catch {
    /* nothing else to do */
  }
}
