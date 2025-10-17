import React from 'react';

import EmptyPage from './components/empty-page';
import WebPage from './components/web-page';
import { prepareUrl } from './utils/helpers';

const { ipcRenderer } = window.electron;

class Browser extends React.Component {
  state = {
    tabs: [],
    activeTabId: null,
    showNav: true,
    embedVideosEnabled: true
  };

  onTabsUpdate = (event, data) => {
    this.setState({
      tabs: data.tabs || [],
      activeTabId: data.activeTabId || null
    });
  };

  onCreateTab = (url) => {
    const preparedUrl = prepareUrl(url, this.state.embedVideosEnabled);
    // Only create tab if URL is valid (prepareUrl returns null for empty input)
    if (preparedUrl) {
      ipcRenderer.send('tab.create', preparedUrl);
    }
  };

  onCloseTab = (tabId) => {
    ipcRenderer.send('tab.close', tabId);
  };

  onSwitchTab = (tabId) => {
    ipcRenderer.send('tab.switch', tabId);
  };

  onNavigateTab = (tabId, url) => {
    const preparedUrl = prepareUrl(url, this.state.embedVideosEnabled);
    // Only navigate if URL is valid
    if (preparedUrl) {
      ipcRenderer.send('tab.navigate', { tabId, url: preparedUrl });
    }
  };

  onReloadTab = (tabId) => {
    ipcRenderer.send('tab.reload', tabId);
  };

  onBackTab = (tabId) => {
    ipcRenderer.send('tab.back', tabId);
  };

  onForwardTab = (tabId) => {
    ipcRenderer.send('tab.forward', tabId);
  };

  onembedVideosSet = (event, embedVideosEnabled) => {
    this.setState({ embedVideosEnabled });
  };

  componentDidMount() {
    // Get initial tabs
    try {
      const tabsData = ipcRenderer.sendSync('tabs.get');
      this.setState({
        tabs: tabsData.tabs || [],
        activeTabId: tabsData.activeTabId || null
      });
    } catch (error) {
      console.error('[Browser] Error getting initial tabs:', error);
      this.setState({
        tabs: [],
        activeTabId: null
      });
    }

    // Listen for tab updates
    ipcRenderer.on('tabs.update', this.onTabsUpdate);
    ipcRenderer.on('embedVideos.set', this.onembedVideosSet);

    // Listen for reload shortcut
    ipcRenderer.on('webPage.reload', () => {
      if (this.state.activeTabId) {
        this.onReloadTab(this.state.activeTabId);
      }
    });
  }

  componentWillUnmount() {
    ipcRenderer.removeListener('tabs.update', this.onTabsUpdate);
    ipcRenderer.removeListener('embedVideos.set', this.onembedVideosSet);
    ipcRenderer.removeListener('webPage.reload');
  }

  render() {
    const { tabs, activeTabId } = this.state;
    const hasActiveTabs = (tabs && tabs.length > 0);

    return (
      <div className='browser-wrap'>
        {/* Web page layer - always rendered, controlled by opacity */}
        <div className={`page-layer ${hasActiveTabs ? 'visible' : 'hidden'}`}>
          <WebPage
            ref={(r) => (this.webPageRef = r)}
            tabs={ tabs || [] }
            activeTabId={ activeTabId }
            onCreateTab={ this.onCreateTab }
            onCloseTab={ this.onCloseTab }
            onSwitchTab={ this.onSwitchTab }
            onNavigateTab={ this.onNavigateTab }
            onReloadTab={ this.onReloadTab }
            onBackTab={ this.onBackTab }
            onForwardTab={ this.onForwardTab }
            showNav={ this.state.showNav }
          />
        </div>

        {/* Empty page layer - always rendered, controlled by opacity */}
        <div className={`page-layer ${hasActiveTabs ? 'hidden' : 'visible'}`}>
          <EmptyPage onUrl={ this.onCreateTab }/>
        </div>
      </div>
    );
  }
}

export default Browser;
