import React from 'react';
import PropTypes from 'prop-types';

import './style.css';
import NavBar from '../nav-bar';

const { ipcRenderer } = window.electron;

class WebPage extends React.Component {
  webviewRefs = {};
  readyMap = new Map();
  pendingUrl = new Map();

  state = {
    showNav: this.props.showNav
  };

  toggleNavBar = () => {
    this.setState(state => ({
      showNav: !state.showNav
    }));
  };

  showNavBar = () => {
    this.setState({
      showNav: true
    });
  };

  bindNavBar() {
    ipcRenderer.on('nav.toggle', this.toggleNavBar);
    ipcRenderer.on('nav.show', this.showNavBar);
  }

  unbindNavBar() {
    ipcRenderer.removeListener('nav.toggle', this.toggleNavBar);
    ipcRenderer.removeListener('nav.show', this.showNavBar);
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
        webview.loadURL(url);
      }

    };

    const onFinishLoad = () => {
      webview.classList.remove('webview-loading');
    };

    webview.addEventListener('dom-ready', onDomReady, { once: true });
    webview.addEventListener('did-finish-load', onFinishLoad);

    let isFirstLoad = true;

    webview.addEventListener('did-start-loading', () => {
      tStart = performance.now();
      this.updateTabInfo(tabId, { loading: true });

      if (isFirstLoad) {
        webview.classList.add('webview-loading');
      }
    });

    webview.addEventListener('did-navigate', (e) => {
      if (isFirstLoad) {
        isFirstLoad = false;
      }

      if (e.url && e.url !== 'about:blank') {
        debouncedUpdate({ url: e.url });
      }
    });

    webview.addEventListener('page-title-updated', (e) => {
      debouncedUpdate({ title: e.title });
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      if (e.favicons && e.favicons.length > 0) {
        debouncedUpdate({ favicon: e.favicons[0] });
      }
    });

    webview.addEventListener('did-stop-loading', () => {
      this.updateTabInfo(tabId, { loading: false });
    });

    webview.addEventListener('did-fail-load', (event) => {
      if (event.isMainFrame === false) return;

      this.updateTabInfo(tabId, { loading: false });
      webview.classList.remove('webview-loading');
    });

    // Handle fullscreen requests: make video fill the webview instead of going native fullscreen
    webview.addEventListener('enter-html-full-screen', () => {
      // Add CSS class to make webview fill entire window
      webview.classList.add('webview-fullscreen');
      // Hide navbar when in fullscreen
      this.setState({ showNav: false });
    });

    webview.addEventListener('leave-html-full-screen', () => {
      // Remove fullscreen class
      webview.classList.remove('webview-fullscreen');
      // Restore navbar
      this.setState({ showNav: true });
    });

    webview._listenersSetup = true;
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

    const { tabs = [] } = this.props;
    tabs.forEach(tab => {
      const wv = this.webviewRefs[tab.id];
      if (wv) this.setupWebviewListeners(wv, tab.id);
    });
  }

  componentDidUpdate(prevProps) {
    const { tabs = [] } = this.props;
    const { tabs: prevTabs = [] } = prevProps;

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
      webview.loadURL(url);
    } else {
      this.pendingUrl.set(tabId, url);
      if (!this.readyMap.has(tabId)) {
        this.setupWebviewListeners(webview, tabId);
      }
    }
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
