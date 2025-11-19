const { contextBridge, ipcRenderer } = require('electron');
const platform = process.platform;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    send: (channel, data) => {
      // whitelist channels
      const validChannels = [
        'opacity.set',
        'theme.set',
        'shortcut.set',
        'shortcut.unregister',
        'tab.create',
        'tab.close',
        'tab.switch',
        'tab.navigate',
        'tab.update',
        'nav.hide',
        'nav.show',
        'nav.toggle',
        'settings.toggle',
        'overlay.mouse-events',
        'startup.behavior.set',
        'startup.url.set',
        'fullscreen.enter',
        'fullscreen.leave',
        'traffic-lights.show',
        'search.find',
        'search.clear'
        // reload, back, forward are handled by WebContentsView in main process
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.send(channel, data);
      }
    },
    on: (channel, func) => {
      const validChannels = [
        'embedVideos.set',
        'url.requested',
        'nav.toggle',
        'nav.show',
        'nav.hide',
        'nav.focus',
        'webPage.reload',
        'load-url',
        'tabs.update',
        'settings.toggle',
        'search.toggle',
        'search.result',
        'zoom.in',
        'zoom.out',
        'zoom.reset',
        'detached.enter',
        'detached.restore',
        'detached.exit'
      ];
      if (validChannels.includes(channel)) {
        // Deliberately strip event as it includes `sender`
        ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
      }
    },
    removeListener: (channel, func) => {
      const validChannels = [
        'embedVideos.set',
        'url.requested',
        'opacity.toggle',
        'nav.show',
        'nav.hide',
        'nav.focus',
        'tabs.update',
        'webPage.reload',
        'settings.toggle',
        'search.toggle',
        'zoom.in',
        'zoom.out',
        'zoom.reset',
        'detached.enter',
        'detached.restore',
        'detached.exit'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, func);
      }
    },
    sendSync: (channel) => {
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
    }
  },
  platform: platform
});
