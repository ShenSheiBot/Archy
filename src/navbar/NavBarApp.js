import React, { Component } from 'react';
import { prepareUrl } from '../utils/helpers';
import './components/style.css';

const { ipcRenderer, platform } = window.electron;

/**
 * NavBarApp - Main component for independent NavBar WebContentsView
 *
 * This component runs in its own WebContentsView (38px height)
 * It communicates with the main process via IPC
 */
class NavBarApp extends Component {
  urlInput = React.createRef();
  tabBarRef = React.createRef();
  platform = (platform || '').toLowerCase();

  // Mouse-based drag info (not using HTML5 DnD)
  dragInfo = {
    dragging: false,
    sourceTabId: null
  };

  state = {
    tabs: [],
    activeTabId: null,
    url: '',
    showZoomIndicator: false,
    currentZoom: 100,
    navbarHidden: false,
    draggedTabId: null,
    dropIndicatorPosition: null
  };

  componentDidMount() {
    // Listen for tabs updates from main process
    ipcRenderer.on('tabs.update', this.handleTabsUpdate);

    // Listen for navigation focus request
    ipcRenderer.on('nav.focus', this.focusUrlInput);

    // Listen for search toggle
    ipcRenderer.on('search.toggle', this.toggleSearch);

    // Listen for zoom changes
    ipcRenderer.on('zoom.changed', this.handleZoomChanged);

    // Listen for navbar hide/show
    ipcRenderer.on('nav.hide', this.handleNavHide);
    ipcRenderer.on('nav.show', this.handleNavShow);

    // Global mouse event listeners for drag-and-drop
    window.addEventListener('mousemove', this.handleWindowMouseMove);
    window.addEventListener('mouseup', this.handleWindowMouseUp);

    // Request initial tabs data
    this.requestTabsUpdate();
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('tabs.update', this.handleTabsUpdate);
    ipcRenderer.removeListener('nav.focus', this.focusUrlInput);
    ipcRenderer.removeListener('search.toggle', this.toggleSearch);
    ipcRenderer.removeListener('zoom.changed', this.handleZoomChanged);
    ipcRenderer.removeListener('nav.hide', this.handleNavHide);
    ipcRenderer.removeListener('nav.show', this.handleNavShow);

    // Remove global mouse event listeners
    window.removeEventListener('mousemove', this.handleWindowMouseMove);
    window.removeEventListener('mouseup', this.handleWindowMouseUp);

    if (this.zoomTimeout) {
      clearTimeout(this.zoomTimeout);
    }
  }

  componentDidUpdate(prevProps, prevState) {
    // Update URL bar when active tab changes
    if (this.state.activeTabId !== prevState.activeTabId) {
      const activeTab = this.state.tabs.find(t => t.id === this.state.activeTabId);
      if (activeTab) {
        this.setState({ url: activeTab.url || '' });
      }
      // 自动滚动到活跃标签
      this.scrollToActiveTab();
    } else {
      // Update URL if active tab's URL changed
      const activeTab = this.state.tabs.find(t => t.id === this.state.activeTabId);
      const prevActiveTab = prevState.tabs.find(t => t.id === this.state.activeTabId);
      if (activeTab && prevActiveTab && activeTab.url !== prevActiveTab.url) {
        this.setState({ url: activeTab.url || '' });
      }
    }

    // 新建标签时也滚动到最新标签
    if (this.state.tabs.length > prevState.tabs.length) {
      this.scrollToActiveTab();
    }
  }

  // 滚动到活跃标签
  scrollToActiveTab = () => {
    if (!this.tabBarRef.current) return;
    const activeTab = this.tabBarRef.current.querySelector('.tab.active');
    if (activeTab) {
      activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  };

  // 鼠标滚轮水平滚动标签栏
  handleTabBarWheel = (e) => {
    if (!this.tabBarRef.current) return;
    e.preventDefault();
    this.tabBarRef.current.scrollLeft += e.deltaY;
  };

  // IPC Handlers
  handleTabsUpdate = (event, { tabs, activeTabId }) => {
    this.setState({ tabs, activeTabId });
  };

  requestTabsUpdate = () => {
    const tabsData = ipcRenderer.sendSync('tabs.get');
    if (tabsData) {
      this.setState({
        tabs: tabsData.tabs || [],
        activeTabId: tabsData.activeTabId
      });
    }
  };

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

  // Tab operations
  handleCreateTab = () => {
    ipcRenderer.send('tab.create', '');
  };

  handleCloseTab = (tabId) => {
    ipcRenderer.send('tab.close', tabId);
  };

  handleSwitchTab = (tabId) => {
    ipcRenderer.send('tab.switch', tabId);
  };

  handleTabContextMenu = (e, tabId) => {
    e.preventDefault();
    e.stopPropagation();
    ipcRenderer.send('tab.showContextMenu', tabId);
  };

  handleTabMouseDown = (e, tabId) => {
    // Middle click (button 1) to close tab
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      this.handleCloseTab(tabId);
      return;
    }

    // Left click: start mouse-based drag
    if (e.button === 0) {
      this.dragInfo.dragging = true;
      this.dragInfo.sourceTabId = tabId;

      this.setState({
        draggedTabId: tabId,
        dropIndicatorPosition: null
      });
    }
  };

  handleWindowMouseMove = (e) => {
    if (!this.dragInfo.dragging) return;
    if (!this.tabBarRef.current) return;

    const { tabs } = this.state;
    if (!tabs || tabs.length === 0) return;

    const mouseX = e.clientX;

    // Get all tab DOM elements (in order)
    const tabElements = Array.from(
      this.tabBarRef.current.querySelectorAll('.tab')
    );

    if (tabElements.length === 0) return;

    let targetTabId = null;
    let position = 'after';

    for (const el of tabElements) {
      const rect = el.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;

      const elTabId = Number(el.dataset.tabId);
      if (!elTabId) continue;

      if (mouseX < midpoint) {
        targetTabId = elTabId;
        position = 'before';
        break;
      }
    }

    // If mouse is to the right of all tabs, place indicator after the last tab
    if (!targetTabId) {
      const lastEl = tabElements[tabElements.length - 1];
      if (lastEl) {
        targetTabId = Number(lastEl.dataset.tabId);
        position = 'after';
      }
    }

    if (!targetTabId) {
      this.setState({ dropIndicatorPosition: null });
      return;
    }

    this.setState({
      dropIndicatorPosition: { tabId: targetTabId, position }
    });
  };

  handleWindowMouseUp = () => {
    if (!this.dragInfo.dragging) return;

    const { tabs, dropIndicatorPosition } = this.state;
    const draggedTabId = this.dragInfo.sourceTabId;

    this.dragInfo.dragging = false;
    this.dragInfo.sourceTabId = null;

    // Clear drag visual state
    this.setState({
      draggedTabId: null,
      dropIndicatorPosition: null
    });

    if (!draggedTabId || !dropIndicatorPosition) return;
    if (dropIndicatorPosition.tabId === draggedTabId &&
        dropIndicatorPosition.position === 'after') {
      // Dropped after itself, no change
      return;
    }

    const fromIndex = tabs.findIndex(t => t.id === draggedTabId);
    let toIndex = tabs.findIndex(t => t.id === dropIndicatorPosition.tabId);

    if (fromIndex === -1 || toIndex === -1) return;

    if (dropIndicatorPosition.position === 'after') {
      toIndex += 1;
    }

    // Prevent off-by-one when dropping after itself
    if (fromIndex < toIndex) {
      toIndex -= 1;
    }

    if (fromIndex !== toIndex) {
      ipcRenderer.send('tab.reorder', { fromIndex, toIndex });
    }
  };

  // Navigation operations
  handleReload = () => {
    if (!this.state.activeTabId) return;
    ipcRenderer.send('tab.reload', this.state.activeTabId);
  };

  handleBack = () => {
    if (!this.state.activeTabId) return;
    ipcRenderer.send('tab.back', this.state.activeTabId);
  };

  handleForward = () => {
    if (!this.state.activeTabId) return;
    ipcRenderer.send('tab.forward', this.state.activeTabId);
  };

  handleNavigate = (url) => {
    if (!url || !url.trim() || !this.state.activeTabId) return;

    const preparedUrl = prepareUrl(url, false);
    ipcRenderer.send('tab.navigate', { tabId: this.state.activeTabId, url: preparedUrl });
  };

  // URL input handlers
  onUrlChange = (e) => {
    this.setState({ url: e.target.value });
  };

  onUrlKeyDown = (e) => {
    if (e.key === 'Enter' && this.state.activeTabId) {
      const rawUrl = e.target.value.trim();
      if (rawUrl) {
        this.handleNavigate(rawUrl);
        e.target.blur();
      }
    }
  };

  onUrlFocus = (e) => {
    e.target.select();
  };

  onUrlBlur = (e) => {
    // Blur handling
  };

  focusUrlInput = () => {
    if (this.urlInput && this.urlInput.current) {
      this.urlInput.current.focus();
    }
  };

  // Settings - relay to overlay layer
  toggleSettings = () => {
    ipcRenderer.send('settings.toggle');
  };

  // Search - relay to overlay layer
  toggleSearch = () => {
    ipcRenderer.send('search.toggle');
  };

  // Hide/show navbar handlers
  handleNavHide = () => {
    this.setState({ navbarHidden: true });
  };

  handleNavShow = () => {
    this.setState({ navbarHidden: false });
  };

  // Render methods
  renderTabs() {
    const { tabs, activeTabId, draggedTabId, dropIndicatorPosition } = this.state;

    return (
      <div className="tab-bar" ref={this.tabBarRef} onWheel={this.handleTabBarWheel}>
        {tabs.map(tab => {
          const isActive = tab.id === activeTabId;
          const isDragging = tab.id === draggedTabId;
          const showDropBefore = dropIndicatorPosition?.tabId === tab.id && dropIndicatorPosition?.position === 'before';
          const showDropAfter = dropIndicatorPosition?.tabId === tab.id && dropIndicatorPosition?.position === 'after';

          return (
            <React.Fragment key={tab.id}>
              {showDropBefore && <div className="drop-indicator" />}
              <div
                className={`tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
                data-tab-id={tab.id}
                onClick={() => this.handleSwitchTab(tab.id)}
                onMouseDown={(e) => this.handleTabMouseDown(e, tab.id)}
                onContextMenu={(e) => this.handleTabContextMenu(e, tab.id)}
              >
                {tab.favicon ? (
                  <img src={tab.favicon} className="tab-favicon" alt="" draggable="false" />
                ) : (
                  <i className="fa fa-globe tab-icon" draggable="false"/>
                )}
              </div>
              {showDropAfter && <div className="drop-indicator" />}
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  renderSettingsButton() {
    const supportsOpacity = this.platform === 'darwin' || /^win/.test(this.platform);
    if (!supportsOpacity) {
      return null;
    }

    return (
      <button className="btn-action btn btn-dark" onClick={this.toggleSettings}>
        <i className="fa fa-cog"/>
      </button>
    );
  }

  // Settings and Search are now rendered in overlay layer (main window)
  // NavBar只负责触发显示/隐藏，实际UI在overlay层

  render() {
    const { activeTabId, navbarHidden } = this.state;
    const navClasses = `top-nav ${this.platform === 'darwin' ? 'top-nav-mac' : ''}`;

    // When navbar is hidden, render nothing (overlay dragbar handles dragging)
    if (navbarHidden) {
      return null;
    }

    // Normal navbar UI
    return (
      <div className="navbar-container">
        <div className={navClasses}>
          {this.renderTabs()}
          <div className="nav-controls">
            <button
              className="btn-action btn btn-dark d-none d-sm-block d-md-block d-lg-block d-xl-block"
              onClick={this.handleBack}
              disabled={!activeTabId}
            >
              <i className="fa fa-arrow-left"/>
            </button>
            <button
              className="btn-action btn btn-dark d-none d-sm-block d-md-block d-lg-block d-xl-block"
              onClick={this.handleForward}
              disabled={!activeTabId}
            >
              <i className="fa fa-arrow-right"/>
            </button>
            <button
              className="btn-action btn btn-dark"
              onClick={this.handleReload}
              disabled={!activeTabId}
            >
              <i className="fa fa-refresh"/>
            </button>
            <input
              ref={this.urlInput}
              className='search-input'
              type="text"
              placeholder='Enter the URL to load'
              value={this.state.url}
              onChange={this.onUrlChange}
              onKeyDown={this.onUrlKeyDown}
              onFocus={this.onUrlFocus}
              onBlur={this.onUrlBlur}
            />
            {this.renderSettingsButton()}
          </div>
        </div>
        {this.state.showZoomIndicator && (
          <div className="zoom-indicator">
            {this.state.currentZoom}%
          </div>
        )}
      </div>
    );
  }
}

export default NavBarApp;
