/* Preload of the desktop window: the only thing the page may ask of the main process is the full-screen state of its own window. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xtreamDesktop', {
  /** Switches full screen; resolves with whether the window is full screen now. */
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen', true),
  isFullscreen: () => ipcRenderer.invoke('window:fullscreen', false),
});
