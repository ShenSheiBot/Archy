const { contextBridge, ipcRenderer } = require('electron');
const os = require('os');

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
        'tab.update'
        // reload, back, forward, search are handled directly by webview in renderer
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
        'nav.focus',
        'webPage.reload',
        'load-url',
        'tabs.update',
        'search.toggle'
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
        'nav.focus',
        'tabs.update',
        'webPage.reload',
        'search.toggle'
      ];
      if (validChannels.includes(channel)) {
        ipcRenderer.removeListener(channel, func);
      }
    },
    sendSync: (channel) => {
      const validChannels = ['opacity.get', 'theme.get', 'shortcut.get', 'tabs.get'];
      if (validChannels.includes(channel)) {
        return ipcRenderer.sendSync(channel);
      }
    }
  },
  platform: os.platform()
});
