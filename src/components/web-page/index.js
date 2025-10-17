import React from 'react';
import PropTypes from 'prop-types';

import './style.css';
import NavBar from '../nav-bar';

const { ipcRenderer } = window.electron;

class WebPage extends React.Component {
  webviewRefs = {};
  readyMap = new Map();
  pendingUrl = new Map();
  zoomLevelsByDomain = new Map(); // Track zoom level for each domain
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

  bindNavBar() {
    ipcRenderer.on('nav.toggle', this.toggleNavBar);
    ipcRenderer.on('nav.show', this.showNavBarInternal);
    ipcRenderer.on('nav.hide', this.hideNavBarInternal);
  }

  unbindNavBar() {
    ipcRenderer.removeListener('nav.toggle', this.toggleNavBar);
    ipcRenderer.removeListener('nav.show', this.showNavBarInternal);
    ipcRenderer.removeListener('nav.hide', this.hideNavBarInternal);
  }

  bindZoomHandlers() {
    ipcRenderer.on('zoom.in', this.handleZoomIn);
    ipcRenderer.on('zoom.out', this.handleZoomOut);
    ipcRenderer.on('zoom.reset', this.handleZoomReset);
  }

  unbindZoomHandlers() {
    ipcRenderer.removeListener('zoom.in', this.handleZoomIn);
    ipcRenderer.removeListener('zoom.out', this.handleZoomOut);
    ipcRenderer.removeListener('zoom.reset', this.handleZoomReset);
  }

  setupWebviewListeners = (webview, tabId) => {
    if (!webview || webview._listenersSetup) return;
    webview._listenersSetup = true;

    webview.classList.add('webview-loading');

    let resolveReady;
    const readyP = new Promise(res => (resolveReady = res));
    this.readyMap.set(tabId, readyP);

    let updateTimeout = null;
    let pendingUpdates = {};
    const debouncedUpdate = (updates) => {
      Object.assign(pendingUpdates, updates);

      if (updateTimeout) clearTimeout(updateTimeout);
      updateTimeout = setTimeout(() => {
        this.updateTabInfo(tabId, pendingUpdates);
        pendingUpdates = {};
      }, 100);
    };

    let tStart = 0;

    const onDomReady = async () => {
      webview._ready = true;
      resolveReady?.();

      const url = this.pendingUrl.get(tabId);
      if (url) {
        this.pendingUrl.delete(tabId);
        try {
          await webview.loadURL(url);
        } catch (err) {
          // Silently ignore load errors (e.g., navigation cancelled)
        }
      }

    };

    const onFinishLoad = () => {
      webview.classList.remove('webview-loading');
    };

    const onStartLoading = () => {
      tStart = performance.now();
      this.updateTabInfo(tabId, { loading: true });

      if (isFirstLoad) {
        webview.classList.add('webview-loading');
      }
    };

    const onNavigate = (e) => {
      if (isFirstLoad) {
        isFirstLoad = false;
      }

      if (e.url && e.url !== 'about:blank') {
        debouncedUpdate({ url: e.url });

        // Apply saved zoom level for this domain
        const domain = this.getDomainFromUrl(e.url);
        if (domain) {
          const savedZoom = this.zoomLevelsByDomain.get(domain);
          if (savedZoom && webview) {
            webview.setZoomFactor(savedZoom);
          }
        }
      }
    };

    const onTitleUpdated = (e) => {
      debouncedUpdate({ title: e.title });
    };

    const onFaviconUpdated = (e) => {
      if (e.favicons && e.favicons.length > 0) {
        debouncedUpdate({ favicon: e.favicons[0] });
      }
    };

    const onStopLoading = () => {
      this.updateTabInfo(tabId, { loading: false });
    };

    const onFailLoad = (event) => {
      if (event.isMainFrame === false) return;

      this.updateTabInfo(tabId, { loading: false });
      webview.classList.remove('webview-loading');
    };

    const onEnterFullscreen = () => {
      webview.classList.add('webview-fullscreen');
      this.setState({ showNav: false });
      // Hide macOS traffic lights in fullscreen
      ipcRenderer.send('fullscreen.enter');
    };

    const onLeaveFullscreen = () => {
      webview.classList.remove('webview-fullscreen');
      this.setState({ showNav: true });
      // Show macOS traffic lights when leaving fullscreen
      ipcRenderer.send('fullscreen.leave');
    };

    webview.addEventListener('dom-ready', onDomReady, { once: true });
    webview.addEventListener('did-finish-load', onFinishLoad);

    let isFirstLoad = true;

    webview.addEventListener('did-start-loading', onStartLoading);
    webview.addEventListener('did-navigate', onNavigate);
    webview.addEventListener('page-title-updated', onTitleUpdated);
    webview.addEventListener('page-favicon-updated', onFaviconUpdated);
    webview.addEventListener('did-stop-loading', onStopLoading);
    webview.addEventListener('did-fail-load', onFailLoad);
    webview.addEventListener('enter-html-full-screen', onEnterFullscreen);
    webview.addEventListener('leave-html-full-screen', onLeaveFullscreen);

    // Store references for cleanup
    webview._eventListeners = {
      'did-finish-load': onFinishLoad,
      'did-start-loading': onStartLoading,
      'did-navigate': onNavigate,
      'page-title-updated': onTitleUpdated,
      'page-favicon-updated': onFaviconUpdated,
      'did-stop-loading': onStopLoading,
      'did-fail-load': onFailLoad,
      'enter-html-full-screen': onEnterFullscreen,
      'leave-html-full-screen': onLeaveFullscreen
    };
  };

  updateTabInfo = (tabId, updates) => {
    const safe = Object.fromEntries(
      Object.entries(updates).filter(([k, v]) => v !== '' && v != null)
    );
    if (Object.keys(safe).length) {
      ipcRenderer.send('tab.update', { tabId, updates: safe });
    }
  };

  componentDidMount() {
    this.bindNavBar();
    this.bindZoomHandlers();

    const { tabs = [] } = this.props;
    tabs.forEach(tab => {
      const wv = this.webviewRefs[tab.id];
      if (wv && !wv._listenersSetup) {
        this.setupWebviewListeners(wv, tab.id);
      }
    });
  }

  cleanupWebviewListeners = (webview) => {
    if (!webview || !webview._eventListeners) return;

    Object.entries(webview._eventListeners).forEach(([eventName, handler]) => {
      webview.removeEventListener(eventName, handler);
    });

    delete webview._eventListeners;
    delete webview._listenersSetup;
  };

  componentDidUpdate(prevProps) {
    const { tabs = [] } = this.props;
    const { tabs: prevTabs = [] } = prevProps;

    // Clean up listeners for removed tabs
    prevTabs.forEach(prevTab => {
      const stillExists = tabs.find(t => t.id === prevTab.id);
      if (!stillExists) {
        const wv = this.webviewRefs[prevTab.id];
        if (wv) {
          this.cleanupWebviewListeners(wv);
          delete this.webviewRefs[prevTab.id];
        }
        this.readyMap.delete(prevTab.id);
        this.pendingUrl.delete(prevTab.id);
      }
    });

    // Setup listeners for new tabs
    tabs.forEach(tab => {
      const wv = this.webviewRefs[tab.id];
      const wasNew = !prevTabs.find(t => t.id === tab.id);

      if (wv && (wasNew || !wv._listenersSetup)) {
        this.setupWebviewListeners(wv, tab.id);

        if (wasNew && tab.url && tab.url.trim()) {
          this.pendingUrl.set(tab.id, tab.url);
        }
      }
    });
  }

  componentWillUnmount() {
    this.unbindNavBar();
    this.unbindZoomHandlers();

    // Clean up all webview listeners
    Object.values(this.webviewRefs).forEach(wv => {
      this.cleanupWebviewListeners(wv);
    });

    // Clear zoom timeout
    if (this.zoomTimeout) {
      clearTimeout(this.zoomTimeout);
    }
  }

  getActiveWebview = () => {
    const { activeTabId } = this.props;
    return this.webviewRefs[activeTabId];
  };

  handleReload = (tabId) => {
    const webview = this.webviewRefs[tabId];
    if (webview) {
      webview.reloadIgnoringCache();
    }
  };

  handleBack = (tabId) => {
    const webview = this.webviewRefs[tabId];
    if (webview && webview.canGoBack()) {
      webview.goBack();
    }
  };

  handleForward = (tabId) => {
    const webview = this.webviewRefs[tabId];
    if (webview && webview.canGoForward()) {
      webview.goForward();
    }
  };

  handleNavigate = (tabId, url) => {
    const webview = this.webviewRefs[tabId];
    if (!webview || !url || !url.trim()) return;

    if (webview._ready) {
      webview.loadURL(url).catch(() => {
        // Silently ignore load errors (e.g., navigation cancelled)
      });
    } else {
      this.pendingUrl.set(tabId, url);
      if (!this.readyMap.has(tabId)) {
        this.setupWebviewListeners(webview, tabId);
      }
    }
  };

  getDomainFromUrl = (url) => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return null;
    }
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

  handleZoomIn = () => {
    const webview = this.getActiveWebview();
    if (!webview) return;

    const url = webview.getURL();
    const domain = this.getDomainFromUrl(url);
    if (!domain) return;

    const currentZoom = this.zoomLevelsByDomain.get(domain) || 1.0;
    const newZoom = Math.min(currentZoom + 0.1, 3.0); // Max 300%

    webview.setZoomFactor(newZoom);
    this.zoomLevelsByDomain.set(domain, newZoom);
    this.showZoomIndicator(Math.round(newZoom * 100));
  };

  handleZoomOut = () => {
    const webview = this.getActiveWebview();
    if (!webview) return;

    const url = webview.getURL();
    const domain = this.getDomainFromUrl(url);
    if (!domain) return;

    const currentZoom = this.zoomLevelsByDomain.get(domain) || 1.0;
    const newZoom = Math.max(currentZoom - 0.1, 0.5); // Min 50%

    webview.setZoomFactor(newZoom);
    this.zoomLevelsByDomain.set(domain, newZoom);
    this.showZoomIndicator(Math.round(newZoom * 100));
  };

  handleZoomReset = () => {
    const webview = this.getActiveWebview();
    if (!webview) return;

    const url = webview.getURL();
    const domain = this.getDomainFromUrl(url);
    if (!domain) return;

    webview.setZoomFactor(1.0);
    this.zoomLevelsByDomain.set(domain, 1.0);
    this.showZoomIndicator(100);
  };

  render() {
    const {
      tabs = [],
      activeTabId,
      onCreateTab,
      onCloseTab,
      onSwitchTab,
      onNavigateTab,
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
            getActiveWebview={ this.getActiveWebview }
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
        <div className="webview-container">
          {tabs.map(tab => {
            return (
              <webview
                key={tab.id}
                data-tabid={tab.id}
                ref={ref => { if (ref) this.webviewRefs[tab.id] = ref; }}
                src="about:blank"
                className={`tab-webview ${tab.id === activeTabId ? 'active' : ''}`}
                partition="persist:direct"
                allowpopups="true"
                useragent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
              />
            );
          })}
        </div>
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
  onReloadTab: PropTypes.func.isRequired,
  onBackTab: PropTypes.func.isRequired,
  onForwardTab: PropTypes.func.isRequired,
  showNav: PropTypes.bool
};

WebPage.defaultProps = {
  tabs: []
};

export default WebPage;
