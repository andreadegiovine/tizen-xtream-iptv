// Chromium 76 (Tizen 6) has no native `loading="lazy"`: images get their `src` only when they come close to the screen, and the
// ones that end up far from it give their picture back (a decoded poster costs memory); the poster shows its skeleton until the
// picture is there again.
const MARGIN = '600px'; // closer than this to the screen: the picture is loaded
const FAR_MARGIN = '1800px'; // farther than this (three times as much, so nothing flickers at the edge): the picture is dropped
const SWEEP_AT = 400;
// An observer without a root measures against the screen, but the scroll containers between the picture and the screen (the page, the track
// of a carousel) clip it WITHOUT the margin: a picture a pixel below the visible part would count as far away. So every picture is observed
// from its own scroll container, where the margins really are 600 / 1800 px.
const groups = new Map(); // root element (null = the screen) -> { near, far }
const watched = new Set();
// Pictures already shown in this session (in the browser's cache): a card built again (a page that comes back) shows them at once,
// without the skeleton sweeping over the whole row first (Home's first row "reloaded" all its posters when the page came back).
const shown = new Set();
const SHOWN_MAX = 4000;

/** Remembers that a picture was shown (its load ended). */
export function markShown(url) {
  if (!url) return;
  if (shown.size >= SHOWN_MAX) shown.clear();
  shown.add(url);
}

/** Whether a picture was shown already in this session. */
export const wasShown = (url) => shown.has(url);

function load(img) {
  const url = img.dataset.src;
  if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
}

/** Gives the picture back and brings the skeleton back on the poster that holds it. */
function unload(img) {
  if (!img.getAttribute('src')) return;
  const holder = img.closest ? img.closest('.card-poster') : null;
  if (holder) holder.classList.add('loading');
  img.removeAttribute('src');
}

function sweep() {
  // Pages are destroyed without telling us: forget images that left the document.
  watched.forEach((img) => {
    if (!img.isConnected) {
      const group = groups.get(img.lazyRoot || null);
      if (group) {
        group.near.unobserve(img);
        group.far.unobserve(img);
      }
      watched.delete(img);
    }
  });
  groups.forEach((group, root) => {
    if (root && !root.isConnected) {
      group.near.disconnect();
      group.far.disconnect();
      groups.delete(root);
    }
  });
}

function groupFor(root) {
  let group = groups.get(root);
  if (group) return group;
  const make = (rootMargin, onRecord) => new IntersectionObserver((records) => records.forEach(onRecord), { root, rootMargin });
  group = {
    near: make(MARGIN, (record) => {
      if (record.isIntersecting) load(record.target);
    }),
    far: make(FAR_MARGIN, (record) => {
      if (!record.isIntersecting) unload(record.target);
    }),
  };
  groups.set(root, group);
  return group;
}

const scrollRootOf = (img) => (img.closest ? img.closest('.carousel-track') || img.closest('.page') : null);

/** Starts watching a picture from its scroll container (it is not in the page yet when a card is built: one frame later). */
function register(img, tries = 0) {
  if (!img.isConnected && tries < 3 && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => register(img, tries + 1));
    return;
  }
  if (watched.has(img)) return;
  if (watched.size > SWEEP_AT) sweep();
  const root = img.isConnected ? scrollRootOf(img) : null;
  img.lazyRoot = root;
  const group = groupFor(root);
  watched.add(img);
  group.near.observe(img);
  group.far.observe(img);
}

/** Sets the image address now when the image is already loading/visible, otherwise when it scrolls near the screen. */
export function lazySrc(img, url) {
  img.dataset.src = url;
  img.decoding = 'async'; // decoded off the main thread: scrolling does not stutter while posters appear
  if (typeof IntersectionObserver === 'undefined') {
    load(img);
    return;
  }
  if (img.getAttribute('src')) load(img); // already showing something: the new address replaces it at once
  register(img);
}
