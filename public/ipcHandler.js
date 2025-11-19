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
    relayToRenderer,
    getStartupBehavior,
    setStartupBehavior,
    getStartupUrl,
    setStartupUrl
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
  ipcMain.removeAllListeners('startup.behavior.get');
  ipcMain.removeAllListeners('startup.behavior.set');
  ipcMain.removeAllListeners('startup.url.get');
  ipcMain.removeAllListeners('startup.url.set');
  ipcMain.removeAllListeners('fullscreen.enter');
  ipcMain.removeAllListeners('fullscreen.leave');
  ipcMain.removeAllListeners('traffic-lights.show');

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

    // Update viewManager bounds
    if (win && win.viewManager) {
      win.viewManager.setNavBarVisible(false);
    }

    // Hide macOS traffic lights on macOS
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(false);
    }

    relayToRenderer('nav.hide');
  });

  ipcMain.on('nav.show', (event) => {
    // Get the window that sent this message
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);

    // Update viewManager bounds
    if (win && win.viewManager) {
      win.viewManager.setNavBarVisible(true);
    }

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

  // Startup configuration handlers
  ipcMain.on('startup.behavior.get', (event) => {
    event.returnValue = getStartupBehavior();
  });

  ipcMain.on('startup.behavior.set', (event, behavior) => {
    console.log(`[IPC] Received startup.behavior.set: ${behavior}`);
    setStartupBehavior(behavior);
  });

  ipcMain.on('startup.url.get', (event) => {
    event.returnValue = getStartupUrl();
  });

  ipcMain.on('startup.url.set', (event, url) => {
    console.log(`[IPC] Received startup.url.set: ${url}`);
    setStartupUrl(url);
  });

  // Fullscreen handlers - hide/show traffic lights
  ipcMain.on('fullscreen.enter', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(false);
    }
  });

  ipcMain.on('fullscreen.leave', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(true);
    }
  });

  ipcMain.on('traffic-lights.show', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(true);
    }
  });

  // Zoom handlers
  ipcMain.removeAllListeners('zoom.in');
  ipcMain.removeAllListeners('zoom.out');
  ipcMain.removeAllListeners('zoom.reset');

  ipcMain.on('zoom.in', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      win.viewManager.zoomIn();
    }
  });

  ipcMain.on('zoom.out', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      win.viewManager.zoomOut();
    }
  });

  ipcMain.on('zoom.reset', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      win.viewManager.zoomReset();
    }
  });

  // Navigation handlers (back, forward, reload)
  ipcMain.removeAllListeners('webPage.reload');

  ipcMain.on('tab.reload', (event, tabId) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      const view = win.viewManager.getView(tabId);
      if (view && view.webContents) {
        view.webContents.reloadIgnoringCache();
      }
    }
  });

  // Handle reload for active tab (legacy compatibility)
  ipcMain.on('webPage.reload', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      const activeView = win.viewManager.getActiveView();
      if (activeView && activeView.webContents) {
        activeView.webContents.reloadIgnoringCache();
      }
    }
  });

  ipcMain.on('tab.back', (event, tabId) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      const view = win.viewManager.getView(tabId);
      if (view && view.webContents && view.webContents.canGoBack()) {
        view.webContents.goBack();
      }
    }
  });

  ipcMain.on('tab.forward', (event, tabId) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      const view = win.viewManager.getView(tabId);
      if (view && view.webContents && view.webContents.canGoForward()) {
        view.webContents.goForward();
      }
    }
  });
}

module.exports = {
  bindIpcHandlers
};
