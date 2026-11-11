/* Preload of the desktop window: the page may only ask the main process for the full-screen state of its own window and to bring it to
 * the front (a scheduled viewing notification was clicked). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('xtreamDesktop', {
  /** Switches full screen; resolves with whether the window is full screen now. */
  toggleFullscreen: () => ipcRenderer.invoke('window:fullscreen', true),
  isFullscreen: () => ipcRenderer.invoke('window:fullscreen', false),
  /** Restores and focuses the window. */
  show: () => ipcRenderer.invoke('window:show'),
});
