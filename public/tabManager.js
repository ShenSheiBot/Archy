/**
 * Tab Management Module
 * Handles all tab-related operations and state
 */

// Tab state
let tabs = [];
let activeTabId = null;
let nextTabId = 1;

// Pending tab updates (for debouncing)
const pendingUpdates = new Map();

/**
 * Get all tabs
 * @returns {Array} Array of tab objects
 */
function getTabs() {
  return tabs;
}

/**
 * Get active tab ID
 * @returns {number|null} Active tab ID
 */
function getActiveTabId() {
  return activeTabId;
}

/**
 * Set tabs (used for session restoration)
 * @param {Array} newTabs - Array of tab objects
 * @param {number} newActiveTabId - Active tab ID
 * @param {number} newNextTabId - Next tab ID to use
 */
function setTabs(newTabs, newActiveTabId, newNextTabId) {
  tabs = newTabs;
  activeTabId = newActiveTabId;
  if (newNextTabId !== undefined) {
    nextTabId = newNextTabId;
  }
}

/**
 * Create a new tab
 * @param {string} targetUrl - URL to load in the new tab
 * @param {Function} sendUpdateCallback - Callback to send tabs update to renderer
 * @param {Function} notifyRendererCallback - Optional callback to notify renderer (e.g., show nav, focus)
 * @returns {number} The new tab ID
 */
function createTab(targetUrl = '', sendUpdateCallback, notifyRendererCallback) {
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

  if (sendUpdateCallback) {
    sendUpdateCallback();
  }

  if (notifyRendererCallback) {
    notifyRendererCallback();
  }

  return tabId;
}

/**
 * Switch to a specific tab
 * @param {number} tabId - Tab ID to switch to
 * @param {Function} sendUpdateCallback - Callback to send tabs update to renderer
 * @returns {boolean} True if successful
 */
function switchToTab(tabId, sendUpdateCallback) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return false;

  activeTabId = tabId;

  if (sendUpdateCallback) {
    sendUpdateCallback();
  }

  return true;
}

/**
 * Close a tab
 * @param {number} tabId - Tab ID to close
 * @param {Function} sendUpdateCallback - Callback to send tabs update to renderer
 * @returns {boolean} True if successful
 */
function closeTab(tabId, sendUpdateCallback) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return false;

  tabs.splice(tabIndex, 1);

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newActiveIndex = Math.min(tabIndex, tabs.length - 1);
      activeTabId = tabs[newActiveIndex].id;
    } else {
      activeTabId = null;
    }
  }

  if (sendUpdateCallback) {
    sendUpdateCallback();
  }

  return true;
}

/**
 * Navigate a tab to a URL
 * @param {number} tabId - Tab ID to navigate
 * @param {string} targetUrl - URL to navigate to
 * @param {Function} sendUpdateCallback - Callback to send tabs update to renderer
 * @returns {boolean} True if successful
 */
function navigateTab(tabId, targetUrl, sendUpdateCallback) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return false;

  tab.url = targetUrl;

  if (sendUpdateCallback) {
    sendUpdateCallback();
  }

  return true;
}

/**
 * Update tab properties (debounced)
 * @param {number} tabId - Tab ID to update
 * @param {Object} updates - Properties to update
 * @param {Function} sendUpdateCallback - Callback to send tabs update to renderer
 * @returns {boolean} True if tab found
 */
function updateTab(tabId, updates, sendUpdateCallback) {
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex === -1) return false;

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

      if (hasChanges && sendUpdateCallback) {
        sendUpdateCallback();
      }

      pendingUpdates.delete(tabId);
    }, 64);
  }

  pendingUpdates.set(tabId, pending);
  return true;
}

/**
 * Get serializable tabs data for IPC
 * @returns {Object} Tabs data
 */
function getTabsData() {
  return {
    tabs: tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      favicon: t.favicon,
      loading: t.loading
    })),
    activeTabId: activeTabId
  };
}

/**
 * Clear all tabs (for cleanup)
 */
function clearTabs() {
  tabs = [];
  activeTabId = null;
  pendingUpdates.clear();
}

module.exports = {
  getTabs,
  getActiveTabId,
  setTabs,
  createTab,
  switchToTab,
  closeTab,
  navigateTab,
  updateTab,
  getTabsData,
  clearTabs
};
