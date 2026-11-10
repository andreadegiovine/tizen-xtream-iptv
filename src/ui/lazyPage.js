import { h } from './dom.js';
import { log } from '../core/logger.js';

/**
 * A page whose code is in its own file (webpack chunk), read the first time the page opens: the start of the app does not read and compile
 * it. The router needs a page at once: this one is a placeholder (`.page`, empty) replaced by the real page when its code is there; the
 * real page's methods (`onBack`, `onAction`, `saveState`...) are used from then on. `load()` resolves with the page factory; `create(factory)`
 * builds the page. A load that fails (a build online that cannot be reached) shows `errorText` and Back leaves.
 */
export function createLazyPage(load, create, { errorText = '' } = {}) {
  const holder = h('div', { class: 'page lazy-page' });
  let real = null;
  let mounted = false;
  let destroyed = false;
  let pendingState = null;

  const page = {
    el: holder,
    mount() {
      mounted = true;
      if (real) return;
      load()
        .then((factory) => {
          if (destroyed) return;
          real = create(factory);
          if (holder.parentNode) holder.parentNode.replaceChild(real.el, holder);
          page.el = real.el;
          // The real page's own methods, used by the router and the app from now on (onBack, onAction, showRecent...).
          Object.keys(real).forEach((name) => {
            if (name !== 'el' && name !== 'mount' && typeof real[name] === 'function') page[name] = (...args) => real[name](...args);
          });
          if (mounted && real.mount) real.mount();
          if (pendingState && real.restoreState) real.restoreState(pendingState);
        })
        .catch((err) => {
          log.warn('Page code not loaded', err && err.message);
          if (!destroyed) holder.textContent = errorText;
        });
    },
    restoreState(state) {
      pendingState = state;
    },
    saveState() {
      return pendingState;
    },
    destroy() {
      destroyed = true;
    },
  };
  return page;
}

/** Reads a page's code ahead of its first opening (idle time after the start): the first opening is then as quick as the others. */
export function preloadPages(loaders) {
  return loaders.reduce((chain, load) => chain.then(() => load().catch(() => undefined)), Promise.resolve());
}
