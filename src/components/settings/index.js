import React from 'react';
import debounce from 'lodash.debounce';

import './style.css';

const { ipcRenderer } = window.electron;

class Settings extends React.Component {
  state = {
    opacity: ipcRenderer.sendSync('opacity.get'),
    theme: ipcRenderer.sendSync('theme.get') || 'system',  // 'system', 'light', 'dark'
    globalShortcut: ipcRenderer.sendSync('shortcut.get') || 'Control+Alt+Shift+0',
    isRecording: false,
    recordedKeys: []
  };

  componentDidMount() {
    ipcRenderer.on('opacity.sync', this.onOpacitySync);
    document.addEventListener('keydown', this.handleKeyDown);
    document.addEventListener('keyup', this.handleKeyUp);
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('opacity.sync', this.onOpacitySync);
    document.removeEventListener('keydown', this.handleKeyDown);
    document.removeEventListener('keyup', this.handleKeyUp);
  }

  // Debounce the setter so to avoid bombarding
  // electron with the opacity change requests
  setOpacity = debounce((opacity) => {
    ipcRenderer.send('opacity.set', opacity);
  }, 400);

  onOpacitySync = (event, opacity) => {
    this.setState({ opacity });
  };

  onOpacityChange = (e) => {
    this.setState({
      opacity: e.target.value
    });

    this.setOpacity(e.target.value);
  };

  onThemeToggle = () => {
    const themeOrder = ['system', 'light', 'dark'];
    const currentIndex = themeOrder.indexOf(this.state.theme);
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length];

    console.log(`[Settings] Theme toggle: ${this.state.theme} → ${nextTheme}`);
    this.setState({ theme: nextTheme });
    ipcRenderer.send('theme.set', nextTheme);
    console.log(`[Settings] Sent theme.set with: ${nextTheme}`);
  };

  getThemeIcon = () => {
    const { theme } = this.state;
    if (theme === 'system') {
      return <i className="fa fa-desktop" title="Follow System"/>;
    } else if (theme === 'light') {
      return <i className="fa fa-sun-o" title="Light Mode"/>;
    } else {
      return <i className="fa fa-moon-o" title="Dark Mode"/>;
    }
  };

  handleKeyDown = (e) => {
    if (!this.state.isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    const keys = new Set(this.state.recordedKeys);

    // Add modifier keys
    if (e.ctrlKey || e.metaKey) keys.add(e.metaKey ? 'Command' : 'Control');
    if (e.altKey) keys.add('Alt');
    if (e.shiftKey) keys.add('Shift');

    // Add the actual key (not a modifier)
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      // Map special keys
      let keyName = e.key;
      if (e.key === ' ') keyName = 'Space';
      else if (e.key.length === 1) keyName = e.key.toUpperCase();

      keys.add(keyName);
    }

    this.setState({ recordedKeys: Array.from(keys) });
  };

  handleKeyUp = (e) => {
    if (!this.state.isRecording) return;

    e.preventDefault();
    e.stopPropagation();
  };

  startRecording = () => {
    this.setState({
      isRecording: true,
      recordedKeys: []
    });
  };

  stopRecording = () => {
    const { recordedKeys } = this.state;

    if (recordedKeys.length >= 2) {
      // Build shortcut string in Electron format
      // Order: Control/Command, Alt, Shift, then key
      const modifiers = [];
      const keys = [];

      if (recordedKeys.includes('Control') || recordedKeys.includes('Command')) {
        modifiers.push(recordedKeys.includes('Command') ? 'Command' : 'Control');
      }
      if (recordedKeys.includes('Alt')) modifiers.push('Alt');
      if (recordedKeys.includes('Shift')) modifiers.push('Shift');

      recordedKeys.forEach(key => {
        if (!['Control', 'Command', 'Alt', 'Shift'].includes(key)) {
          keys.push(key);
        }
      });

      const shortcut = [...modifiers, ...keys].join('+');

      this.setState({
        globalShortcut: shortcut,
        isRecording: false,
        recordedKeys: []
      });

      ipcRenderer.send('shortcut.set', shortcut);
    } else {
      // Need at least modifier + key
      this.setState({
        isRecording: false,
        recordedKeys: []
      });
    }
  };

  cancelRecording = () => {
    this.setState({
      isRecording: false,
      recordedKeys: []
    });
  };

  render() {
    const { isRecording, recordedKeys, globalShortcut } = this.state;
    const displayShortcut = isRecording
      ? (recordedKeys.length > 0 ? recordedKeys.join('+') : 'Press keys...')
      : globalShortcut;

    return (
      <div className='settings-wrap'>
        <div className="setting-control theme-toggle">
          <button className="btn-theme" onClick={this.onThemeToggle}>
            {this.getThemeIcon()}
          </button>
        </div>
        <div className="setting-control opacity-picker">
          <i className="fa fa-adjust opacity-icon" title="Opacity"/>
          <input type="range" onChange={ this.onOpacityChange } value={ this.state.opacity } min="20" max="100" className="slider" id="opacity-picker"/>
        </div>
        <div className="setting-control shortcut-picker">
          <i className="fa fa-keyboard-o shortcut-icon" title="Toggle Window Shortcut"/>
          <div className="shortcut-input-wrapper">
            <input
              type="text"
              className={`shortcut-input ${isRecording ? 'recording' : ''}`}
              value={displayShortcut}
              readOnly
              placeholder="Click to set shortcut"
              onClick={this.startRecording}
            />
            {isRecording && (
              <div className="shortcut-actions">
                <button className="btn-shortcut-action btn-save" onClick={this.stopRecording} title="Save">
                  <i className="fa fa-check"/>
                </button>
                <button className="btn-shortcut-action btn-cancel" onClick={this.cancelRecording} title="Cancel">
                  <i className="fa fa-times"/>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default Settings;
