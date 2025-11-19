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

  // Set nativeTheme.themeSource to affect prefers-color-scheme in all webContents
  // This makes websites automatically switch to dark mode
  // Only update if different to avoid triggering nativeTheme.on('updated') loop
  if (nativeTheme.themeSource !== theme) {
    nativeTheme.themeSource = theme;
  }

  // Update background color
  const bgColor = getBackgroundColor(effectiveTheme);

  // Update main window background
  try {
    mainWindow.setBackgroundColor(bgColor);
  } catch (e) {}

  // Apply theme to NavBarView
  if (mainWindow.viewManager && mainWindow.viewManager.navBarView) {
    const navBarWC = mainWindow.viewManager.navBarView.webContents;
    if (navBarWC && !navBarWC.isDestroyed() && !navBarWC.isLoading()) {
      navBarWC.executeJavaScript(`
        document.documentElement.setAttribute('data-theme', '${effectiveTheme}');
      `).catch(err => {
        // Silently ignore errors
      });
    }
  }

  // Apply theme to OverlayView
  if (mainWindow.viewManager && mainWindow.viewManager.overlayView) {
    const overlayWC = mainWindow.viewManager.overlayView.webContents;
    if (overlayWC && !overlayWC.isDestroyed() && !overlayWC.isLoading()) {
      overlayWC.executeJavaScript(`
        document.documentElement.setAttribute('data-theme', '${effectiveTheme}');
      `).catch(err => {
        // Silently ignore errors
      });
    }
  }

  // Apply theme to all content views
  if (mainWindow.viewManager && mainWindow.viewManager.contentViews) {
    mainWindow.viewManager.contentViews.forEach((view, tabId) => {
      try {
        view.setBackgroundColor(bgColor);
      } catch (e) {
        // View might be destroyed
      }
    });
  }
}

module.exports = {
  getCurrentTheme,
  setCurrentTheme,
  getEffectiveTheme,
  getBackgroundColor,
  applyTheme
};
