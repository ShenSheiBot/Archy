const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script for NavBar WebContentsView
 *
 * Exposes a limited IPC API to the navbar renderer process
 * This runs in an isolated context with access to both Node.js and the DOM
 */

// Get platform info before exposing to renderer
const platform = process.platform;

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => {
      // Whitelist channels that navbar can send to main process
      const validChannels = [
        // Tab operations
        'tab.create',
        'tab.close',
        'tab.switch',
        'tab.navigate',
        'tab.reload',
        'tab.back',
        'tab.forward',

        // Navigation and settings
        'nav.hide',
        'nav.show',
        'settings.toggle',
        'theme.set',
        'opacity.set',
        'shortcut.set',
        'shortcut.unregister',
        'startup.behavior.set',
        'startup.url.set',

        // Fullscreen
        'fullscreen.enter',
        'fullscreen.leave',

        // Debug logging
        'log'
      ];

      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      } else {
        console.warn(`[navbar-preload] Blocked attempt to send to invalid channel: ${channel}`);
      }
    },

    on: (channel, func) => {
      // Whitelist channels that navbar can receive from main process
      const validChannels = [
        // Tab updates
        'tabs.update',

        // Navigation control
        'nav.focus',
        'nav.show',
        'nav.hide',
        'nav.toggle',

        // Search functionality
        'search.toggle',

        // Zoom indicator
        'zoom.changed',

        // Fullscreen events
        'fullscreen.enter',
        'fullscreen.leave',

        // Settings
        'settings.toggle',
        'opacity.sync'
      ];

      if (validChannels.includes(channel)) {
        // Strip event as it includes `sender` for security
        ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
      } else {
        console.warn(`[navbar-preload] Blocked attempt to listen on invalid channel: ${channel}`);
      }
    },

    removeListener: (channel, func) => {
      const validChannels = [
        'tabs.update',
        'nav.focus',
        'nav.show',
        'nav.hide',
        'nav.toggle',
        'search.toggle',
        'zoom.changed',
        'fullscreen.enter',
        'fullscreen.leave',
        'settings.toggle',
        'opacity.sync'
      ];

      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, func);
      }
    },

    sendSync: (channel) => {
      // Whitelist sync channels (use sparingly for performance)
      const validChannels = [
        'opacity.get',
        'theme.get',
        'shortcut.get',
        'tabs.get',
        'startup.behavior.get',
        'startup.url.get'
      ];

      if (validChannels.includes(channel)) {
        return ipcRenderer.sendSync(channel);
      }

      console.warn(`[navbar-preload] Blocked attempt to sendSync on invalid channel: ${channel}`);
      return null;
    }
  },

  platform: platform
});
