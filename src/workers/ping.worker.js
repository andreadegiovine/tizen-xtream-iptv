/* Minimal worker used only by the diagnostics page (milestone 0). */
self.onmessage = function (event) {
  self.postMessage(event.data + 1);
};
