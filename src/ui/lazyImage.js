// Chromium 76 (Tizen 6) has no native `loading="lazy"`: images get their `src` only when they come close to the screen, and the
// ones that end up far from it give their picture back (a decoded poster costs memory); the poster shows its skeleton until the
// picture is there again.
const MARGIN = '600px'; // closer than this to the screen: the picture is loaded
const FAR_MARGIN = '1800px'; // farther than this (three times as much, so nothing flickers at the edge): the picture is dropped
const SWEEP_AT = 400;
let near = null;
let far = null;
const watched = new Set();

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
      if (near) near.unobserve(img);
      if (far) far.unobserve(img);
      watched.delete(img);
    }
  });
}

function getObservers() {
  if (near || typeof IntersectionObserver === 'undefined') return near;
  near = new IntersectionObserver(
    (records) => {
      records.forEach((record) => {
        if (record.isIntersecting) load(record.target);
      });
    },
    { rootMargin: MARGIN },
  );
  far = new IntersectionObserver(
    (records) => {
      records.forEach((record) => {
        if (!record.isIntersecting) unload(record.target);
      });
    },
    { rootMargin: FAR_MARGIN },
  );
  return near;
}

/** Sets the image address now when the image is already loading/visible, otherwise when it scrolls near the screen. */
export function lazySrc(img, url) {
  img.dataset.src = url;
  img.decoding = 'async'; // decoded off the main thread: scrolling does not stutter while posters appear
  const io = getObservers();
  if (!io) {
    load(img);
    return;
  }
  if (img.getAttribute('src')) load(img); // already showing something: the new address replaces it at once
  if (!watched.has(img)) {
    if (watched.size > SWEEP_AT) sweep();
    watched.add(img);
    near.observe(img);
    far.observe(img);
  }
}
