const { globalShortcut } = require('electron');

/**
 * Shortcuts Management Module
 * Handles global shortcuts and keyboard bindings
 */

// Global shortcut state
let globalShortcuts = {
  toggleWindow: 'Control+Alt+Shift+0',
  toggleDetached: 'Command+Shift+D'
};

// Registered callbacks for each shortcut
let shortcutCallbacks = {};

/**
 * Get current global shortcut for toggle window
 * @returns {string} Current global shortcut
 */
function getCurrentGlobalShortcut() {
  return globalShortcuts.toggleWindow;
}

/**
 * Set current global shortcut for toggle window
 * @param {string} shortcut - Shortcut to set
 */
function setCurrentGlobalShortcut(shortcut) {
  globalShortcuts.toggleWindow = shortcut;
}

/**
 * Get detached mode shortcut
 * @returns {string} Detached mode shortcut
 */
function getDetachedModeShortcut() {
  return globalShortcuts.toggleDetached;
}

/**
 * Set detached mode shortcut
 * @param {string} shortcut - Shortcut to set
 */
function setDetachedModeShortcut(shortcut) {
  globalShortcuts.toggleDetached = shortcut;
}

/**
 * Get all global shortcuts
 * @returns {Object} All global shortcuts
 */
function getAllGlobalShortcuts() {
  return { ...globalShortcuts };
}

/**
 * Register a single global shortcut
 * @param {string} key - Key name (e.g., 'toggleWindow', 'toggleDetached')
 * @param {string} shortcut - Shortcut to register
 * @param {Function} callback - Callback to execute when shortcut is triggered
 * @returns {boolean} Success status
 */
function registerSingleGlobalShortcut(key, shortcut, callback) {
  try {
    // Unregister if already exists
    if (globalShortcut.isRegistered(shortcut)) {
      globalShortcut.unregister(shortcut);
    }

    const success = globalShortcut.register(shortcut, callback);

    if (success) {
      globalShortcuts[key] = shortcut;
      shortcutCallbacks[key] = callback;
      return true;
    } else {
      console.error(`[Shortcut] Failed to register ${key}: ${shortcut}`);
      return false;
    }
  } catch (err) {
    console.error(`[Shortcut] Error registering ${key}: ${shortcut}`, err);
    return false;
  }
}

/**
 * Register global shortcut for toggle window
 * @param {string} shortcut - Shortcut to register
 * @param {Function} callback - Callback to execute when shortcut is triggered
 * @param {boolean} skipSave - Skip saving session after registration
 * @returns {boolean} Success status
 */
function registerGlobalShortcut(shortcut, callback, skipSave = false) {
  return registerSingleGlobalShortcut('toggleWindow', shortcut, callback);
}

/**
 * Register detached mode global shortcut
 * @param {string} shortcut - Shortcut to register
 * @param {Function} callback - Callback to execute when shortcut is triggered
 * @returns {boolean} Success status
 */
function registerDetachedModeShortcut(shortcut, callback) {
  return registerSingleGlobalShortcut('toggleDetached', shortcut, callback);
}

/**
 * Unregister all global shortcuts
 */
function unregisterAllGlobalShortcuts() {
  globalShortcut.unregisterAll();
  shortcutCallbacks = {};
}

/**
 * Bind shortcuts to webContents (tab shortcuts, search, etc.)
 * @param {WebContents} webContents - WebContents to bind shortcuts to
 * @param {Object} callbacks - Callbacks for different shortcuts
 */
function bindShortcutsToWebContents(webContents, callbacks) {
  // Skip if already bound to avoid duplicate listeners
  if (webContents._shortcutsBound) return;
  webContents._shortcutsBound = true;

  webContents.on('before-input-event', (event, input) => {
    // Cmd/Ctrl+T: New tab
    if (input.meta && input.key === 't' && input.type === 'keyDown') {
      event.preventDefault();
      if (callbacks.createTab) callbacks.createTab('');
      return;
    }

    // Cmd/Ctrl+W: Close tab or window
    if (input.meta && input.key === 'w' && input.type === 'keyDown') {
      event.preventDefault();
      if (callbacks.closeTab) callbacks.closeTab();
      return;
    }

    // Cmd/Ctrl+F: Toggle search
    if (input.meta && input.key === 'f' && input.type === 'keyDown') {
      event.preventDefault();
      if (callbacks.toggleSearch) callbacks.toggleSearch();
      return;
    }

    // Cmd/Ctrl+R: Reload current tab
    if (input.meta && input.key === 'r' && input.type === 'keyDown') {
      event.preventDefault();
      if (callbacks.reloadTab) callbacks.reloadTab();
      return;
    }

    // Ctrl+Shift+Tab: Previous tab
    if (input.control && input.shift && input.key === 'Tab' && input.type === 'keyDown') {
      event.preventDefault();
      if (callbacks.previousTab) callbacks.previousTab();
      return;
    }

    // Ctrl+Tab: Next tab
    if (input.control && !input.shift && input.key === 'Tab' && input.type === 'keyDown') {
      event.preventDefault();
      if (callbacks.nextTab) callbacks.nextTab();
      return;
    }
  });
}

module.exports = {
  getCurrentGlobalShortcut,
  setCurrentGlobalShortcut,
  getDetachedModeShortcut,
  setDetachedModeShortcut,
  getAllGlobalShortcuts,
  registerGlobalShortcut,
  registerDetachedModeShortcut,
  unregisterAllGlobalShortcuts,
  bindShortcutsToWebContents
};
