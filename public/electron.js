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

const { setMainMenu } = require('./menu');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');

let mainWindow;
let isWindowVisible = true;
let tray = null;

let tabs = [];
let activeTabId = null;
let nextTabId = 1;
let tabShortcutsBound = false;

const pendingUpdates = new Map();

// Theme state management
let currentTheme = 'system';  // 'system', 'light', 'dark'

// Session file path
const sessionFilePath = path.join(app.getPath('userData'), 'session.json');

// Save session to disk
function saveSession() {
  try {
    const session = {
      tabs: tabs.map(t => ({
        url: t.url,
        title: t.title,
        favicon: t.favicon
      })),
      activeTabId: activeTabId,
      theme: currentTheme
    };

    // Save window bounds and opacity if window exists
    if (mainWindow && !mainWindow.isDestroyed()) {
      const bounds = mainWindow.getBounds();
      const opacity = mainWindow.getOpacity();
      session.windowBounds = bounds;
      session.opacity = opacity;
      console.log('[Session] Saved window bounds:', bounds, 'opacity:', opacity);
    }

    fs.writeFileSync(sessionFilePath, JSON.stringify(session, null, 2));
    console.log('[Session] Saved session:', session.tabs.length, 'tabs');
  } catch (err) {
    console.error('[Session] Failed to save:', err);
  }
}

// Load session from disk
function loadSession() {
  try {
    if (!fs.existsSync(sessionFilePath)) {
      console.log('[Session] No saved session found');
      return null;
    }

    const data = fs.readFileSync(sessionFilePath, 'utf8');
    const session = JSON.parse(data);
    console.log('[Session] Loaded session:', session.tabs?.length || 0, 'tabs');
    return session;
  } catch (err) {
    console.error('[Session] Failed to load:', err);
    return null;
  }
}

// Restore session
function restoreSession() {
  const session = loadSession();
  if (!session || !session.tabs || session.tabs.length === 0) {
    return false;
  }

  // Restore theme
  if (session.theme) {
    currentTheme = session.theme;
  }

  // Restore tabs
  session.tabs.forEach((tabData, index) => {
    const tabId = nextTabId++;
    const tab = {
      id: tabId,
      url: tabData.url || '',
      title: tabData.title || 'New Tab',
      favicon: tabData.favicon || null,
      loading: false
    };
    tabs.push(tab);
  });

  // Restore active tab (use first tab if activeTabId is invalid)
  if (tabs.length > 0) {
    activeTabId = tabs[0].id;
  }

  sendTabsUpdate();
  return true;
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

  // Apply theme to renderer
  mainWindow.webContents.executeJavaScript(`
    console.log('[Theme] Setting data-theme to: ${effectiveTheme}');
    document.documentElement.setAttribute('data-theme', '${effectiveTheme}');
    console.log('[Theme] Current data-theme:', document.documentElement.getAttribute('data-theme'));
  `).then(() => {
    console.log(`[Theme] Successfully set data-theme to: ${effectiveTheme}`);
  }).catch(err => {
    console.error('[Theme] Failed to apply theme:', err);
  });

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
    mainWindow.webContents.executeJavaScript(jsCode);

    // Apply initial theme
    applyTheme(currentTheme);

    // Restore session after page loads
    restoreSession();
  });

  mainWindow.on('ready-to-show', () => {
    if (tabs.length === 0) {
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

function createTab(targetUrl = '') {
  const tabId = nextTabId++;

  const tab = {
    id: tabId,
    url: targetUrl || '',
    title: 'New Tab',
    favicon: null,
    loading: false
  };

  tabs.push(tab);
  activeTabId = tabId;
  sendTabsUpdate();

  if (mainWindow && mainWindow.webContents) {
    mainWindow.webContents.send('nav.show');
    mainWindow.webContents.send('nav.focus');
  }

  return tabId;
}

function switchToTab(tabId) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  activeTabId = tabId;
  sendTabsUpdate();
}

function closeTab(tabId) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return;

  tabs.splice(tabIndex, 1);

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newActiveIndex = Math.min(tabIndex, tabs.length - 1);
      activeTabId = tabs[newActiveIndex].id;
    } else {
      activeTabId = null;
    }
  }

  sendTabsUpdate();
}

function navigateTab(tabId, targetUrl) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return;

  tab.url = targetUrl;
  sendTabsUpdate();
}

function sendTabsUpdate() {
  if (!mainWindow) return;

  const tabsList = tabs.map(t => ({
    id: t.id,
    url: t.url,
    title: t.title,
    favicon: t.favicon,
    loading: t.loading
  }));

  mainWindow.webContents.send('tabs.update', {
    tabs: tabsList,
    activeTabId: activeTabId
  });
}

function bindShortcutsToWebContents(webContents) {
  webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.key === 't' && input.type === 'keyDown') {
      event.preventDefault();
      createTab('');
      return;
    }

    if (input.meta && input.key === 'w' && input.type === 'keyDown') {
      event.preventDefault();
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

function bindIpc() {
  ipcMain.removeAllListeners('opacity.get');
  ipcMain.removeAllListeners('opacity.set');
  ipcMain.removeAllListeners('theme.get');
  ipcMain.removeAllListeners('theme.set');
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
    const tabIndex = tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const pending = pendingUpdates.get(tabId) || { data: {}, timer: null };
    Object.assign(pending.data, updates);

    if (!pending.timer) {
      pending.timer = setTimeout(() => {
        const tab = tabs[tabIndex];
        let hasChanges = false;

        for (const [key, value] of Object.entries(pending.data)) {
          if (tab[key] !== value) {
            tab[key] = value;
            hasChanges = true;
          }
        }

        if (hasChanges) {
          sendTabsUpdate();
        }

        pendingUpdates.delete(tabId);
      }, 64);
    }

    pendingUpdates.set(tabId, pending);
  });

  ipcMain.on('tabs.get', (event) => {
    event.returnValue = {
      tabs: tabs.map(t => ({
        id: t.id,
        url: t.url,
        title: t.title,
        favicon: t.favicon,
        loading: t.loading
      })),
      activeTabId: activeTabId
    };
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
    const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
      enableCompression: true,
    });
    blocker.enableBlockingInSession(ses);
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

  globalShortcut.register('Control+Alt+Shift+0', () => {
    toggleWindow();
  });

  app.on('web-contents-created', (event, contents) => {
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
