const { ipcMain } = require('electron');

/**
 * IPC Handler Module
 * Centralized IPC communication between main and renderer processes
 */

/**
 * Bind all IPC handlers
 * @param {Object} handlers - Object containing all handler functions
 */
function bindIpcHandlers(handlers) {
  const {
    getOpacity,
    setOpacity,
    getTheme,
    setTheme,
    getShortcut,
    setShortcut,
    unregisterShortcut,
    createTab,
    closeTab,
    switchTab,
    navigateTab,
    updateTab,
    getTabs,
    relayToRenderer
  } = handlers;

  // Remove all existing listeners to avoid duplicates
  ipcMain.removeAllListeners('opacity.get');
  ipcMain.removeAllListeners('opacity.set');
  ipcMain.removeAllListeners('theme.get');
  ipcMain.removeAllListeners('theme.set');
  ipcMain.removeAllListeners('shortcut.get');
  ipcMain.removeAllListeners('shortcut.set');
  ipcMain.removeAllListeners('shortcut.unregister');
  ipcMain.removeAllListeners('tab.create');
  ipcMain.removeAllListeners('tab.close');
  ipcMain.removeAllListeners('tab.switch');
  ipcMain.removeAllListeners('tab.navigate');
  ipcMain.removeAllListeners('tab.reload');
  ipcMain.removeAllListeners('tab.back');
  ipcMain.removeAllListeners('tab.forward');
  ipcMain.removeAllListeners('tab.update');
  ipcMain.removeAllListeners('tabs.get');
  ipcMain.removeAllListeners('nav.hide');
  ipcMain.removeAllListeners('nav.show');
  ipcMain.removeAllListeners('nav.toggle');
  ipcMain.removeAllListeners('settings.toggle');

  // Opacity handlers
  ipcMain.on('opacity.get', (event) => {
    event.returnValue = getOpacity();
  });

  ipcMain.on('opacity.set', (event, opacity) => {
    setOpacity(opacity);
  });

  // Theme handlers
  ipcMain.on('theme.get', (event) => {
    event.returnValue = getTheme();
  });

  ipcMain.on('theme.set', (event, theme) => {
    console.log(`[IPC] Received theme.set: ${theme}`);
    setTheme(theme);
  });

  // Shortcut handlers
  ipcMain.on('shortcut.get', (event) => {
    event.returnValue = getShortcut();
  });

  ipcMain.on('shortcut.set', (event, shortcut) => {
    console.log(`[IPC] Received shortcut.set: ${shortcut}`);
    setShortcut(shortcut);
  });

  ipcMain.on('shortcut.unregister', (event) => {
    console.log(`[IPC] Received shortcut.unregister`);
    unregisterShortcut();
  });

  // Tab handlers
  ipcMain.on('tab.create', (event, url) => {
    createTab(url);
  });

  ipcMain.on('tab.close', (event, tabId) => {
    closeTab(tabId);
  });

  ipcMain.on('tab.switch', (event, tabId) => {
    switchTab(tabId);
  });

  ipcMain.on('tab.navigate', (event, { tabId, url }) => {
    navigateTab(tabId, url);
  });

  ipcMain.on('tab.update', (event, { tabId, updates }) => {
    updateTab(tabId, updates);
  });

  ipcMain.on('tabs.get', (event) => {
    event.returnValue = getTabs();
  });

  // Navbar relay handlers - relay messages from renderer to renderer
  ipcMain.on('nav.hide', (event) => {
    // Get the window that sent this message
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);

    // Hide macOS traffic lights on macOS
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(false);
    }

    relayToRenderer('nav.hide');
  });

  ipcMain.on('nav.show', (event) => {
    // Get the window that sent this message
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);

    // Show macOS traffic lights on macOS
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(true);
    }

    relayToRenderer('nav.show');
  });

  ipcMain.on('nav.toggle', () => {
    relayToRenderer('nav.toggle');
  });

  ipcMain.on('settings.toggle', (event, isShown) => {
    relayToRenderer('settings.toggle', isShown);
  });
}

module.exports = {
  bindIpcHandlers
};
