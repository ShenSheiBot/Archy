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
        'globalZoom.set',
        'detachedOpacity.set',
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
        'detached.exit',
        'fullscreen.dragbar.show',
        'fullscreen.dragbar.hide'
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
        'detached.exit',
        'fullscreen.dragbar.show',
        'fullscreen.dragbar.hide'
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
        'startup.url.get',
        'globalZoom.get',
        'detachedOpacity.get'
      ];
      if (validChannels.includes(channel)) {
        return ipcRenderer.sendSync(channel);
      }
    }
  },
  platform: platform
});

// 阻止链接拖放到外部浏览器
document.addEventListener('dragstart', (e) => {
  // 如果拖动的是链接，阻止默认行为
  if (e.target.tagName === 'A' || e.target.closest('a')) {
    e.preventDefault();
  }
}, true);

document.addEventListener('drop', (e) => {
  e.preventDefault();
}, true);

document.addEventListener('dragover', (e) => {
  e.preventDefault();
}, true);
