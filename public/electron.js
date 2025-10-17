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

let mainWindow;
let isWindowVisible = true;
let tray = null;

let tabShortcutsBound = false;

// Theme state management
let currentTheme = 'system';  // 'system', 'light', 'dark'

// Global shortcut management
let currentGlobalShortcut = 'Control+Alt+Shift+0';

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
    theme: currentTheme,
    globalShortcut: currentGlobalShortcut
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
    currentTheme = session.theme;
  }

  // Restore global shortcut
  if (session.globalShortcut) {
    currentGlobalShortcut = session.globalShortcut;
  }

  // Restore tabs
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

  return false;
}

function applyTheme(theme) {
  currentTheme = theme;

  if (!mainWindow || mainWindow.isDestroyed()) return;

  let effectiveTheme = theme;

  if (theme === 'system') {
    // Use system preference
    effectiveTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }

  console.log(`[Theme] Applying theme: ${theme} (effective: ${effectiveTheme})`);

  // Wait for webContents to be ready
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      applyTheme(theme);
    });
    return;
  }

  // Apply theme to renderer - check if ready first
  if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`
      console.log('[Theme] Setting data-theme to: ${effectiveTheme}');
      document.documentElement.setAttribute('data-theme', '${effectiveTheme}');
      console.log('[Theme] Current data-theme:', document.documentElement.getAttribute('data-theme'));
    `).then(() => {
      console.log(`[Theme] Successfully set data-theme to: ${effectiveTheme}`);
    }).catch(err => {
      // Silently ignore errors during page transitions
      if (err.message && !err.message.includes('context')) {
        console.error('[Theme] Failed to apply theme:', err);
      }
    });
  }

  // Update background color for window and all existing webviews
  const bgColor = effectiveTheme === 'dark' ? '#1c1c1e' : '#F8F9FA';

  // Update main window background
  try {
    mainWindow.setBackgroundColor(bgColor);
  } catch (e) {}

  // Update all webviews
  const allWebContents = require('electron').webContents.getAllWebContents();
  allWebContents.forEach(wc => {
    try {
      if (wc.getType() === 'webview') {
        wc.setBackgroundColor(bgColor);
      }
    } catch (e) {
      // Webview might be destroyed
    }
  });
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
  const effectiveTheme = currentTheme === 'system'
    ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
    : currentTheme;

  const bgColor = effectiveTheme === 'dark' ? '#1c1c1e' : '#F8F9FA';

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
    applyTheme(currentTheme);

    // Restore session after page loads
    restoreSession();
  });

  mainWindow.on('ready-to-show', () => {
    if (tabManager.getTabs().length === 0) {
      mainWindow.setBrowserView(null);
    }

    mainWindow.show();
    isWindowVisible = true;
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
  // Skip if already bound to avoid duplicate listeners
  if (webContents._shortcutsBound) return;
  webContents._shortcutsBound = true;

  webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.key === 't' && input.type === 'keyDown') {
      event.preventDefault();
      createTab('');
      return;
    }

    if (input.meta && input.key === 'w' && input.type === 'keyDown') {
      event.preventDefault();
      const activeTabId = tabManager.getActiveTabId();
      const tabs = tabManager.getTabs();
      if (activeTabId && tabs.length > 0) {
        closeTab(activeTabId);
      } else if (tabs.length === 0 && mainWindow) {
        mainWindow.close();
      }
      return;
    }

    if (input.meta && input.key === 'f' && input.type === 'keyDown') {
      event.preventDefault();
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('search.toggle');
      }
      return;
    }

    // Ctrl+Shift+Tab: Previous tab
    if (input.control && input.shift && input.key === 'Tab' && input.type === 'keyDown') {
      event.preventDefault();
      const activeTabId = tabManager.getActiveTabId();
      const tabs = tabManager.getTabs();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      if (currentIndex > 0) {
        switchToTab(tabs[currentIndex - 1].id);
      } else if (tabs.length > 0) {
        // Wrap to last tab
        switchToTab(tabs[tabs.length - 1].id);
      }
      return;
    }

    // Ctrl+Tab: Next tab
    if (input.control && !input.shift && input.key === 'Tab' && input.type === 'keyDown') {
      event.preventDefault();
      const activeTabId = tabManager.getActiveTabId();
      const tabs = tabManager.getTabs();
      const currentIndex = tabs.findIndex(t => t.id === activeTabId);
      if (currentIndex >= 0 && currentIndex < tabs.length - 1) {
        switchToTab(tabs[currentIndex + 1].id);
      } else if (tabs.length > 0) {
        // Wrap to first tab
        switchToTab(tabs[0].id);
      }
      return;
    }

  });
}

function bindTabShortcuts() {
  if (!mainWindow || tabShortcutsBound) return;

  tabShortcutsBound = true;
  bindShortcutsToWebContents(mainWindow.webContents);
}

function registerGlobalShortcut(shortcut, skipSave = false) {
  // Unregister previous shortcut
  globalShortcut.unregisterAll();

  // Register new shortcut
  try {
    const success = globalShortcut.register(shortcut, () => {
      toggleWindow();
    });

    if (success) {
      console.log(`[Shortcut] Successfully registered: ${shortcut}`);
      currentGlobalShortcut = shortcut;
      // Only save session if explicitly requested (e.g., user changed shortcut)
      if (!skipSave) {
        saveSession();
      }
      return true;
    } else {
      console.error(`[Shortcut] Failed to register: ${shortcut}`);
      return false;
    }
  } catch (err) {
    console.error(`[Shortcut] Error registering: ${shortcut}`, err);
    return false;
  }
}

function bindIpc() {
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

  ipcMain.on('opacity.get', (event) => {
    event.returnValue = mainWindow.getOpacity() * 100;
  });

  ipcMain.on('opacity.set', (event, opacity) => {
    mainWindow.setOpacity(opacity / 100);
  });

  ipcMain.on('theme.get', (event) => {
    event.returnValue = currentTheme;
  });

  ipcMain.on('theme.set', (event, theme) => {
    console.log(`[IPC] Received theme.set: ${theme}`);
    applyTheme(theme);
  });

  ipcMain.on('shortcut.get', (event) => {
    event.returnValue = currentGlobalShortcut;
  });

  ipcMain.on('shortcut.set', (event, shortcut) => {
    console.log(`[IPC] Received shortcut.set: ${shortcut}`);
    registerGlobalShortcut(shortcut);
  });

  ipcMain.on('shortcut.unregister', (event) => {
    console.log(`[IPC] Received shortcut.unregister`);
    globalShortcut.unregisterAll();
  });

  ipcMain.on('tab.create', (event, url) => {
    createTab(url);
  });

  ipcMain.on('tab.close', (event, tabId) => {
    closeTab(tabId);
  });

  ipcMain.on('tab.switch', (event, tabId) => {
    switchToTab(tabId);
  });

  ipcMain.on('tab.navigate', (event, { tabId, url }) => {
    navigateTab(tabId, url);
  });

  ipcMain.on('tab.update', (event, { tabId, updates }) => {
    tabManager.updateTab(tabId, updates, sendTabsUpdate);
  });

  ipcMain.on('tabs.get', (event) => {
    event.returnValue = tabManager.getTabsData();
  });
}

function ensureOverlayState(win) {
  if (!win) return;

  win.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
    skipTransformProcessType: true
  });

  win.setAlwaysOnTop(true, 'pop-up-menu');

  if (process.platform === 'darwin') {
    win.setAlwaysOnTop(true, 'pop-up-menu', 1);
  }
}

function disableDetachedMode() {
  app.dock && app.dock.setBadge('');
  mainWindow && mainWindow.setIgnoreMouseEvents(false);
}

function forceRedraw(win) {
  if (!win || win.isDestroyed()) return;

  // Force compositor refresh on macOS to fix blurry text after show/hide
  if (process.platform === 'darwin') {
    const bounds = win.getBounds();
    // Trigger a minimal resize to force redraw
    win.setBounds({ ...bounds, height: bounds.height + 1 });
    setImmediate(() => {
      if (!win.isDestroyed()) {
        win.setBounds(bounds);
      }
    });
  }
}

function toggleWindow() {
  if (!mainWindow) return;

  if (isWindowVisible) {
    mainWindow.hide();
    isWindowVisible = false;
  } else {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    const cursorPoint = screen.getCursorScreenPoint();
    const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const windowBounds = mainWindow.getBounds();
    const { x, y, width, height } = currentDisplay.workArea;

    const newX = Math.max(x, Math.min(windowBounds.x, x + width - windowBounds.width));
    const newY = Math.max(y, Math.min(windowBounds.y, y + height - windowBounds.height));

    if (newX !== windowBounds.x || newY !== windowBounds.y) {
      mainWindow.setBounds({ x: newX, y: newY });
    }

    ensureOverlayState(mainWindow);
    mainWindow.show();  // Changed from showInactive() to show() for better rendering

    if (typeof mainWindow.moveTop === 'function') {
      mainWindow.moveTop();
    }

    // Force focus on main window to ensure keyboard shortcuts work immediately
    mainWindow.focus();
    app.focus({ steal: true });

    isWindowVisible = true;

    // Force redraw to fix blurry text
    forceRedraw(mainWindow);
  }
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
  const iconPath = path.join(__dirname, 'img/iconTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('Archy - Floating Browser');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide Window',
      click: () => {
        toggleWindow();
      }
    },
    {
      label: 'New Tab',
      accelerator: 'CmdOrCtrl+T',
      click: () => {
        createTab('');
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.webContents.send('nav.show');
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.on('click', () => {
    toggleWindow();
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
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
    if (currentTheme === 'system') {
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
  registerGlobalShortcut(currentGlobalShortcut, true);

  app.on('web-contents-created', (event, contents) => {
    // Increase max listeners to avoid warnings (webviews have many internal listeners)
    contents.setMaxListeners(30);

    bindShortcutsToWebContents(contents);

    if (contents.getType && contents.getType() === 'webview') {
      try {
        // Set webview background based on current theme
        const effectiveTheme = currentTheme === 'system'
          ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
          : currentTheme;

        const bgColor = effectiveTheme === 'dark' ? '#1c1c1e' : '#F8F9FA';
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
  globalShortcut.unregisterAll();
});
