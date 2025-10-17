const { Tray, Menu, nativeImage } = require('electron');
const path = require('path');

/**
 * Tray Manager Module
 * Handles system tray icon and menu
 */

let tray = null;

/**
 * Create system tray
 * @param {Object} callbacks - Callback functions for tray menu items
 */
function createTray(callbacks) {
  const { toggleWindow, createTab, showSettings, quitApp } = callbacks;

  const iconPath = path.join(__dirname, 'img/iconTemplate.png');
  const icon = nativeImage.createFromPath(iconPath);

  tray = new Tray(icon);
  tray.setToolTip('Archy - Floating Browser');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide Window',
      click: () => {
        toggleWindow();
      }
    },
    {
      label: 'New Tab',
      accelerator: 'CmdOrCtrl+T',
      click: () => {
        createTab('');
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        showSettings();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        quitApp();
      }
    }
  ]);

  tray.on('click', () => {
    toggleWindow();
  });

  tray.on('right-click', () => {
    tray.popUpContextMenu(contextMenu);
  });

  return tray;
}

/**
 * Get tray instance
 * @returns {Tray} Tray instance
 */
function getTray() {
  return tray;
}

module.exports = {
  createTray,
  getTray
};
