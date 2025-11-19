# WebContentsView 迁移实施指南

## 总览

本指南提供从 `<webview>` 标签到 `WebContentsView` 的完整迁移路径。

### 核心策略
- ✅ **布局隔离**：导航栏（React DOM）与 WebContentsView 不重叠
- ✅ **保持所有 view**：使用 `setVisible()` 切换，不销毁
- ✅ **放弃动画**：即时切换标签页（可在 React UI 添加视觉反馈）
- ✅ **严格清理**：明确的生命周期管理协议

### 迁移阶段
1. 创建 WebContentsView 管理器（新文件）
2. 实现标签页创建/销毁逻辑
3. 迁移布局计算和窗口 resize
4. 迁移所有 WebContents 事件
5. 实现全屏和特殊模式
6. 移除旧 webview 代码并测试

---

## 阶段 1：创建 WebContentsView 管理器

### 文件：`public/webContentsViewManager.js`

```javascript
/**
 * WebContentsView 管理器
 * 负责创建、管理和销毁所有标签页的 WebContentsView 实例
 */

const { WebContentsView } = require('electron');
const EventEmitter = require('events');

const NAV_BAR_HEIGHT = 38;

class WebContentsViewManager extends EventEmitter {
  constructor(browserWindow) {
    super();

    this.browserWindow = browserWindow;

    // 核心数据结构
    this.views = new Map();           // tabId -> WebContentsView
    this.activeTabId = null;
    this.showNav = true;              // 导航栏是否显示
    this.isFullscreen = false;        // 是否处于全屏模式

    // 缩放管理（迁移自 web-page/index.js）
    this.zoomLevelsByDomain = new Map();

    // 监听窗口 resize
    this.setupWindowListeners();
  }

  /**
   * 创建新的标签页 view
   */
  createView(tabId, url = 'about:blank') {
    if (this.views.has(tabId)) {
      console.warn(`View for tab ${tabId} already exists`);
      return this.views.get(tabId);
    }

    // 创建 WebContentsView
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:direct',
        preload: '', // 如果需要 preload，在这里指定
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowpopups: true,
      }
    });

    // 设置透明背景（支持 vibrancy）
    view.setBackgroundColor('#00000000');

    // 添加到窗口
    this.browserWindow.contentView.addChildView(view);

    // 计算并设置 bounds
    this.updateViewBounds(view);

    // 默认隐藏（除非是第一个标签页）
    if (this.views.size > 0) {
      view.setVisible(false);
    } else {
      this.activeTabId = tabId;
    }

    // 保存引用
    this.views.set(tabId, view);

    // 设置事件监听（在阶段 4 实现）
    this.setupViewListeners(tabId, view);

    // 加载 URL
    if (url && url !== 'about:blank') {
      view.webContents.loadURL(url).catch(err => {
        console.error(`Failed to load URL for tab ${tabId}:`, err);
      });
    }

    console.log(`Created view for tab ${tabId}, total views: ${this.views.size}`);

    return view;
  }

  /**
   * 切换激活的标签页
   */
  switchToTab(tabId) {
    if (!this.views.has(tabId)) {
      console.error(`Cannot switch to non-existent tab ${tabId}`);
      return;
    }

    const oldTabId = this.activeTabId;

    // 隐藏旧标签页
    if (oldTabId !== null && this.views.has(oldTabId)) {
      const oldView = this.views.get(oldTabId);
      oldView.setVisible(false);
    }

    // 显示新标签页
    const newView = this.views.get(tabId);

    // 提升到最顶层（确保在其他 view 上方）
    this.browserWindow.contentView.addChildView(newView);

    newView.setVisible(true);

    // 防御性代码：强制刷新（macOS bug 缓解）
    setTimeout(() => {
      try {
        newView.webContents.focus();
      } catch (err) {
        console.warn('Failed to focus webContents:', err);
      }
    }, 50);

    this.activeTabId = tabId;

    console.log(`Switched from tab ${oldTabId} to ${tabId}`);

    this.emit('tab-switched', { oldTabId, newTabId: tabId });
  }

  /**
   * 关闭标签页
   */
  async closeTab(tabId) {
    if (!this.views.has(tabId)) {
      console.warn(`Tab ${tabId} does not exist`);
      return;
    }

    const view = this.views.get(tabId);

    // 移除事件监听器（阶段 4 实现）
    this.cleanupViewListeners(tabId, view);

    // 从窗口移除
    this.browserWindow.contentView.removeChildView(view);

    // 关闭 WebContents（优雅关闭，触发 unload 事件）
    try {
      await view.webContents.close();
    } catch (err) {
      console.error(`Error closing webContents for tab ${tabId}:`, err);
      // 强制销毁
      view.webContents.destroy();
    }

    // 从 Map 移除引用（允许 GC 回收）
    this.views.delete(tabId);

    console.log(`Closed tab ${tabId}, remaining views: ${this.views.size}`);

    // 如果关闭的是激活标签页，切换到其他标签页
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.views.keys());
      if (remainingTabs.length > 0) {
        this.switchToTab(remainingTabs[0]);
      } else {
        this.activeTabId = null;
      }
    }

    this.emit('tab-closed', { tabId });
  }

  /**
   * 计算 view 的 bounds
   */
  calculateBounds() {
    const windowBounds = this.browserWindow.getBounds();

    let y = 0;
    let height = windowBounds.height;

    // 全屏模式：覆盖整个窗口
    if (this.isFullscreen) {
      y = 0;
      height = windowBounds.height;
    }
    // 显示导航栏：从导航栏下方开始
    else if (this.showNav) {
      y = NAV_BAR_HEIGHT;
      height = windowBounds.height - NAV_BAR_HEIGHT;
    }
    // 导航栏隐藏：覆盖整个窗口
    else {
      y = 0;
      height = windowBounds.height;
    }

    return {
      x: 0,
      y: y,
      width: windowBounds.width,
      height: height
    };
  }

  /**
   * 更新单个 view 的 bounds
   */
  updateViewBounds(view) {
    const bounds = this.calculateBounds();
    view.setBounds(bounds);
  }

  /**
   * 更新所有 views 的 bounds
   */
  updateAllViewBounds() {
    const bounds = this.calculateBounds();

    this.views.forEach((view) => {
      view.setBounds(bounds);
    });

    console.log(`Updated bounds for ${this.views.size} views:`, bounds);
  }

  /**
   * 设置导航栏可见性
   */
  setNavBarVisible(visible) {
    if (this.showNav === visible) return;

    this.showNav = visible;
    this.updateAllViewBounds();

    this.emit('navbar-visibility-changed', { visible });
  }

  /**
   * 进入全屏模式
   */
  enterFullscreen() {
    this.isFullscreen = true;
    this.updateAllViewBounds();

    this.emit('fullscreen-entered');
  }

  /**
   * 退出全屏模式
   */
  leaveFullscreen() {
    this.isFullscreen = false;
    this.updateAllViewBounds();

    this.emit('fullscreen-left');
  }

  /**
   * 设置窗口事件监听
   */
  setupWindowListeners() {
    // 窗口 resize 时自动调整所有 view 的 bounds
    this.browserWindow.on('resize', () => {
      this.updateAllViewBounds();
    });

    // 窗口关闭时清理所有 views
    this.browserWindow.on('close', () => {
      this.cleanup();
    });
  }

  /**
   * 设置 view 的事件监听（阶段 4 实现详细逻辑）
   */
  setupViewListeners(tabId, view) {
    // 占位符，阶段 4 实现
    // 这里会监听所有 webContents 事件：
    // - did-finish-load
    // - did-start-loading
    // - did-navigate
    // - page-title-updated
    // - page-favicon-updated
    // - enter-html-full-screen
    // - leave-html-full-screen
    // 等
  }

  /**
   * 清理 view 的事件监听
   */
  cleanupViewListeners(tabId, view) {
    // 占位符，阶段 4 实现
  }

  /**
   * 清理所有资源
   */
  async cleanup() {
    console.log('Cleaning up WebContentsViewManager...');

    const tabIds = Array.from(this.views.keys());

    for (const tabId of tabIds) {
      await this.closeTab(tabId);
    }

    this.removeAllListeners();

    console.log('WebContentsViewManager cleanup complete');
  }

  /**
   * 获取激活的 view
   */
  getActiveView() {
    if (this.activeTabId === null) return null;
    return this.views.get(this.activeTabId);
  }

  /**
   * 获取指定标签页的 view
   */
  getView(tabId) {
    return this.views.get(tabId);
  }

  /**
   * 获取所有标签页 ID
   */
  getAllTabIds() {
    return Array.from(this.views.keys());
  }
}

module.exports = WebContentsViewManager;
```

---

## 阶段 2：集成 WebContentsViewManager 到主进程

### 修改：`public/electron.js`

在文件顶部添加导入：

```javascript
const WebContentsViewManager = require('./webContentsViewManager');
```

在 `createWindow` 函数中，创建 viewManager 实例：

```javascript
function createWindow() {
  // ... 现有的窗口创建代码 ...

  mainWindow = new BrowserWindow({
    // ... 现有配置 ...
  });

  // 创建 WebContentsViewManager
  const viewManager = new WebContentsViewManager(mainWindow);

  // 保存到全局引用（或使用更好的状态管理）
  mainWindow.viewManager = viewManager;

  // ... 其余代码 ...
}
```

### 修改：`public/tabManager.js`

将标签页创建逻辑委托给 viewManager：

```javascript
// 在文件顶部添加
let viewManager = null;

// 新增：设置 viewManager 的函数（从 electron.js 调用）
function setViewManager(vm) {
  viewManager = vm;
}

// 修改 createTab 函数
function createTab(targetUrl = '', sendUpdateCallback, notifyRendererCallback) {
  const tabId = nextTabId++;
  const tab = {
    id: tabId,
    url: targetUrl || defaultUrl,
    title: 'New Tab',
    favicon: null,
    loading: false
  };

  tabs.push(tab);
  activeTabId = tabId;

  // 在主进程创建 WebContentsView
  if (viewManager) {
    viewManager.createView(tabId, targetUrl || defaultUrl);
  }

  sendUpdateCallback();
  notifyRendererCallback('tab.created', { tabId, url: targetUrl || defaultUrl });

  return tabId;
}

// 修改 closeTab 函数
async function closeTab(tabId, sendUpdateCallback) {
  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return false;

  tabs.splice(index, 1);

  // 在主进程销毁 WebContentsView
  if (viewManager) {
    await viewManager.closeTab(tabId);
  }

  // 如果关闭的是激活标签页，激活另一个
  if (activeTabId === tabId && tabs.length > 0) {
    activeTabId = tabs[0].id;
    if (viewManager) {
      viewManager.switchToTab(activeTabId);
    }
  } else if (tabs.length === 0) {
    activeTabId = null;
  }

  sendUpdateCallback();
  return true;
}

// 修改 switchToTab 函数
function switchToTab(tabId, sendUpdateCallback) {
  const tab = tabs.find(t => t.id === tabId);
  if (!tab) return false;

  activeTabId = tabId;

  // 在主进程切换 WebContentsView
  if (viewManager) {
    viewManager.switchToTab(tabId);
  }

  sendUpdateCallback();
  return true;
}

// 导出新函数
module.exports = {
  // ... 现有导出 ...
  setViewManager,
};
```

### 修改：`public/electron.js`（集成）

```javascript
const tabManager = require('./tabManager');
const WebContentsViewManager = require('./webContentsViewManager');

function createWindow() {
  // ... 窗口创建代码 ...

  // 创建 WebContentsViewManager
  const viewManager = new WebContentsViewManager(mainWindow);

  // 将 viewManager 传递给 tabManager
  tabManager.setViewManager(viewManager);

  // 监听 viewManager 事件
  viewManager.on('tab-switched', ({ oldTabId, newTabId }) => {
    console.log(`View manager switched tab: ${oldTabId} -> ${newTabId}`);
    // 可以在这里通知渲染进程更新 UI
    mainWindow.webContents.send('tabs.update', tabManager.getTabsData());
  });

  // ... 其余代码 ...
}
```

---

## 阶段 3：实现 IPC 通信调整

### 修改：`public/ipcHandler.js`

更新 IPC 处理器以使用 viewManager：

```javascript
// 导航到 URL
ipcMain.on('tab.navigate', (event, { tabId, url }) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.viewManager) return;

  const view = win.viewManager.getView(tabId);
  if (view) {
    view.webContents.loadURL(url).catch(err => {
      console.error('Failed to navigate:', err);
    });
  }
});

// 导航栏显示/隐藏
ipcMain.on('nav.show', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.viewManager) return;

  win.viewManager.setNavBarVisible(true);

  // macOS 交通灯按钮
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(true);
  }

  relayToRenderer('nav.show');
});

ipcMain.on('nav.hide', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.viewManager) return;

  win.viewManager.setNavBarVisible(false);

  // macOS 交通灯按钮
  if (process.platform === 'darwin') {
    win.setWindowButtonVisibility(false);
  }

  relayToRenderer('nav.hide');
});

// 缩放控制
ipcMain.on('zoom.in', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.viewManager) return;

  const activeView = win.viewManager.getActiveView();
  if (activeView) {
    const currentZoom = activeView.webContents.getZoomFactor();
    activeView.webContents.setZoomFactor(currentZoom + 0.1);
  }
});

ipcMain.on('zoom.out', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.viewManager) return;

  const activeView = win.viewManager.getActiveView();
  if (activeView) {
    const currentZoom = activeView.webContents.getZoomFactor();
    activeView.webContents.setZoomFactor(Math.max(0.5, currentZoom - 0.1));
  }
});

ipcMain.on('zoom.reset', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || !win.viewManager) return;

  const activeView = win.viewManager.getActiveView();
  if (activeView) {
    activeView.webContents.setZoomFactor(1.0);
  }
});
```

---

## 阶段 4：迁移 WebContents 事件监听

### 扩展：`public/webContentsViewManager.js`

在 `setupViewListeners` 方法中添加完整的事件处理：

```javascript
setupViewListeners(tabId, view) {
  const wc = view.webContents;

  // 存储监听器引用（用于清理）
  if (!this.listeners) {
    this.listeners = new Map();
  }

  const listeners = {};

  // DOM 准备完成
  listeners['dom-ready'] = () => {
    console.log(`Tab ${tabId}: dom-ready`);
    this.emit('tab-dom-ready', { tabId });
  };

  // 页面加载完成
  listeners['did-finish-load'] = () => {
    console.log(`Tab ${tabId}: did-finish-load`);
    this.emit('tab-loaded', { tabId });

    // 更新 tabManager 的 loading 状态
    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { loading: false });
  };

  // 开始加载
  listeners['did-start-loading'] = () => {
    console.log(`Tab ${tabId}: did-start-loading`);
    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { loading: true });
  };

  // 停止加载
  listeners['did-stop-loading'] = () => {
    console.log(`Tab ${tabId}: did-stop-loading`);
    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { loading: false });
  };

  // 导航完成
  listeners['did-navigate'] = (event, url) => {
    console.log(`Tab ${tabId}: did-navigate to ${url}`);

    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { url });

    // 恢复该域名的缩放级别
    try {
      const hostname = new URL(url).hostname;
      if (this.zoomLevelsByDomain.has(hostname)) {
        const zoomFactor = this.zoomLevelsByDomain.get(hostname);
        wc.setZoomFactor(zoomFactor);
      }
    } catch (err) {
      // 忽略无效 URL
    }

    this.emit('tab-navigated', { tabId, url });
  };

  // 页面标题更新
  listeners['page-title-updated'] = (event, title) => {
    console.log(`Tab ${tabId}: title updated to "${title}"`);

    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { title });

    this.emit('tab-title-updated', { tabId, title });
  };

  // Favicon 更新
  listeners['page-favicon-updated'] = (event, favicons) => {
    const favicon = favicons && favicons.length > 0 ? favicons[0] : null;
    console.log(`Tab ${tabId}: favicon updated`);

    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { favicon });

    this.emit('tab-favicon-updated', { tabId, favicon });
  };

  // 加载失败
  listeners['did-fail-load'] = (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Tab ${tabId}: failed to load ${validatedURL}`, errorCode, errorDescription);

    const tabManager = require('./tabManager');
    tabManager.updateTab(tabId, { loading: false });

    this.emit('tab-load-failed', { tabId, errorCode, errorDescription, url: validatedURL });
  };

  // 进入 HTML5 全屏
  listeners['enter-html-full-screen'] = () => {
    console.log(`Tab ${tabId}: enter-html-full-screen`);

    this.enterFullscreen();

    // 通知渲染进程隐藏导航栏
    this.browserWindow.webContents.send('fullscreen.enter');

    // macOS 隐藏交通灯按钮
    if (process.platform === 'darwin') {
      this.browserWindow.setWindowButtonVisibility(false);
    }
  };

  // 退出 HTML5 全屏
  listeners['leave-html-full-screen'] = () => {
    console.log(`Tab ${tabId}: leave-html-full-screen`);

    this.leaveFullscreen();

    // 通知渲染进程恢复导航栏
    this.browserWindow.webContents.send('fullscreen.leave');

    // macOS 显示交通灯按钮
    if (process.platform === 'darwin') {
      this.browserWindow.setWindowButtonVisibility(true);
    }
  };

  // 渲染进程崩溃
  listeners['render-process-gone'] = (event, details) => {
    console.error(`Tab ${tabId}: render-process-gone`, details);
    this.emit('tab-crashed', { tabId, details });
  };

  // WebContents 销毁
  listeners['destroyed'] = () => {
    console.log(`Tab ${tabId}: webContents destroyed`);
    this.cleanupViewListeners(tabId, view);
  };

  // 注册所有监听器
  Object.entries(listeners).forEach(([event, handler]) => {
    wc.on(event, handler);
  });

  // 保存引用（用于清理）
  this.listeners.set(tabId, { wc, listeners });
}

cleanupViewListeners(tabId, view) {
  if (!this.listeners || !this.listeners.has(tabId)) {
    return;
  }

  const { wc, listeners } = this.listeners.get(tabId);

  // 移除所有监听器
  Object.entries(listeners).forEach(([event, handler]) => {
    wc.removeListener(event, handler);
  });

  this.listeners.delete(tabId);

  console.log(`Cleaned up listeners for tab ${tabId}`);
}
```

---

## 阶段 5：修改渲染进程（移除 webview 标签）

### 修改：`src/components/web-page/index.js`

**关键变更**：移除所有 `<webview>` JSX，保留导航栏和控制元素

```javascript
import React from 'react';
import './style.css';

const { ipcRenderer } = window.electron || {};

class WebPage extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      showNav: true,
    };
  }

  componentDidMount() {
    // 监听来自主进程的全屏事件
    if (ipcRenderer) {
      ipcRenderer.on('fullscreen.enter', this.onFullscreenEnter);
      ipcRenderer.on('fullscreen.leave', this.onFullscreenLeave);
    }
  }

  componentWillUnmount() {
    if (ipcRenderer) {
      ipcRenderer.removeListener('fullscreen.enter', this.onFullscreenEnter);
      ipcRenderer.removeListener('fullscreen.leave', this.onFullscreenLeave);
    }
  }

  onFullscreenEnter = () => {
    this.setState({ showNav: false });
  };

  onFullscreenLeave = () => {
    this.setState({ showNav: true });
  };

  toggleNavBar = () => {
    const newShowNav = !this.state.showNav;
    this.setState({ showNav: newShowNav });

    // 通知主进程更新 WebContentsView bounds
    if (ipcRenderer) {
      ipcRenderer.send(newShowNav ? 'nav.show' : 'nav.hide');
    }
  };

  showNavBar = () => {
    this.setState({ showNav: true });
    if (ipcRenderer) {
      ipcRenderer.send('nav.show');
    }
  };

  render() {
    const { showNav } = this.state;
    const { tabs, activeTabId } = this.props;

    return (
      <div className={`webpage ${showNav ? 'with-nav' : 'no-nav'}`}>
        {/* 导航栏容器 */}
        {showNav && (
          <div className="navbar-wrapper">
            {/* 导航栏组件（保持不变） */}
            {this.props.children}
          </div>
        )}

        {/* 拖拽区域（导航栏隐藏时显示） */}
        {!showNav && (
          <div className="drag-area" />
        )}

        {/* 恢复导航栏按钮 */}
        {!showNav && (
          <button
            className="restore-nav-button"
            onClick={this.showNavBar}
          >
            Show Navigation
          </button>
        )}

        {/*
          重要：移除了所有 <webview> 标签！
          Web 内容现在完全由主进程的 WebContentsView 管理
        */}
      </div>
    );
  }
}

export default WebPage;
```

### 修改：`src/components/web-page/style.css`

更新样式，移除 webview 相关样式：

```css
.webpage {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

/* 导航栏容器（占据顶部 38px） */
.webpage.with-nav .navbar-wrapper {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 38px;
  z-index: 10000;
  background: var(--navbar-bg);
}

/*
  WebContentsView 的空间由主进程的 bounds 计算决定
  不再需要 .webview-container 样式
*/

/* 拖拽区域 */
.drag-area {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  z-index: 99;
  -webkit-app-region: drag;
}

/* 恢复导航栏按钮 */
.restore-nav-button {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.restore-nav-button:hover {
  background: rgba(0, 0, 0, 0.8);
}
```

---

## 阶段 6：处理缩放功能

### 扩展：`public/webContentsViewManager.js`

添加缩放管理方法：

```javascript
/**
 * 放大
 */
zoomIn() {
  const activeView = this.getActiveView();
  if (!activeView) return;

  const currentZoom = activeView.webContents.getZoomFactor();
  const newZoom = Math.min(3.0, currentZoom + 0.1);
  activeView.webContents.setZoomFactor(newZoom);

  // 保存到域名映射
  this.saveZoomForCurrentDomain(activeView, newZoom);

  // 通知渲染进程显示缩放指示器
  this.browserWindow.webContents.send('zoom.changed', {
    factor: newZoom,
    percentage: Math.round(newZoom * 100)
  });
}

/**
 * 缩小
 */
zoomOut() {
  const activeView = this.getActiveView();
  if (!activeView) return;

  const currentZoom = activeView.webContents.getZoomFactor();
  const newZoom = Math.max(0.5, currentZoom - 0.1);
  activeView.webContents.setZoomFactor(newZoom);

  this.saveZoomForCurrentDomain(activeView, newZoom);

  this.browserWindow.webContents.send('zoom.changed', {
    factor: newZoom,
    percentage: Math.round(newZoom * 100)
  });
}

/**
 * 重置缩放
 */
zoomReset() {
  const activeView = this.getActiveView();
  if (!activeView) return;

  activeView.webContents.setZoomFactor(1.0);

  this.saveZoomForCurrentDomain(activeView, 1.0);

  this.browserWindow.webContents.send('zoom.changed', {
    factor: 1.0,
    percentage: 100
  });
}

/**
 * 保存当前域名的缩放级别
 */
saveZoomForCurrentDomain(view, zoomFactor) {
  try {
    const url = view.webContents.getURL();
    const hostname = new URL(url).hostname;
    this.zoomLevelsByDomain.set(hostname, zoomFactor);
  } catch (err) {
    // 忽略无效 URL
  }
}
```

### 更新：`public/ipcHandler.js`

```javascript
ipcMain.on('zoom.in', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win.viewManager) {
    win.viewManager.zoomIn();
  }
});

ipcMain.on('zoom.out', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win.viewManager) {
    win.viewManager.zoomOut();
  }
});

ipcMain.on('zoom.reset', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && win.viewManager) {
    win.viewManager.zoomReset();
  }
});
```

---

## 阶段 7：测试和验证

### 测试清单

#### 基础功能
- [ ] 创建新标签页
- [ ] 关闭标签页
- [ ] 切换标签页（快捷键 Ctrl+Tab）
- [ ] 加载 URL 并导航
- [ ] 前进/后退按钮

#### 布局
- [ ] 窗口 resize 时 WebContentsView 正确调整
- [ ] 导航栏显示/隐藏时 bounds 正确更新
- [ ] macOS 交通灯按钮位置正确
- [ ] 透明背景和 vibrancy 效果正常

#### 全屏
- [ ] HTML5 全屏（视频全屏）正确工作
- [ ] 导航栏自动隐藏
- [ ] 退出全屏后恢复
- [ ] macOS 交通灯按钮在全屏时隐藏

#### 缩放
- [ ] Cmd+Plus/Minus/0 缩放功能
- [ ] 缩放级别按域名持久化
- [ ] 切换标签页时恢复缩放级别

#### 性能
- [ ] 10+ 标签页切换流畅
- [ ] 检查进程数量（是否共享进程）
- [ ] 内存占用对比（webview vs WebContentsView）
- [ ] 后台标签页的资源占用

#### 生命周期
- [ ] 关闭标签页后进程正确终止
- [ ] 关闭窗口后所有 WebContents 正确清理
- [ ] 无内存泄漏（重复打开/关闭标签页）

#### 平台
- [ ] macOS 测试
- [ ] Windows 测试（如适用）
- [ ] Linux 测试（如适用）

---

## 常见问题和解决方案

### Q1: 切换标签页时出现短暂空白

**原因**：macOS 上的渲染帧恢复问题

**解决**：
```javascript
// 在 switchToTab 中
newView.setVisible(true);
setTimeout(() => {
  newView.webContents.focus();  // 强制刷新
}, 50);
```

### Q2: 内存持续增长

**原因**：未正确清理 WebContents

**解决**：
```javascript
// 确保在 closeTab 中调用
await view.webContents.close();
// 并清空所有引用
this.views.delete(tabId);
```

### Q3: 全屏后导航栏仍然可见

**原因**：bounds 未正确更新

**解决**：
```javascript
// 在 enterFullscreen 中
this.isFullscreen = true;
this.updateAllViewBounds();  // 确保调用
```

### Q4: 多个标签页卡顿

**原因**：可能共享进程

**解决**：
```javascript
// 测试进程隔离
new WebContentsView({
  webPreferences: {
    partition: `persist:tab-${tabId}`,  // 强制隔离
  }
});
```

---

## 下一步

完成上述阶段后：
1. 移除 `src/components/web-page/index.js` 中所有旧的 webview 相关代码
2. 移除 `public/electron.js` 中的 `setBrowserView(null)` 调用
3. 全面测试所有功能
4. 性能对比测试
5. 提交迁移代码

---

## 回滚计划

如果迁移过程中遇到阻塞问题：
1. 保留 `<webview>` 分支作为备份
2. WebContentsView 可以与 `<webview>` 共存（过渡期）
3. 逐步迁移功能，而非一次性切换
