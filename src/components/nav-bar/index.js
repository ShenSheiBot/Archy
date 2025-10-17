import React, { Component } from 'react';
import PropTypes from 'prop-types';

import './style.css';
import Settings from '../settings';
import { prepareUrl } from '../../utils/helpers';

const { ipcRenderer, platform } = window.electron;

class NavBar extends Component {
  urlInput = React.createRef();
  searchInput = React.createRef();
  platform = (platform || '').toLowerCase();
  state = {
    url: '',
    settingsShown: false,
    searchShown: false,
    searchText: '',
    searchMatches: { current: 0, total: 0 }
  };

  toggleSettings = () => {
    this.setState((state) => {
      const newSettingsShown = !state.settingsShown;
      // Notify Electron to adjust BrowserView bounds
      ipcRenderer.send('settings.toggle', newSettingsShown);
      return {
        settingsShown: newSettingsShown
      };
    });
  };

  toggleSearch = () => {
    this.setState((state) => {
      const newSearchShown = !state.searchShown;
      if (!newSearchShown) {
        const webview = this.props.getActiveWebview && this.props.getActiveWebview();
        if (webview) {
          webview.stopFindInPage('clearSelection');
        }
      }
      return {
        searchShown: newSearchShown,
        searchText: newSearchShown ? state.searchText : '',
        searchMatches: newSearchShown ? state.searchMatches : { current: 0, total: 0 }
      };
    }, () => {
      if (this.state.searchShown && this.searchInput.current) {
        this.searchInput.current.focus();
      }
    });
  };

  handleSearchChange = (e) => {
    const searchText = e.target.value;
    this.setState({ searchText });

    const webview = this.props.getActiveWebview && this.props.getActiveWebview();
    if (!webview) return;

    if (searchText) {
      webview.findInPage(searchText);
    } else {
      webview.stopFindInPage('clearSelection');
      this.setState({ searchMatches: { current: 0, total: 0 } });
    }
  };

  handleSearchKeyDown = (e) => {
    if (e.key === 'Enter') {
      if (e.shiftKey) {
        this.handleSearchPrevious();
      } else {
        this.handleSearchNext();
      }
    } else if (e.key === 'Escape') {
      this.toggleSearch();
    }
  };

  handleSearchNext = () => {
    const webview = this.props.getActiveWebview && this.props.getActiveWebview();
    if (webview && this.state.searchText) {
      webview.findInPage(this.state.searchText, { forward: true, findNext: true });
    }
  };

  handleSearchPrevious = () => {
    const webview = this.props.getActiveWebview && this.props.getActiveWebview();
    if (webview && this.state.searchText) {
      webview.findInPage(this.state.searchText, { forward: false, findNext: true });
    }
  };

  setupWebviewSearchListeners = () => {
    const webview = this.props.getActiveWebview && this.props.getActiveWebview();
    if (!webview || this.searchListenerAttached) return;

    webview.addEventListener('found-in-page', (result) => {
      this.state.searchMatches.current = result.activeMatchOrdinal;
      this.state.searchMatches.total = result.finalUpdate ? result.matches : '?';

      const matchInfoSpan = document.querySelector('.search-match-info');
      if (matchInfoSpan) {
        const total = this.state.searchMatches.total;
        const current = this.state.searchMatches.current;
        matchInfoSpan.textContent = total > 0 ? `${current}/${total}` : '';
      }
    });

    this.searchListenerAttached = true;
  };

  onChange = (e) => {
    this.setState({
      url: e.target.value
    });
  };

  onKeyPress = (e) => {
    if (e.key === 'Enter' && this.props.activeTabId) {
      const rawUrl = e.target.value.trim();
      if (!rawUrl) return;

      const preparedUrl = prepareUrl(rawUrl, false);
      if (preparedUrl && this.props.onNavigate) {
        this.props.onNavigate(this.props.activeTabId, preparedUrl);
      }
      e.target.blur();
    }
  };

  onFocus = (e) => {
    e.target.select();
  };

  focusUrlInput = () => {
    if (this.urlInput && this.urlInput.current) {
      this.urlInput.current.focus();
    }
  };

  componentDidMount() {
    ipcRenderer.on('nav.focus', this.focusUrlInput);
    ipcRenderer.on('search.toggle', this.toggleSearch);
    this.setupWebviewSearchListeners();
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('nav.focus', this.focusUrlInput);
    ipcRenderer.removeListener('search.toggle', this.toggleSearch);
  }

  componentDidUpdate(prevProps) {
    const { tabs = [], activeTabId } = this.props;
    const { tabs: prevTabs = [], activeTabId: prevActiveTabId } = prevProps;

    if (activeTabId !== prevActiveTabId) {
      this.searchListenerAttached = false;
      this.setupWebviewSearchListeners();
    }

    if (activeTabId !== prevActiveTabId) {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        this.setState({
          url: activeTab.url || ''
        });
      }
    } else {
      const activeTab = tabs.find(t => t.id === activeTabId);
      const prevActiveTab = prevTabs.find(t => t.id === activeTabId);

      if (activeTab && prevActiveTab && activeTab.url !== prevActiveTab.url) {
        this.setState({
          url: activeTab.url || ''
        });
      }
    }
  }

  renderSettingsButton() {
    const supportsOpacity = this.platform === 'darwin' || /^win/.test(this.platform);
    if (!supportsOpacity) {
      return null;
    }

    return (
      <button className="btn-action btn btn-dark" onClick={ this.toggleSettings }>
        <i className="fa fa-cog"/>
      </button>
    );
  }

  handleHideNavbar = () => {
    // Close settings panel first
    this.setState({ settingsShown: false });
    // Then hide navbar
    ipcRenderer.send('nav.hide');
  };

  renderSettingsPanel() {
    if (!this.state.settingsShown) {
      return null;
    }

    return (
      <div className="settings-panel-floating">
        <Settings onHideNavbar={this.handleHideNavbar}/>
        <button className="btn-settings-close" onClick={this.toggleSettings}>
          <i className="fa fa-times"/>
        </button>
      </div>
    );
  }

  renderTabs() {
    const { tabs = [], activeTabId, onSwitchTab } = this.props;

    return (
      <div className="tab-bar">
        {tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab ${tab.id === activeTabId ? 'active' : ''}`}
            onClick={() => onSwitchTab(tab.id)}
          >
            {tab.favicon ? (
              <img src={tab.favicon} className="tab-favicon" alt="" />
            ) : (
              <i className="fa fa-globe tab-icon"/>
            )}
          </div>
        ))}
      </div>
    );
  }

  renderSearchBar() {
    if (!this.state.searchShown) {
      return null;
    }

    const { searchText, searchMatches } = this.state;
    const matchInfo = searchMatches.total > 0 ? `${searchMatches.current}/${searchMatches.total}` : '';

    return (
      <div className="search-bar-floating">
        <input
          ref={this.searchInput}
          type="text"
          className="search-input-floating"
          placeholder="Find in page..."
          value={searchText}
          onChange={this.handleSearchChange}
          onKeyDown={this.handleSearchKeyDown}
        />
        {matchInfo && <span className="search-match-info">{matchInfo}</span>}
        <button className="btn-search" onClick={this.handleSearchPrevious} disabled={!searchText}>
          <i className="fa fa-chevron-up"/>
        </button>
        <button className="btn-search" onClick={this.handleSearchNext} disabled={!searchText}>
          <i className="fa fa-chevron-down"/>
        </button>
        <button className="btn-search" onClick={this.toggleSearch}>
          <i className="fa fa-times"/>
        </button>
      </div>
    );
  }

  render() {
    const { tabs = [], activeTabId, onBack, onForward, onReload } = this.props;
    const navClasses = `top-nav ${this.platform === 'darwin' ? 'top-nav-mac' : ''}`;

    return (
      <>
        <div className={navClasses}>
          {this.renderTabs()}
          <div className="nav-controls">
            <button className="btn-action btn btn-dark d-none d-sm-block d-md-block d-lg-block d-xl-block" onClick={() => onBack(activeTabId)}><i className="fa fa-arrow-left"/></button>
            <button className="btn-action btn btn-dark d-none d-sm-block d-md-block d-lg-block d-xl-block" onClick={() => onForward(activeTabId)}><i className="fa fa-arrow-right"/></button>
            <button className="btn-action btn btn-dark" onClick={() => onReload(activeTabId)}><i className="fa fa-refresh"/></button>
            <input
              ref={ this.urlInput }
              className='search-input'
              type="text"
              placeholder='Enter the URL to load'
              value={ this.state.url }
              onChange={ this.onChange }
              onKeyPress={ this.onKeyPress }
              onFocus={ this.onFocus }
            />
            { this.renderSettingsButton() }
          </div>
        </div>
        { this.renderSearchBar() }
        { this.renderSettingsPanel() }
      </>
    );
  }
}

NavBar.propTypes = {
  tabs: PropTypes.array,
  activeTabId: PropTypes.number,
  onCreateTab: PropTypes.func.isRequired,
  onCloseTab: PropTypes.func.isRequired,
  onSwitchTab: PropTypes.func.isRequired,
  onNavigate: PropTypes.func.isRequired,
  onReload: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
  onForward: PropTypes.func.isRequired,
  getActiveWebview: PropTypes.func
};

NavBar.defaultProps = {
  tabs: []
};

export default NavBar;
