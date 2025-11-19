const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// Session file path
const sessionFilePath = path.join(app.getPath('userData'), 'session.json');

/**
 * Save session to disk
 * @param {Object} sessionData - The session data to save
 * @param {Array} sessionData.tabs - Array of tab objects
 * @param {number} sessionData.activeTabId - Currently active tab ID
 * @param {string} sessionData.theme - Current theme setting
 * @param {string} sessionData.globalShortcut - Current global shortcut
 * @param {Object} sessionData.windowBounds - Window position and size
 * @param {number} sessionData.opacity - Window opacity
 */
function saveSession(sessionData) {
  try {
    fs.writeFileSync(sessionFilePath, JSON.stringify(sessionData, null, 2));
  } catch (err) {
    console.error('[Session] Failed to save:', err);
  }
}

/**
 * Load session from disk
 * @returns {Object|null} The loaded session data or null if not found
 */
function loadSession() {
  try {
    if (!fs.existsSync(sessionFilePath)) {
      return null;
    }

    const data = fs.readFileSync(sessionFilePath, 'utf8');
    const session = JSON.parse(data);
    return session;
  } catch (err) {
    console.error('[Session] Failed to load:', err);
    return null;
  }
}

module.exports = {
  saveSession,
  loadSession,
  sessionFilePath
};
