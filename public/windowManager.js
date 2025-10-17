const { screen } = require('electron');

/**
 * Window Management Module
 * Handles window state, visibility, and overlay behavior
 */

let isWindowVisible = true;

/**
 * Get window visibility state
 * @returns {boolean} Window visibility
 */
function getWindowVisible() {
  return isWindowVisible;
}

/**
 * Set window visibility state
 * @param {boolean} visible - Visibility state
 */
function setWindowVisible(visible) {
  isWindowVisible = visible;
}

/**
 * Ensure window stays on top with overlay state
 * @param {BrowserWindow} win - Window instance
 */
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

/**
 * Force window redraw to fix rendering issues
 * @param {BrowserWindow} win - Window instance
 */
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

/**
 * Toggle window visibility and position
 * @param {BrowserWindow} mainWindow - Main window instance
 * @param {Function} ensureOverlayCallback - Callback to ensure overlay state
 */
function toggleWindow(mainWindow) {
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
    require('electron').app.focus({ steal: true });

    isWindowVisible = true;

    // Restore navbar and exit detached mode when showing window
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.webContents.send('nav.show');

    // Force redraw to fix blurry text
    forceRedraw(mainWindow);
  }
}

/**
 * Disable detached mode (restore normal mouse interaction)
 * @param {BrowserWindow} mainWindow - Main window instance
 * @param {Electron.App} app - App instance
 */
function disableDetachedMode(mainWindow, app) {
  app.dock && app.dock.setBadge('');
  mainWindow && mainWindow.setIgnoreMouseEvents(false);
}

module.exports = {
  getWindowVisible,
  setWindowVisible,
  ensureOverlayState,
  forceRedraw,
  toggleWindow,
  disableDetachedMode
};
