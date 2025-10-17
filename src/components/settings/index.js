import React from 'react';
import debounce from 'lodash.debounce';

import './style.css';

const { ipcRenderer } = window.electron;

class Settings extends React.Component {
  state = {
    opacity: ipcRenderer.sendSync('opacity.get'),
    theme: ipcRenderer.sendSync('theme.get') || 'system'  // 'system', 'light', 'dark'
  };

  componentDidMount() {
    ipcRenderer.on('opacity.sync', this.onOpacitySync);
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('opacity.sync', this.onOpacitySync);
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

  render() {
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
      </div>
    );
  }
}

export default Settings;
