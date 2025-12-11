const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, session, shell, nativeTheme, crashReporter } = require('electron');
const { autoUpdater } = require('electron-updater');
const pdfWindow = require('electron-pdf-window');
const path = require('path');
const { hideBin } = require('yargs/helpers');
const yargs = require('yargs/yargs');
const argv = yargs(hideBin(process.argv)).parse();

const http = require('http');
const url = require('url');
const fs = require('fs');
const os = require('os');

// Initialize crash reporter - saves crash dumps locally
crashReporter.start({
  submitURL: '',  // Empty = don't submit anywhere, just save locally
  uploadToServer: false,
  compress: false
});

// Prevent EPIPE errors from crashing the app (common in dev mode with concurrently)
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) {
    // Ignore EPIPE errors - happens when stdout/stderr is closed (e.g., in dev mode)
    return;
  }
  // Try to save session before crashing
  console.error('Uncaught Exception:', err);
  try {
    const { saveSession: emergencySave } = require('./sessionManager');
    const tabMgr = require('./tabManager');
    const tabs = tabMgr.getTabs();
    if (tabs && tabs.length > 0) {
      emergencySave({
        tabs: tabs.map(t => ({ url: t.url, title: t.title, favicon: t.favicon })),
        activeTabId: tabMgr.getActiveTabId(),
        _crashSave: true,
        _crashTime: new Date().toISOString(),
        _crashError: err.message
      });
      console.error('[Session] Emergency save completed before crash');
    }
  } catch (saveErr) {
    console.error('[Session] Emergency save failed:', saveErr);
  }
  throw err;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});

const { setMainMenu } = require('./menu');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const { saveSession: saveSessionToFile, loadSession: loadSessionFromFile } = require('./sessionManager');
const tabManager = require('./tabManager');
const themeManager = require('./themeManager');
const shortcutsManager = require('./shortcutsManager');
const windowManager = require('./windowManager');
const { bindIpcHandlers } = require('./ipcHandler');
const trayManager = require('./trayManager');
const WebContentsViewManager = require('./webContentsViewManager');

let mainWindow;
let tabShortcutsBound = false;

// Startup configuration
let startupConfig = {
  behavior: 'restore',  // 'blank', 'restore', 'url'
  url: 'https://www.google.com'
};

// Global zoom level (percentage, 50-200)
let globalZoom = 100;

// Detached mode opacity (percentage, 20-100)
let detachedOpacity = 50;

// Debounced session save to avoid excessive disk writes
let saveSessionTimeout = null;
const SAVE_DEBOUNCE_MS = 2000;  // Save at most every 2 seconds

// Save session to disk (debounced version for automatic saves)
function saveSessionDebounced() {
  if (saveSessionTimeout) {
    clearTimeout(saveSessionTimeout);
  }
  saveSessionTimeout = setTimeout(() => {
    saveSession();
    saveSessionTimeout = null;
  }, SAVE_DEBOUNCE_MS);
}

// Save session to disk (immediate)
function saveSession() {
  const tabs = tabManager.getTabs();
  const sessionData = {
    tabs: tabs.map(t => ({
      url: t.url,
      title: t.title,
      favicon: t.favicon
    })),
    activeTabId: tabManager.getActiveTabId(),
    theme: themeManager.getCurrentTheme(),
    globalShortcut: shortcutsManager.getCurrentGlobalShortcut(),
    detachedModeShortcut: shortcutsManager.getDetachedModeShortcut(),
    startup: startupConfig,
    globalZoom: globalZoom,
    detachedOpacity: detachedOpacity
  };

  // Save window bounds and opacity if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    const opacity = mainWindow.getOpacity();
    sessionData.windowBounds = bounds;
    sessionData.opacity = opacity;
  }

  saveSessionToFile(sessionData);
}

// Load session from disk
function loadSession() {
  return loadSessionFromFile();
}

// Restore session
function restoreSession() {
  const session = loadSession();
  if (!session) return false;

  // Restore theme
  if (session.theme) {
    themeManager.setCurrentTheme(session.theme);
  }

  // Restore global shortcut
  if (session.globalShortcut) {
    shortcutsManager.setCurrentGlobalShortcut(session.globalShortcut);
  }

  // Restore detached mode shortcut
  if (session.detachedModeShortcut) {
    shortcutsManager.setDetachedModeShortcut(session.detachedModeShortcut);
  }

  // Restore startup configuration
  if (session.startup) {
    startupConfig = { ...startupConfig, ...session.startup };
  }

  // Restore global zoom
  if (session.globalZoom !== undefined) {
    globalZoom = session.globalZoom;
  }

  // Restore detached opacity
  if (session.detachedOpacity !== undefined) {
    detachedOpacity = session.detachedOpacity;
  }

  // Apply startup behavior
  const behavior = startupConfig.behavior;

  if (behavior === 'blank') {
    // Create one blank tab
    createTab('');
    return true;
  } else if (behavior === 'url') {
    // Create tab with custom URL
    createTab(startupConfig.url || 'https://www.google.com');
    return true;
  } else if (behavior === 'restore') {
    // Restore tabs from session
    if (session.tabs && session.tabs.length > 0) {
      // Create WebContentsView for each saved tab
      session.tabs.forEach((tabData, index) => {
        createTab(tabData.url || '');
      });
      return true;
    }
  }

  return false;
}

function applyTheme(theme) {
  themeManager.applyTheme(theme, mainWindow);
}

function ensureDevtoolsWindowFor(wc, hostWindow) {
  if (!wc || wc.isDestroyed()) return;

  if (wc.__devtoolsWin && !wc.__devtoolsWin.isDestroyed()) {
    wc.__devtoolsWin.focus();
    return wc.__devtoolsWin;
  }

  const devtoolsWin = new BrowserWindow({
    width: 980,
    height: 720,
    useContentSize: true,
    title: 'DevTools',
    autoHideMenuBar: true,
  });

  // Render DevTools in the new window
  wc.setDevToolsWebContents(devtoolsWin.webContents);
  wc.openDevTools({ mode: 'undocked' });

  // Position alongside main window
  const positionAlongside = () => {
    if (hostWindow.isDestroyed() || devtoolsWin.isDestroyed()) return;
    const [x, y] = hostWindow.getPosition();
    const [w, h] = hostWindow.getSize();
    devtoolsWin.setBounds({ x: x + w + 12, y, width: 980, height: Math.max(600, h) });
  };
  positionAlongside();
  hostWindow.on('move', positionAlongside);
  hostWindow.on('resize', positionAlongside);

  devtoolsWin.on('closed', () => { wc.__devtoolsWin = null; });
  wc.__devtoolsWin = devtoolsWin;
  return devtoolsWin;
}


function createWindow() {
  // Try to restore window bounds from saved session
  const savedSession = loadSession();
  const savedBounds = savedSession?.windowBounds;

  // Restore startup configuration early so we can use it in ready-to-show
  if (savedSession?.startup) {
    startupConfig = { ...startupConfig, ...savedSession.startup };
  }

  // Restore global zoom early so viewManager uses it
  if (savedSession?.globalZoom !== undefined) {
    globalZoom = savedSession.globalZoom;
  }

  const windowOptions = {
    width: savedBounds?.width || 700,
    height: savedBounds?.height || 600,
    x: savedBounds?.x,
    y: savedBounds?.y,
    autoHideMenuBar: true,
    transparent: true,
    show: false,
    frame: argv.frameless ? false : true,
    titleBarStyle: process.platform === 'darwin' && !argv.frameless ? 'hiddenInset' : 'default',
    fullscreenable: false,  // Disable native fullscreen on macOS
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      sandbox: false,
      backgroundThrottling: false,
      disableBlinkFeatures: 'Accelerated2dCanvas'  // Fix subpixel rendering on transparent windows
    },
  };

  if (savedBounds) {
    console.log('[Session] Restoring window bounds:', savedBounds);
  }

  // Set initial background color based on current theme
  const effectiveTheme = themeManager.getEffectiveTheme(themeManager.getCurrentTheme());
  const bgColor = themeManager.getBackgroundColor(effectiveTheme);

  if (process.platform === 'darwin') {
    windowOptions.backgroundColor = bgColor;
  } else {
    // Alpha channel for transparency on other platforms
    windowOptions.backgroundColor = effectiveTheme === 'dark' ? '#F01c1c1e' : '#F0F8F9FA';
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Restore opacity if saved
  if (savedSession?.opacity !== undefined) {
    mainWindow.setOpacity(savedSession.opacity);
    console.log('[Session] Restored opacity:', savedSession.opacity);
  }

  // Create WebContentsViewManager with global zoom
  const viewManager = new WebContentsViewManager(mainWindow, globalZoom);
  mainWindow.viewManager = viewManager;

  // Connect viewManager events to tabManager
  viewManager.on('tab-update', ({ tabId, updates }) => {
    tabManager.updateTab(tabId, updates, sendTabsUpdate);
  });

  // Handle new window requests (e.g., popups, target="_blank")
  viewManager.on('new-window-requested', ({ url }) => {
    createTab(url);
  });

  // Pass viewManager to tabManager
  tabManager.setViewManager(viewManager);

  bindIpc();

  // NEW ARCHITECTURE: Overlay is a WebContentsView (created in viewManager)
  // Main window loads about:blank to avoid rendering behind WebContentsViews
  mainWindow.loadURL('about:blank');

  mainWindow.webContents.on('did-finish-load', () => {
    // Apply initial theme (still needed for window background)
    applyTheme(themeManager.getCurrentTheme());

    // Restore session (tabs, theme, shortcuts, etc.)
    if (tabManager.getTabs().length === 0) {
      const restored = restoreSession();
      // If no session to restore, create a blank tab
      if (!restored) {
        createTab('');
      }
    }
  });

  mainWindow.once('ready-to-show', () => {
    // No need to set BrowserView - using WebContentsView instead

    mainWindow.show();
    windowManager.setWindowVisible(true);

    bindTabShortcuts();

    // Configure native window properties (only needed once at startup)
    windowManager.configureNativeWindow(mainWindow);
  });

  mainWindow.on('close', function () {
    // Save session before closing
    saveSession();
  });

  mainWindow.on('closed', function () {
    // Don't clear tabs here - they're needed for will-quit save
    mainWindow = null;
    tabShortcutsBound = false;
  });

  // Force redraw to prevent blurry text after show/restore
  ['show', 'restore'].forEach(evt => {
    mainWindow.on(evt, () => {
      setImmediate(() => forceRedraw(mainWindow));
    });
  });

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  setMainMenu(mainWindow);
}

// Helper function to send tabs update to navbar
function sendTabsUpdate() {
  if (!mainWindow || !mainWindow.viewManager || !mainWindow.viewManager.navBarView) return;
  const tabsData = tabManager.getTabsData();
  mainWindow.viewManager.navBarView.webContents.send('tabs.update', tabsData);

  // Auto-save session when tabs change (debounced)
  saveSessionDebounced();
}

// Helper function to notify navbar (show nav, focus)
function notifyRenderer() {
  if (!mainWindow || !mainWindow.viewManager || !mainWindow.viewManager.navBarView) return;

  // Only show navbar and focus URL if navbar is currently visible
  // If navbar is hidden, don't auto-show it when creating new tabs
  if (!mainWindow.viewManager.showNav) {
    return;
  }

  // Show macOS traffic lights when showing navbar
  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(true);
  }

  mainWindow.viewManager.navBarView.webContents.send('nav.show');
  mainWindow.viewManager.navBarView.webContents.send('nav.focus');
}

function createTab(targetUrl = '') {
  return tabManager.createTab(targetUrl, sendTabsUpdate, notifyRenderer);
}

function switchToTab(tabId) {
  return tabManager.switchToTab(tabId, sendTabsUpdate);
}

function closeTab(tabId) {
  return tabManager.closeTab(tabId, sendTabsUpdate);
}

function navigateTab(tabId, targetUrl) {
  return tabManager.navigateTab(tabId, targetUrl, sendTabsUpdate);
}

function showTabContextMenu(tabId) {
  console.log('[Main] showTabContextMenu called for tab:', tabId);
  const tabs = tabManager.getTabs();
  const tabIndex = tabs.findIndex(t => t.id === tabId);

  if (tabIndex === -1) {
    console.log('[Main] Tab not found:', tabId);
    return;
  }

  const template = [
    {
      label: 'Close',
      click: () => closeTab(tabId)
    },
    {
      label: 'Close Other Tabs',
      enabled: tabs.length > 1,
      click: () => tabManager.closeOtherTabs(tabId, sendTabsUpdate)
    },
    {
      label: 'Close Tabs to Right',
      enabled: tabIndex < tabs.length - 1,
      click: () => tabManager.closeTabsToRight(tabId, sendTabsUpdate)
    },
    {
      type: 'separator'
    },
    {
      label: 'Duplicate Tab',
      click: () => tabManager.duplicateTab(tabId, sendTabsUpdate)
    },
    {
      label: 'Reload Tab',
      click: () => tabManager.reloadTab(tabId)
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  menu.popup();
  console.log('[Main] Context menu shown');
}

function bindShortcutsToWebContents(webContents) {
  const callbacks = {
    createTab: (url) => createTab(url),
    closeTab: () => {
      const activeTabId = tabManager.getActiveTabId();
      const tabs = tabManager.getTabs();
      if (activeTabId && tabs.length > 0) {
        closeTab(activeTabId);
      } else if (tabs.length === 0 && mainWindow) {
        mainWindow.close();
      }
    },
    toggleSearch: () => {
      // Send to overlay layer (overlayView)
      if (mainWindow && mainWindow.viewManager && mainWindow.viewManager.overlayView) {
        mainWindow.viewManager.overlayView.webContents.send('search.toggle');
      }
    },
    reloadTab: () => {
      // Reload active content view
      if (mainWindow && mainWindow.viewManager) {
        const activeView = mainWindow.viewManager.getActiveView();
        if (activeView && activeView.webContents) {
          activeView.webContents.reloadIgnoringCache();
        }
      }
    },
    previousTab: () => {
      const activeTabId = tabManager.getActiveTabId();
      const tabs = tabManager.getTabs();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      if (currentIndex > 0) {
        switchToTab(tabs[currentIndex - 1].id);
      } else if (tabs.length > 0) {
        // Wrap to last tab
        switchToTab(tabs[tabs.length - 1].id);
      }
    },
    nextTab: () => {
      const activeTabId = tabManager.getActiveTabId();
      const tabs = tabManager.getTabs();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      if (currentIndex >= 0 && currentIndex < tabs.length - 1) {
        switchToTab(tabs[currentIndex + 1].id);
      } else if (tabs.length > 0) {
        // Wrap to first tab
        switchToTab(tabs[0].id);
      }
    },
    restoreClosedTab: () => {
      tabManager.restoreClosedTab(sendTabsUpdate, notifyRenderer);
    }
  };

  shortcutsManager.bindShortcutsToWebContents(webContents, callbacks);
}

function bindTabShortcuts() {
  if (!mainWindow || tabShortcutsBound) return;

  tabShortcutsBound = true;
  bindShortcutsToWebContents(mainWindow.webContents);
}

function registerGlobalShortcut(shortcut, skipSave = false) {
  const success = shortcutsManager.registerGlobalShortcut(shortcut, () => {
    toggleWindow();
  }, skipSave);

  // Only save session if explicitly requested (e.g., user changed shortcut)
  if (success && !skipSave) {
    saveSession();
  }

  return success;
}

function registerDetachedModeShortcut(shortcut, skipSave = false) {
  const success = shortcutsManager.registerDetachedModeShortcut(shortcut, () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      windowManager.toggleDetachedMode(mainWindow, {
        getDetachedOpacity: () => detachedOpacity
      });
    }
  });

  // Only save session if explicitly requested (e.g., user changed shortcut)
  if (success && !skipSave) {
    saveSession();
  }

  return success;
}

function bindIpc() {
  // Add debug log listener
  ipcMain.on('log', (event, message) => {
    console.log(message);
  });

  // Note: settings.toggle and search.toggle handlers are registered in ipcHandler.js
  // They forward messages to overlayView (not mainWindow)

  // Detached shortcut handlers
  ipcMain.on('detached.shortcut.get', (event) => {
    event.returnValue = shortcutsManager.getDetachedModeShortcut();
  });

  ipcMain.on('detached.shortcut.set', (event, shortcut) => {
    registerDetachedModeShortcut(shortcut);
  });

  ipcMain.on('detached.shortcut.unregister', (event) => {
    shortcutsManager.unregisterAllGlobalShortcuts();
    // Re-register toggle window shortcut
    registerGlobalShortcut(shortcutsManager.getCurrentGlobalShortcut(), true);
  });

  // Overlay visibility control - add/remove from view hierarchy with dynamic bounds
  ipcMain.on('overlay.mouse-events', (event, { shouldShow, mode }) => {
    if (mainWindow && mainWindow.viewManager && mainWindow.viewManager.overlayView) {
      if (shouldShow) {
        // 显示overlay: 根据模式设置不同的 bounds
        if (mode === 'settings') {
          // Settings 需要全屏
          mainWindow.viewManager.updateOverlayBounds();
        } else if (mode === 'search') {
          // Search 只需要小区域
          mainWindow.viewManager.setOverlaySearchBounds();
        }

        // 添加到视图层级
        mainWindow.contentView.addChildView(mainWindow.viewManager.overlayView);

        // Focus overlay webContents so input can receive focus
        // Use setTimeout to ensure view is fully added and rendered
        setTimeout(() => {
          if (mainWindow.viewManager.overlayView &&
              !mainWindow.viewManager.overlayView.webContents.isDestroyed()) {
            mainWindow.viewManager.overlayView.webContents.focus();
          }
        }, 50);
      } else {
        // 隐藏overlay: 从视图层级移除
        mainWindow.contentView.removeChildView(mainWindow.viewManager.overlayView);
        mainWindow.viewManager.clearOverlayMode();  // 清除模式
      }
    }
  });


  // Note: focus-main-window and blur-main-window IPC handlers removed.
  // With independent NavBarView, focus management is handled naturally by the OS.
  // NavBar events are sent directly to its own WebContentsView.

  bindIpcHandlers({
    getOpacity: () => mainWindow.getOpacity() * 100,
    setOpacity: (opacity) => mainWindow.setOpacity(opacity / 100),
    getTheme: () => themeManager.getCurrentTheme(),
    setTheme: (theme) => applyTheme(theme),
    getShortcut: () => shortcutsManager.getCurrentGlobalShortcut(),
    setShortcut: (shortcut) => registerGlobalShortcut(shortcut),
    unregisterShortcut: () => shortcutsManager.unregisterAllGlobalShortcuts(),
    createTab: (url) => createTab(url),
    closeTab: (tabId) => closeTab(tabId),
    switchTab: (tabId) => switchToTab(tabId),
    navigateTab: (tabId, url) => navigateTab(tabId, url),
    updateTab: (tabId, updates) => tabManager.updateTab(tabId, updates, sendTabsUpdate),
    getTabs: () => tabManager.getTabsData(),
    reorderTab: (fromIndex, toIndex) => tabManager.reorderTab(fromIndex, toIndex, sendTabsUpdate),
    closeOtherTabs: (tabId) => tabManager.closeOtherTabs(tabId, sendTabsUpdate),
    closeTabsToRight: (tabId) => tabManager.closeTabsToRight(tabId, sendTabsUpdate),
    duplicateTab: (tabId) => tabManager.duplicateTab(tabId, sendTabsUpdate),
    reloadTab: (tabId) => tabManager.reloadTab(tabId),
    showTabContextMenu: (tabId) => showTabContextMenu(tabId),
    relayToRenderer: (channel, ...args) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel, ...args);
      }
    },
    getStartupBehavior: () => startupConfig.behavior,
    setStartupBehavior: (behavior) => {
      startupConfig.behavior = behavior;
      saveSession();
    },
    getStartupUrl: () => startupConfig.url,
    setStartupUrl: (url) => {
      startupConfig.url = url;
      saveSession();
    },
    getGlobalZoom: () => globalZoom,
    setGlobalZoom: (zoom) => {
      globalZoom = zoom;
      if (mainWindow && mainWindow.viewManager) {
        mainWindow.viewManager.setDefaultZoomFactor(zoom / 100);
      }
      saveSession();
    },
    getDetachedOpacity: () => detachedOpacity,
    setDetachedOpacity: (opacity) => {
      detachedOpacity = opacity;
      saveSession();
    }
  });
}

function disableDetachedMode() {
  windowManager.disableDetachedMode(mainWindow, app);
}

function forceRedraw(win) {
  windowManager.forceRedraw(win);
}

function toggleWindow() {
  windowManager.toggleWindow(mainWindow);
}

function checkAndDownloadUpdate() {
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.log(e.message);
  }
}

function listenUrlLoader() {
  const server = http.createServer((request, response) => {
    let target_url = url.parse(request.url, true).query.url;
    target_url = Array.isArray(target_url) ? target_url.pop() : target_url;

    if (target_url) {
      // Create new tab with the URL
      createTab(target_url);
    }

    response.writeHeader(200);
    response.end();
  });

  server.listen(6280, '0.0.0.0');
}

function createTray() {
  trayManager.createTray({
    toggleWindow: () => toggleWindow(),
    createTab: (url) => createTab(url),
    showSettings: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.webContents.send('nav.show');
      }
    },
    quitApp: () => app.quit()
  });
}

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disk-cache-size', '104857600');  // 100MB disk cache limit
app.commandLine.appendSwitch('media-cache-size', '52428800');  // 50MB media cache limit
app.commandLine.appendSwitch('disable-quic');

app.on('ready', async function () {
  if (app.dock) {
    app.dock.hide();
  }

  // Listen for system theme changes
  nativeTheme.on('updated', () => {
    if (themeManager.getCurrentTheme() === 'system') {
      applyTheme('system');
    }
  });

  const ses = session.fromPartition('persist:direct');

  await ses.setProxy({ mode: 'system' });
  await ses.clearCache();
  await ses.clearHostResolverCache();

  try {
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
    blocker.enableBlockingInSession(ses);
  } catch (error) {
    console.error('[AdBlock] Failed to initialize:', error);
  }

  try {
    ses.preconnect({ url: 'https://www.google.com', numSockets: 4 });
  } catch (e) {}

  createWindow();
  createTray();
  checkAndDownloadUpdate();
  listenUrlLoader();

  // Register global shortcuts (uses restored shortcuts from session or defaults)
  // Skip saving on initial registration to avoid overwriting session before tabs are restored
  registerGlobalShortcut(shortcutsManager.getCurrentGlobalShortcut(), true);
  registerDetachedModeShortcut(shortcutsManager.getDetachedModeShortcut(), true);

  app.on('web-contents-created', (event, contents) => {
    // Increase max listeners to avoid warnings
    contents.setMaxListeners(30);

    bindShortcutsToWebContents(contents);
  });
});

app.on('browser-window-focus', disableDetachedMode);

app.on('activate', function () {
  disableDetachedMode();

  if (mainWindow && !mainWindow.isVisible()) {
    mainWindow.show();

    if (typeof mainWindow.moveTop === 'function') {
      mainWindow.moveTop();
    }
    mainWindow.focus();
  } else {
    createWindow();
  }
});

app.on('window-all-closed', function () {
  app.quit();
});

app.on('will-quit', () => {
  // Clear any pending debounced save and save immediately
  if (saveSessionTimeout) {
    clearTimeout(saveSessionTimeout);
    saveSessionTimeout = null;
  }
  saveSession();
  shortcutsManager.unregisterAllGlobalShortcuts();
});
