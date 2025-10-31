const { screen, systemPreferences, powerMonitor, app } = require('electron');

/**
 * Window Management Module
 * Handles window state, visibility, and overlay behavior
 */

let isWindowVisible = true;
let monitorStarted = false;
const monitorTimers = new Map(); // Per-window monitoring timers
let isDetachedMode = false;

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
 * Get detached mode state
 * @returns {boolean} Detached mode state
 */
function getDetachedMode() {
  return isDetachedMode;
}

/**
 * Set detached mode state
 * @param {boolean} detached - Detached mode state
 */
function setDetachedMode(detached) {
  isDetachedMode = detached;
}

/**
 * Toggle detached mode
 * @param {BrowserWindow} mainWindow - Main window instance
 */
function toggleDetachedMode(mainWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  isDetachedMode = !isDetachedMode;

  if (isDetachedMode) {
    // Enter detached mode
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    // Don't send nav.hide - let renderer save state first, then hide navbar itself
    mainWindow.webContents.send('detached.enter');
    if (process.platform === 'darwin') {
      mainWindow.setWindowButtonVisibility(false);
    }
  } else {
    // Exit detached mode
    mainWindow.setIgnoreMouseEvents(false);
    // Don't send nav.show - let renderer restore its saved state
    mainWindow.webContents.send('detached.exit');
    // Don't show traffic lights here - let renderer decide based on navbar state
  }
}

/**
 * Ensure window stays on top with overlay state
 * Now just calls configureNativeWindow for simplicity
 * @param {BrowserWindow} win - Window instance
 * @param {string} reason - Reason for calling (for debugging)
 */
function ensureOverlayState(win, reason = 'ensure') {
  configureNativeWindow(win);
}

/**
 * Hard bounce overlay state (only when confirmed invisible)
 * Temporarily disables then re-enables to force macOS re-evaluation
 * @param {BrowserWindow} win - Window instance
 * @param {string} reason - Reason for calling (for debugging)
 */
function hardBounceOverlay(win, reason = 'hard-bounce') {
  if (!win || win.isDestroyed()) return;

  try {
    // Temporarily disable
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);

    // Re-enable with strong settings
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (typeof win.moveTop === 'function') {
      win.moveTop();
    }

    console.log(`[WindowManager] ⚡ hardBounceOverlay(${reason}) done`);
  } catch (err) {
    console.error(`[WindowManager] Failed to hard bounce (${reason}):`, err);
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

    mainWindow.show();  // Changed from showInactive() to show() for better rendering

    if (typeof mainWindow.moveTop === 'function') {
      mainWindow.moveTop();
    }

    // Force focus on main window to ensure keyboard shortcuts work immediately
    mainWindow.focus();
    require('electron').app.focus({ steal: true });

    isWindowVisible = true;

    // Restore detached mode state if it was active
    if (isDetachedMode) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      // Send detached.restore (not detached.enter) to apply state without re-saving
      mainWindow.webContents.send('detached.restore');
      if (process.platform === 'darwin') {
        mainWindow.setWindowButtonVisibility(false);
      }
    }

    // Force redraw to fix blurry text
    forceRedraw(mainWindow);
  }
}

/**
 * Disable detached mode (restore normal mouse interaction)
 * Note: This is now a legacy function. Detached mode is controlled by user via global shortcut.
 * This function only clears the dock badge and does NOT change detached mode state.
 * @param {BrowserWindow} mainWindow - Main window instance
 * @param {Electron.App} app - App instance
 */
function disableDetachedMode(mainWindow, app) {
  app.dock && app.dock.setBadge('');

  // Don't automatically exit detached mode - it's now user-controlled
  // Users must press the global shortcut (Cmd+Shift+D) to toggle
}

/**
 * Configure native window properties using Objective-C bridge
 * This is the ONLY reliable way to ensure window stays on top across all Spaces
 * @param {BrowserWindow} win - Window instance
 */
function configureNativeWindow(win) {
  if (!win || win.isDestroyed() || process.platform !== 'darwin') return;

  try {
    // Try to load native module if available
    const nativeWindow = require('./window-native.node');

    // Try with handle first, but module will auto-find window if handle is invalid
    try {
      const nativeHandle = win.getNativeWindowHandle();
      nativeWindow.setWindowLevel(nativeHandle, 'screen-saver');
      nativeWindow.setCollectionBehavior(nativeHandle, ['canJoinAllSpaces', 'fullScreenAuxiliary']);
    } catch (handleErr) {
      // Fallback: call without handle (auto-find window)
      nativeWindow.setWindowLevel('screen-saver');
      nativeWindow.setCollectionBehavior(['canJoinAllSpaces', 'fullScreenAuxiliary']);
    }

    console.log('[WindowManager] ✓ Native window configuration applied');
  } catch (err) {
    console.log('[WindowManager] Native module not available:', err.message);
    // Fallback to Electron APIs if native module not available
    console.log('[WindowManager] Native module not available, using Electron APIs');
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    if (typeof win.moveTop === 'function') {
      win.moveTop();
    }
  }
}

/**
 * Dummy functions for compatibility (no longer needed with native approach)
 */
function startOverlayMonitor(win, intervalMs = 60000) {
  // No-op: native configuration is set once and persists
  console.log('[WindowManager] Overlay monitoring disabled (using native configuration)');
}

function stopOverlayMonitor(win) {
  // No-op: nothing to stop
}

module.exports = {
  getWindowVisible,
  setWindowVisible,
  getDetachedMode,
  setDetachedMode,
  toggleDetachedMode,
  ensureOverlayState,
  configureNativeWindow,
  hardBounceOverlay,
  forceRedraw,
  toggleWindow,
  disableDetachedMode,
  startOverlayMonitor,
  stopOverlayMonitor
};
