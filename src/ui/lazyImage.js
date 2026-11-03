// Chromium 76 (Tizen 6) has no native `loading="lazy"`: images get their `src` only when they come close to the screen.
const MARGIN = '600px';
const SWEEP_AT = 400;
let observer = null;
const watched = new Set();

function load(img) {
  const url = img.dataset.src;
  if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
}

function sweep() {
  // Pages are destroyed without telling us: forget images that left the document.
  watched.forEach((img) => {
    if (!img.isConnected) {
      if (observer) observer.unobserve(img);
      watched.delete(img);
    }
  });
}

function getObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver(
    (records) => {
      records.forEach((record) => {
        if (!record.isIntersecting) return;
        observer.unobserve(record.target);
        watched.delete(record.target);
        load(record.target);
      });
    },
    { rootMargin: MARGIN },
  );
  return observer;
}

/** Sets the image address now when the image is already loading/visible, otherwise when it scrolls near the screen. */
export function lazySrc(img, url) {
  img.dataset.src = url;
  const io = getObserver();
  if (!io || img.getAttribute('src')) {
    load(img);
    return;
  }
  if (watched.size > SWEEP_AT) sweep();
  watched.add(img);
  io.observe(img);
}
