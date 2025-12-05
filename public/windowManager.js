const { screen, systemPreferences, powerMonitor, app } = require('electron');

/**
 * Window Management Module
 * Handles window state, visibility, and overlay behavior
 */

let isWindowVisible = true;
let monitorStarted = false;
const monitorTimers = new Map(); // Per-window monitoring timers
let isDetachedMode = false;
let navbarVisibleBeforeDetached = true; // Save navbar state before entering detached mode
let opacityBeforeDetached = 1.0; // Save opacity before entering detached mode (0-1)

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
 * @param {Object} options - Options object with getDetachedOpacity function
 */
function toggleDetachedMode(mainWindow, options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  isDetachedMode = !isDetachedMode;

  if (isDetachedMode) {
    // Enter detached mode
    // Save current opacity before switching
    opacityBeforeDetached = mainWindow.getOpacity();

    // Apply detached opacity if provided
    if (options.getDetachedOpacity) {
      const detachedOpacity = options.getDetachedOpacity();
      mainWindow.setOpacity(detachedOpacity / 100);
    }

    // Save current navbar visibility state
    if (mainWindow.viewManager) {
      navbarVisibleBeforeDetached = mainWindow.viewManager.showNav;

      // Always hide navbar in detached mode
      if (navbarVisibleBeforeDetached) {
        mainWindow.viewManager.setNavBarVisible(false);

        // Notify navbar to update its state
        if (mainWindow.viewManager.navBarView) {
          mainWindow.viewManager.navBarView.webContents.send('nav.hide');
        }
      }
    }

    mainWindow.setIgnoreMouseEvents(true, { forward: true });

    // Disable pointer events on all tabs to prevent hover effects
    if (mainWindow.viewManager) {
      mainWindow.viewManager.setDetachedModeForAllTabs(true);
    }

    mainWindow.webContents.send('detached.enter');

    // Hide macOS traffic lights
    if (process.platform === 'darwin') {
      mainWindow.setWindowButtonVisibility(false);
    }
  } else {
    // Exit detached mode
    // Restore original opacity
    mainWindow.setOpacity(opacityBeforeDetached);

    // Re-enable pointer events on all tabs
    if (mainWindow.viewManager) {
      mainWindow.viewManager.setDetachedModeForAllTabs(false);
    }

    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.webContents.send('detached.exit');

    // Restore navbar visibility to previous state
    if (mainWindow.viewManager && navbarVisibleBeforeDetached) {
      mainWindow.viewManager.setNavBarVisible(true);

      // Notify navbar to update its state
      if (mainWindow.viewManager.navBarView) {
        mainWindow.viewManager.navBarView.webContents.send('nav.show');
      }

      // Restore macOS traffic lights if navbar is shown
      if (process.platform === 'darwin') {
        mainWindow.setWindowButtonVisibility(true);
      }
    }
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

    // Re-enable with strong settings (level 22, same as iTerm2 floating)
    win.setAlwaysOnTop(true, 'main-menu', -2);
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    if (typeof win.moveTop === 'function') {
      win.moveTop();
    }
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
 * Uses iTerm2-style async activation pattern for proper focus handling
 * @param {BrowserWindow} mainWindow - Main window instance
 */
function toggleWindow(mainWindow) {
  if (!mainWindow) return;

  // Load native module once
  let nativeWindow;
  try {
    nativeWindow = require('./window-native.node');
  } catch (e) {
    console.log('[WindowManager] Native module not available:', e.message);
  }

  if (isWindowVisible) {
    // === HIDE WINDOW ===
    // First, restore focus to the previous app (like iTerm2)
    if (nativeWindow) {
      nativeWindow.restorePreviousApp();
      nativeWindow.orderOut();
    } else {
      mainWindow.hide();
    }
    isWindowVisible = false;
  } else {
    // === SHOW WINDOW ===
    // 1. Save the currently active app BEFORE we activate ourselves (like iTerm2's storePreviouslyActiveApp)
    if (nativeWindow) {
      nativeWindow.savePreviousApp();
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    // Show window first (keep window on its original screen, don't follow mouse)
    mainWindow.show();

    if (typeof mainWindow.moveTop === 'function') {
      mainWindow.moveTop();
    }

    // 3. Basic focus attempt (simulateClick will be called in finishActivation)
    if (!nativeWindow) {
      // Fallback without native module
      mainWindow.focus();
      require('electron').app.focus({ steal: true });
    }

    // Set webContents focus after a delay to ensure activation is complete
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        finishActivation(mainWindow, nativeWindow);
      }
    }, 150);

    isWindowVisible = true;

    // Restore detached mode state if it was active
    if (isDetachedMode) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
      mainWindow.webContents.send('detached.restore');

      if (mainWindow.viewManager) {
        mainWindow.viewManager.setNavBarVisible(false);
        mainWindow.viewManager.setDetachedModeForAllTabs(true);
        if (mainWindow.viewManager.navBarView) {
          mainWindow.viewManager.navBarView.webContents.send('nav.hide');
        }
      }

      if (process.platform === 'darwin') {
        mainWindow.setWindowButtonVisibility(false);
      }
    }

    // Force redraw to fix blurry text
    forceRedraw(mainWindow);
  }
}

/**
 * Finish activation after app becomes active (like iTerm2's rollInFinished)
 * @param {BrowserWindow} mainWindow - Main window instance
 * @param {Object} nativeWindow - Native module (optional)
 */
function finishActivation(mainWindow, nativeWindow) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Simulate click to force focus transfer from apps like iTerm2
  // This is done here (after delay) to ensure window is fully visible
  if (nativeWindow && nativeWindow.simulateClick) {
    nativeWindow.simulateClick();
  }

  // Focus the active tab's webContents (like iTerm2's makeFirstResponder)
  if (mainWindow.viewManager) {
    const activeView = mainWindow.viewManager.getActiveView();
    if (activeView && activeView.webContents && !activeView.webContents.isDestroyed()) {
      activeView.webContents.focus();
      console.log('[WindowManager] ✓ Focused webContents');
    }
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

    // Start app activation tracking (for proper focus restore)
    if (nativeWindow.startAppTracking) {
      nativeWindow.startAppTracking();
    }

    // Try with handle first, but module will auto-find window if handle is invalid
    try {
      const nativeHandle = win.getNativeWindowHandle();
      nativeWindow.setWindowLevel(nativeHandle, 'iterm'); // Level 22, same as iTerm2 floating
      nativeWindow.setCollectionBehavior(nativeHandle, ['canJoinAllSpaces', 'fullScreenAuxiliary']);
    } catch (handleErr) {
      // Fallback: call without handle (auto-find window)
      nativeWindow.setWindowLevel('iterm'); // Level 22, same as iTerm2 floating
      nativeWindow.setCollectionBehavior(['canJoinAllSpaces', 'fullScreenAuxiliary']);
    }

    console.log('[WindowManager] ✓ Native window configuration applied');
  } catch (err) {
    console.log('[WindowManager] Native module not available:', err.message);
    // Fallback to Electron APIs if native module not available
    console.log('[WindowManager] Native module not available, using Electron APIs');
    win.setAlwaysOnTop(true, 'main-menu', -2); // Level 22, same as iTerm2 floating
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
