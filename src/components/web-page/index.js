import React from 'react';
import PropTypes from 'prop-types';

import './style.css';
import NavBar from '../nav-bar';

const { ipcRenderer } = window.electron;

class WebPage extends React.Component {
  navStateBeforeFullscreen = null; // Remember navbar state before entering fullscreen
  navStateBeforeDetached = null; // Remember navbar state before entering detached mode
  zoomTimeout = null;

  state = {
    showNav: this.props.showNav,
    showZoomIndicator: false,
    currentZoom: 100
  };

  toggleNavBar = () => {
    this.setState(state => ({
      showNav: !state.showNav
    }));
  };

  // Internal method - only updates state (called from IPC events)
  showNavBarInternal = () => {
    this.setState({
      showNav: true
    });
  };

  hideNavBarInternal = () => {
    this.setState({
      showNav: false
    });
  };

  // Public method - only sends IPC (called from restore button)
  // The IPC relay will trigger showNavBarInternal to update state
  showNavBar = () => {
    ipcRenderer.send('nav.show');
  };

  enterDetachedMode = () => {
    // Remember navbar state before entering detached mode
    this.navStateBeforeDetached = this.state.showNav;

    // Hide navbar when entering detached mode
    this.setState({ showNav: false });
  };

  restoreDetachedMode = () => {
    // Restore detached mode without re-saving navbar state
    // Just apply the detached mode UI
  };

  exitDetachedMode = () => {
    // Restore navbar state from before detached mode
    if (this.navStateBeforeDetached !== null && this.navStateBeforeDetached) {
      this.setState({ showNav: true });
      this.navStateBeforeDetached = null;
      // Show traffic lights when restoring navbar
      ipcRenderer.send('traffic-lights.show');
    } else {
      this.navStateBeforeDetached = null;
      // Don't show traffic lights if navbar should stay hidden (fullscreen)
    }
  };

  bindNavBar() {
    ipcRenderer.on('nav.toggle', this.toggleNavBar);
    ipcRenderer.on('nav.show', this.showNavBarInternal);
    ipcRenderer.on('nav.hide', this.hideNavBarInternal);
    ipcRenderer.on('detached.enter', this.enterDetachedMode);
    ipcRenderer.on('detached.restore', this.restoreDetachedMode);
    ipcRenderer.on('detached.exit', this.exitDetachedMode);
  }

  unbindNavBar() {
    ipcRenderer.removeListener('nav.toggle', this.toggleNavBar);
    ipcRenderer.removeListener('nav.show', this.showNavBarInternal);
    ipcRenderer.removeListener('nav.hide', this.hideNavBarInternal);
    ipcRenderer.removeListener('detached.enter', this.enterDetachedMode);
    ipcRenderer.removeListener('detached.restore', this.restoreDetachedMode);
    ipcRenderer.removeListener('detached.exit', this.exitDetachedMode);
  }

  bindZoomHandlers() {
    ipcRenderer.on('zoom.changed', this.handleZoomChanged);
  }

  unbindZoomHandlers() {
    ipcRenderer.removeListener('zoom.changed', this.handleZoomChanged);
  }

  bindFullscreenHandlers() {
    ipcRenderer.on('fullscreen.enter', this.onFullscreenEnter);
    ipcRenderer.on('fullscreen.leave', this.onFullscreenLeave);
  }

  unbindFullscreenHandlers() {
    ipcRenderer.removeListener('fullscreen.enter', this.onFullscreenEnter);
    ipcRenderer.removeListener('fullscreen.leave', this.onFullscreenLeave);
  }

  onFullscreenEnter = () => {
    // Remember navbar state before entering fullscreen
    this.navStateBeforeFullscreen = this.state.showNav;
    this.setState({ showNav: false });
  };

  onFullscreenLeave = () => {
    // Restore navbar state from before fullscreen
    const shouldShowNav = this.navStateBeforeFullscreen !== null
      ? this.navStateBeforeFullscreen
      : true;
    this.setState({ showNav: shouldShowNav });
    this.navStateBeforeFullscreen = null;
  };

  componentDidMount() {
    this.bindNavBar();
    this.bindZoomHandlers();
    this.bindFullscreenHandlers();
  }

  componentWillUnmount() {
    this.unbindNavBar();
    this.unbindZoomHandlers();
    this.unbindFullscreenHandlers();

    // Clear zoom timeout
    if (this.zoomTimeout) {
      clearTimeout(this.zoomTimeout);
    }
  }

  /**
   * Handle reload - sends IPC to main process
   */
  handleReload = (tabId) => {
    ipcRenderer.send('tab.reload', tabId);
  };

  /**
   * Handle back navigation - sends IPC to main process
   */
  handleBack = (tabId) => {
    ipcRenderer.send('tab.back', tabId);
  };

  /**
   * Handle forward navigation - sends IPC to main process
   */
  handleForward = (tabId) => {
    ipcRenderer.send('tab.forward', tabId);
  };

  /**
   * Handle navigate to URL - sends IPC to main process
   */
  handleNavigate = (tabId, url) => {
    if (!url || !url.trim()) return;
    ipcRenderer.send('tab.navigate', { tabId, url });
  };

  /**
   * Handle zoom changed event from main process
   */
  handleZoomChanged = (event, { percentage }) => {
    this.showZoomIndicator(percentage);
  };

  showZoomIndicator = (zoomLevel) => {
    if (this.zoomTimeout) {
      clearTimeout(this.zoomTimeout);
    }

    this.setState({
      showZoomIndicator: true,
      currentZoom: zoomLevel
    });

    this.zoomTimeout = setTimeout(() => {
      this.setState({ showZoomIndicator: false });
    }, 1500);
  };

  render() {
    const {
      tabs = [],
      activeTabId,
      onCreateTab,
      onCloseTab,
      onSwitchTab,
      className = ''
    } = this.props;

    return (
      <div className={ 'webpage ' + (this.state.showNav && 'with-nav') }>
        <div className={`navbar-wrapper ${this.state.showNav ? 'navbar-visible' : 'navbar-hidden'}`}>
          <NavBar
            tabs={ tabs }
            activeTabId={ activeTabId }
            onCreateTab={ onCreateTab }
            onCloseTab={ onCloseTab }
            onSwitchTab={ onSwitchTab }
            onNavigate={ this.handleNavigate }
            onReload={ this.handleReload }
            onBack={ this.handleBack }
            onForward={ this.handleForward }
          />
        </div>
        {!this.state.showNav && (
          <>
            <div className="drag-area" />
            <button
              className="restore-navbar-btn"
              onClick={this.showNavBar}
              title="Show Navbar"
            >
              <i className="fa fa-eye"/>
            </button>
          </>
        )}
        {this.state.showZoomIndicator && (
          <div className="zoom-indicator">
            {this.state.currentZoom}%
          </div>
        )}
        {/*
          WebContentsView 由主进程管理，不需要在渲染进程创建标签
          WebContents 的 bounds 由 viewManager.calculateBounds() 控制
        */}
      </div>
    );
  }
}

WebPage.propTypes = {
  tabs: PropTypes.array,
  activeTabId: PropTypes.number,
  onCreateTab: PropTypes.func.isRequired,
  onCloseTab: PropTypes.func.isRequired,
  onSwitchTab: PropTypes.func.isRequired,
  onNavigateTab: PropTypes.func.isRequired,
  showNav: PropTypes.bool
};

WebPage.defaultProps = {
  tabs: []
};

export default WebPage;
