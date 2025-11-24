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
    setStartupUrl,
    getGlobalZoom,
    setGlobalZoom
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
  ipcMain.removeAllListeners('globalZoom.get');
  ipcMain.removeAllListeners('globalZoom.set');
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
    setTheme(theme);
  });

  // Shortcut handlers
  ipcMain.on('shortcut.get', (event) => {
    event.returnValue = getShortcut();
  });

  ipcMain.on('shortcut.set', (event, shortcut) => {
    setShortcut(shortcut);
  });

  ipcMain.on('shortcut.unregister', (event) => {
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
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);

    // Update viewManager bounds (navbar shrinks to 15px drag strip)
    if (win && win.viewManager) {
      win.viewManager.setNavBarVisible(false);
    }

    // Hide macOS traffic lights on macOS
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(false);
    }

    // Notify navbar to show drag strip
    relayToRenderer('nav.hide');
  });

  ipcMain.on('nav.show', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);

    // Update viewManager bounds (navbar expands to full height)
    if (win && win.viewManager) {
      win.viewManager.setNavBarVisible(true);
    }

    // Show macOS traffic lights on macOS
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(true);
    }

    // Notify navbar to show full UI
    relayToRenderer('nav.show');
  });

  ipcMain.on('nav.toggle', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);

    // Toggle navbar visibility
    if (win && win.viewManager && win.viewManager.navBarView) {
      const currentlyVisible = win.viewManager.showNav;
      const newVisible = !currentlyVisible;

      // Update viewManager bounds
      win.viewManager.setNavBarVisible(newVisible);

      // Update traffic lights
      if (process.platform === 'darwin') {
        win.setWindowButtonVisibility(newVisible);
      }

      // Notify navbar
      const message = newVisible ? 'nav.show' : 'nav.hide';
      win.viewManager.navBarView.webContents.send(message);
    }
  });

  ipcMain.on('settings.toggle', (event, isShown) => {
    // Forward to overlayView (not main window)
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager && win.viewManager.overlayView) {
      win.viewManager.overlayView.webContents.send('settings.toggle', isShown);
    }
  });

  // Startup configuration handlers
  ipcMain.on('startup.behavior.get', (event) => {
    event.returnValue = getStartupBehavior();
  });

  ipcMain.on('startup.behavior.set', (event, behavior) => {
    setStartupBehavior(behavior);
  });

  ipcMain.on('startup.url.get', (event) => {
    event.returnValue = getStartupUrl();
  });

  ipcMain.on('startup.url.set', (event, url) => {
    setStartupUrl(url);
  });

  // Global zoom handlers
  ipcMain.on('globalZoom.get', (event) => {
    event.returnValue = getGlobalZoom();
  });

  ipcMain.on('globalZoom.set', (event, zoom) => {
    setGlobalZoom(zoom);
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
    // Only show traffic lights if navbar is visible
    if (process.platform === 'darwin' && win && win.viewManager && win.viewManager.showNav) {
      win.setWindowButtonVisibility(true);
    }
  });

  ipcMain.on('traffic-lights.show', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (process.platform === 'darwin' && win) {
      win.setWindowButtonVisibility(true);
    }
  });

  // Search handlers
  ipcMain.removeAllListeners('search.find');
  ipcMain.removeAllListeners('search.clear');

  // Store search listeners to avoid re-adding on every search
  const searchListeners = new WeakMap();

  ipcMain.on('search.find', (event, { text, forward, findNext }) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      const activeView = win.viewManager.getActiveView();
      if (activeView && activeView.webContents) {
        // Only set up listener once per webContents
        if (!searchListeners.has(activeView.webContents)) {
          const resultListener = (e, result) => {
            // Send result back to overlay
            if (win.viewManager && win.viewManager.overlayView) {
              win.viewManager.overlayView.webContents.send('search.result', result);
            }
          };

          activeView.webContents.on('found-in-page', resultListener);
          searchListeners.set(activeView.webContents, resultListener);

          // Clean up listener when webContents is destroyed
          activeView.webContents.once('destroyed', () => {
            searchListeners.delete(activeView.webContents);
          });
        }

        // Start search - findInPage returns the requestId
        activeView.webContents.findInPage(text, {
          forward: forward !== false,
          findNext: findNext === true
        });
      }
    }
  });

  ipcMain.on('search.clear', (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender);
    if (win && win.viewManager) {
      const activeView = win.viewManager.getActiveView();
      if (activeView && activeView.webContents) {
        activeView.webContents.stopFindInPage('clearSelection');
      }
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
