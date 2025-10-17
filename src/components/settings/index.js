import React from 'react';
import debounce from 'lodash.debounce';

import './style.css';

const { ipcRenderer } = window.electron;

class Settings extends React.Component {
  state = {
    opacity: ipcRenderer.sendSync('opacity.get')
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

  render() {
    return (
      <div className='settings-wrap'>
        <div className="setting-control opacity-picker">
          <input type="range" onChange={ this.onOpacityChange } value={ this.state.opacity } min="20" max="100" className="slider" id="opacity-picker"/>
        </div>
      </div>
    );
  }
}

export default Settings;
