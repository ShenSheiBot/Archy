const { nativeTheme } = require('electron');

/**
 * Theme Management Module
 * Handles theme state and application
 */

// Theme state
let currentTheme = 'system';  // 'system', 'light', 'dark'

/**
 * Get current theme
 * @returns {string} Current theme ('system', 'light', or 'dark')
 */
function getCurrentTheme() {
  return currentTheme;
}

/**
 * Set current theme
 * @param {string} theme - Theme to set
 */
function setCurrentTheme(theme) {
  currentTheme = theme;
}

/**
 * Get effective theme (resolves 'system' to actual theme)
 * @param {string} theme - Theme setting
 * @returns {string} Effective theme ('light' or 'dark')
 */
function getEffectiveTheme(theme) {
  if (theme === 'system') {
    return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  }
  return theme;
}

/**
 * Get background color for theme
 * @param {string} effectiveTheme - Effective theme ('light' or 'dark')
 * @returns {string} Background color hex
 */
function getBackgroundColor(effectiveTheme) {
  return effectiveTheme === 'dark' ? '#1c1c1e' : '#F8F9FA';
}

/**
 * Apply theme to main window and webviews
 * @param {string} theme - Theme to apply
 * @param {BrowserWindow} mainWindow - Main window instance
 */
function applyTheme(theme, mainWindow) {
  currentTheme = theme;

  if (!mainWindow || mainWindow.isDestroyed()) return;

  const effectiveTheme = getEffectiveTheme(theme);

  console.log(`[Theme] Applying theme: ${theme} (effective: ${effectiveTheme})`);

  // Wait for webContents to be ready
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', () => {
      applyTheme(theme, mainWindow);
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
  const bgColor = getBackgroundColor(effectiveTheme);

  // Update main window background
  try {
    mainWindow.setBackgroundColor(bgColor);
  } catch (e) {}

  // Update all webviews
  const { webContents } = require('electron');
  const allWebContents = webContents.getAllWebContents();
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

module.exports = {
  getCurrentTheme,
  setCurrentTheme,
  getEffectiveTheme,
  getBackgroundColor,
  applyTheme
};
