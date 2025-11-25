import React, { Component } from 'react';
import Settings from '../components/settings';

const { ipcRenderer } = window.electron;

/**
 * OverlayApp - Full-screen overlay layer for Settings and Search
 *
 * This component runs in the main window and floats above all WebContentsViews
 * It provides full-screen overlays that were previously cramped in the navbar
 */
class OverlayApp extends Component {
  state = {
    settingsShown: false,
    searchShown: false,
    searchText: '',
    searchMatches: { current: 0, total: 0 },
    navbarHidden: false,  // Track navbar visibility for drag bar
    fullscreenDragbar: false  // Track fullscreen mode for drag bar
  };

  searchInput = React.createRef();
  lastSearchTime = 0;

  componentDidMount() {
    // Listen for overlay toggle requests from navbar or shortcuts
    ipcRenderer.on('settings.toggle', this.handleSettingsToggle);
    ipcRenderer.on('search.toggle', this.handleSearchToggle);

    // Listen for search results from main process
    ipcRenderer.on('search.result', this.handleSearchResult);

    // Listen for navbar visibility changes
    ipcRenderer.on('navbar.hidden', () => this.setState({ navbarHidden: true }));
    ipcRenderer.on('navbar.shown', () => this.setState({ navbarHidden: false }));

    // Listen for fullscreen dragbar visibility changes
    ipcRenderer.on('fullscreen.dragbar.show', () => this.setState({ fullscreenDragbar: true }));
    ipcRenderer.on('fullscreen.dragbar.hide', () => this.setState({ fullscreenDragbar: false }));
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('settings.toggle', this.handleSettingsToggle);
    ipcRenderer.removeListener('search.toggle', this.handleSearchToggle);
    ipcRenderer.removeListener('search.result', this.handleSearchResult);
    ipcRenderer.removeListener('navbar.hidden');
    ipcRenderer.removeListener('navbar.shown');
    ipcRenderer.removeListener('fullscreen.dragbar.show');
    ipcRenderer.removeListener('fullscreen.dragbar.hide');
  }

  handleSearchResult = (event, result) => {
    // Only update UI on final result to avoid multiple React renders
    if (!result.finalUpdate) return;

    if (result.matches !== undefined) {
      this.setState({
        searchMatches: {
          current: result.activeMatchOrdinal,
          total: result.matches
        }
      });
    }
  };

  handleSettingsToggle = () => {
    this.setState(state => {
      const newShown = !state.settingsShown;

      // 决定显示哪种模式
      if (newShown) {
        // 显示 settings (全屏) - 同时关闭 search
        ipcRenderer.send('overlay.mouse-events', { shouldShow: true, mode: 'settings' });
        return {
          settingsShown: true,
          searchShown: false,
          searchText: '',
          searchMatches: { current: 0, total: 0 }
        };
      } else {
        // 关闭 settings
        ipcRenderer.send('overlay.mouse-events', { shouldShow: false });
        return { settingsShown: false };
      }
    });
  };

  handleSearchToggle = () => {
    this.setState(state => {
      const newShown = !state.searchShown;

      // 决定显示哪种模式
      if (newShown) {
        // 显示 search (小区域) - 同时关闭 settings
        ipcRenderer.send('overlay.mouse-events', { shouldShow: true, mode: 'search' });
        return {
          searchShown: true,
          settingsShown: false,
          searchText: '',
          searchMatches: { current: 0, total: 0 }
        };
      } else {
        // 关闭 search - 清除页面上的搜索高亮
        ipcRenderer.send('search.clear');
        ipcRenderer.send('overlay.mouse-events', { shouldShow: false });
        return {
          searchShown: false,
          searchText: '',
          searchMatches: { current: 0, total: 0 }
        };
      }
    }, () => {
      if (this.state.searchShown && this.searchInput.current) {
        // Use setTimeout to ensure DOM is rendered and overlay is visible
        setTimeout(() => {
          if (this.searchInput.current) {
            this.searchInput.current.focus();
          }
        }, 100);
      }
    });
  };

  handleSearchNext = () => {
    const { searchText } = this.state;
    if (!searchText) return;

    // Throttle: only allow one search per 50ms to avoid request pileup
    const now = Date.now();
    if (now - this.lastSearchTime < 50) return;
    this.lastSearchTime = now;

    ipcRenderer.send('search.find', { text: searchText, forward: true, findNext: true });
  };

  handleSearchPrevious = () => {
    const { searchText } = this.state;
    if (!searchText) return;

    // Throttle: only allow one search per 50ms to avoid request pileup
    const now = Date.now();
    if (now - this.lastSearchTime < 50) return;
    this.lastSearchTime = now;

    ipcRenderer.send('search.find', { text: searchText, forward: false, findNext: true });
  };

  handleSearchTextChange = (text) => {
    this.setState({ searchText: text });

    // Start search when text changes
    if (text) {
      ipcRenderer.send('search.find', { text, forward: true, findNext: false });
    } else {
      ipcRenderer.send('search.clear');
      this.setState({ searchMatches: { current: 0, total: 0 } });
    }
  };

  closeSettings = () => {
    // Settings 和 search 互斥，关闭 settings 就是关闭整个 overlay
    ipcRenderer.send('overlay.mouse-events', { shouldShow: false });
    this.setState({ settingsShown: false });
  };

  closeSearch = () => {
    // Clear search in the page
    ipcRenderer.send('search.clear');

    // Settings 和 search 互斥，关闭 search 就是关闭整个 overlay
    ipcRenderer.send('overlay.mouse-events', { shouldShow: false });
    this.setState({
      searchShown: false,
      searchText: '',
      searchMatches: { current: 0, total: 0 }
    });
  };

  handleHideNavbar = () => {
    // Hide navbar and close settings
    ipcRenderer.send('nav.hide');
    this.closeSettings();
  };

  render() {
    const { settingsShown, searchShown, searchText, searchMatches, navbarHidden, fullscreenDragbar } = this.state;

    return (
      <>
        {/* Drag bar - shown when navbar is hidden OR in fullscreen mode, and no other overlay is active */}
        {(navbarHidden || fullscreenDragbar) && !settingsShown && !searchShown && (
          <div className="drag-bar" />
        )}

        {/* Settings Overlay */}
        {settingsShown && (
          <div className="settings-overlay" onClick={this.closeSettings}>
            <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
              <Settings onClose={this.closeSettings} onHideNavbar={this.handleHideNavbar} />
            </div>
          </div>
        )}

        {/* Search Overlay */}
        {searchShown && (
          <div className="search-bar-floating">
            <input
              ref={this.searchInput}
              type="text"
              className="search-input"
              placeholder="Search in page..."
              value={searchText}
              onChange={(e) => this.handleSearchTextChange(e.target.value)}
              onKeyDown={(e) => {
                // Handle Cmd+F to close search (when input is focused)
                if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  this.handleSearchToggle();
                  return;
                }

                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    this.handleSearchPrevious();
                  } else {
                    this.handleSearchNext();
                  }
                } else if (e.key === 'Escape') {
                  this.closeSearch();
                }
              }}
            />
            <span className="search-matches">
              {searchMatches.total > 0 ? `${searchMatches.current}/${searchMatches.total}` : ''}
            </span>
            <button className="search-btn" onClick={this.handleSearchPrevious}>
              <i className="fa fa-chevron-up"/>
            </button>
            <button className="search-btn" onClick={this.handleSearchNext}>
              <i className="fa fa-chevron-down"/>
            </button>
            <button className="search-btn" onClick={this.closeSearch}>
              <i className="fa fa-times"/>
            </button>
          </div>
        )}
      </>
    );
  }
}

export default OverlayApp;
