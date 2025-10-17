const { app, BrowserWindow, BrowserView, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, session, shell, nativeTheme } = require('electron');
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

// Prevent EPIPE errors from crashing the app (common in dev mode with concurrently)
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE' || (err.message && err.message.includes('EPIPE'))) {
    // Ignore EPIPE errors - happens when stdout/stderr is closed (e.g., in dev mode)
    return;
  }
  // Re-throw other errors
  console.error('Uncaught Exception:', err);
  throw err;
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  // Silently ignore "Script failed to execute" errors from webview IPC
  // These happen when webviews are destroyed during navigation
  if (reason && reason.message && reason.message.includes('Script failed to execute')) {
    return;
  }
  // Log other rejections
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

let mainWindow;
let tabShortcutsBound = false;

// Startup configuration
let startupConfig = {
  behavior: 'restore',  // 'blank', 'restore', 'url'
  url: 'https://www.google.com'
};

// Save session to disk
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
    startup: startupConfig
  };

  // Save window bounds and opacity if window exists
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    const opacity = mainWindow.getOpacity();
    sessionData.windowBounds = bounds;
    sessionData.opacity = opacity;
    console.log('[Session] Saved window bounds:', bounds, 'opacity:', opacity);
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

  // Restore startup configuration
  if (session.startup) {
    startupConfig = { ...startupConfig, ...session.startup };
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
      const restoredTabs = [];
      let nextTabId = 1;

      session.tabs.forEach((tabData, index) => {
        const tabId = nextTabId++;
        const tab = {
          id: tabId,
          url: tabData.url || '',
          title: tabData.title || 'New Tab',
          favicon: tabData.favicon || null,
          loading: false
        };
        restoredTabs.push(tab);
      });

      // Set tabs in tabManager (use first tab as active)
      const activeTabId = restoredTabs.length > 0 ? restoredTabs[0].id : null;
      tabManager.setTabs(restoredTabs, activeTabId, nextTabId);

      sendTabsUpdate();
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
      webviewTag: true,
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

  bindIpc();


  const isDev = !!process.env.APP_URL;
  if (process.env.APP_URL) {
    mainWindow.loadURL(process.env.APP_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../build/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    const platform = process.platform;
    const jsCode = `document.body.classList.add('platform-${platform}');`;
    mainWindow.webContents.executeJavaScript(jsCode).catch(err => {
      // Silently ignore errors during page transitions
    });

    // Apply initial theme
    applyTheme(themeManager.getCurrentTheme());

    // Restore session after page loads
    restoreSession();
  });

  mainWindow.on('ready-to-show', () => {
    if (tabManager.getTabs().length === 0) {
      mainWindow.setBrowserView(null);
    }

    mainWindow.show();
    windowManager.setWindowVisible(true);

    bindTabShortcuts();
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

  ['enter-full-screen', 'leave-full-screen', 'restore', 'show'].forEach(evt => {
    mainWindow.on(evt, () => {
      ensureOverlayState(mainWindow);
      // Force redraw to prevent blurry text after state changes
      if (evt === 'show' || evt === 'restore') {
        setImmediate(() => forceRedraw(mainWindow));
      }
    });
  });

  mainWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
    if (!isAlwaysOnTop) {
      ensureOverlayState(mainWindow);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  setMainMenu(mainWindow);
}

// Helper function to send tabs update to renderer
function sendTabsUpdate() {
  if (!mainWindow) return;
  const tabsData = tabManager.getTabsData();
  mainWindow.webContents.send('tabs.update', tabsData);
}

// Helper function to notify renderer (show nav, focus)
function notifyRenderer() {
  if (mainWindow && mainWindow.webContents) {
    // Show macOS traffic lights when showing navbar
    if (process.platform === 'darwin') {
      mainWindow.setWindowButtonVisibility(true);
    }

    mainWindow.webContents.send('nav.show');
    mainWindow.webContents.send('nav.focus');
  }
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
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('search.toggle');
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

function bindIpc() {
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
    }
  });
}

function ensureOverlayState(win) {
  windowManager.ensureOverlayState(win);
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
    console.log('[AdBlock] Successfully initialized');
  } catch (error) {
    console.error('[AdBlock] Failed to initialize:', error);
  }

  app.commandLine.appendSwitch('disable-quic');

  try {
    ses.preconnect({ url: 'https://www.google.com', numSockets: 4 });
  } catch (e) {}

  createWindow();
  createTray();
  checkAndDownloadUpdate();
  listenUrlLoader();

  // Register global shortcut (uses restored shortcut from session or default)
  // Skip saving on initial registration to avoid overwriting session before tabs are restored
  registerGlobalShortcut(shortcutsManager.getCurrentGlobalShortcut(), true);

  app.on('web-contents-created', (event, contents) => {
    // Increase max listeners to avoid warnings (webviews have many internal listeners)
    contents.setMaxListeners(30);

    bindShortcutsToWebContents(contents);

    if (contents.getType && contents.getType() === 'webview') {
      try {
        // Set webview background based on current theme
        const effectiveTheme = themeManager.getEffectiveTheme(themeManager.getCurrentTheme());
        const bgColor = themeManager.getBackgroundColor(effectiveTheme);
        contents.setBackgroundColor(bgColor);
      } catch (e) {}

      contents.setWindowOpenHandler(({ url }) => {
        if (url) {
          createTab(url);
        }
        return { action: 'deny' };
      });
    }
  });
});

app.on('browser-window-focus', disableDetachedMode);

app.on('activate', function () {
  disableDetachedMode();

  if (mainWindow) {
    ensureOverlayState(mainWindow);

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

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
  // Session already saved in window 'close' event
  shortcutsManager.unregisterAllGlobalShortcuts();
});
