const { globalShortcut } = require('electron');

/**
 * Shortcuts Management Module
 * Handles global shortcuts and keyboard bindings
 */

// Global shortcut state
let currentGlobalShortcut = 'Control+Alt+Shift+0';

/**
 * Get current global shortcut
 * @returns {string} Current global shortcut
 */
function getCurrentGlobalShortcut() {
  return currentGlobalShortcut;
}

/**
 * Set current global shortcut
 * @param {string} shortcut - Shortcut to set
 */
function setCurrentGlobalShortcut(shortcut) {
  currentGlobalShortcut = shortcut;
}

/**
 * Register global shortcut
 * @param {string} shortcut - Shortcut to register
 * @param {Function} callback - Callback to execute when shortcut is triggered
 * @param {boolean} skipSave - Skip saving session after registration
 * @returns {boolean} Success status
 */
function registerGlobalShortcut(shortcut, callback, skipSave = false) {
  // Unregister previous shortcut
  globalShortcut.unregisterAll();

  // Register new shortcut
  try {
    const success = globalShortcut.register(shortcut, callback);

    if (success) {
      console.log(`[Shortcut] Successfully registered: ${shortcut}`);
      currentGlobalShortcut = shortcut;
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

/**
 * Unregister all global shortcuts
 */
function unregisterAllGlobalShortcuts() {
  globalShortcut.unregisterAll();
  console.log('[Shortcut] Unregistered all global shortcuts');
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
  registerGlobalShortcut,
  unregisterAllGlobalShortcuts,
  bindShortcutsToWebContents
};
