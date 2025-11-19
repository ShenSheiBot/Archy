/**
 * WebContentsView 管理器
 *
 * 负责创建、管理和销毁所有标签页的 WebContentsView 实例
 *
 * 核心职责：
 * - 创建/销毁 WebContentsView
 * - 管理标签页切换和可见性
 * - 计算和更新 view bounds（响应窗口 resize 和导航栏显示/隐藏）
 * - 处理全屏模式
 * - 管理缩放级别（按域名持久化）
 * - 设置 WebContents 事件监听
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
    this.listeners = new Map();       // tabId -> { wc, listeners }
    this.activeTabId = null;
    this.showNav = true;              // 导航栏是否显示
    this.isFullscreen = false;        // 是否处于全屏模式

    // 缩放管理（迁移自 web-page/index.js）
    this.zoomLevelsByDomain = new Map(); // hostname -> zoom factor

    // 监听窗口事件
    this.setupWindowListeners();

    console.log('WebContentsViewManager initialized');
  }

  /**
   * 创建新的标签页 view
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} url - 初始 URL
   * @returns {WebContentsView} 创建的 view 实例
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
        // 允许 popups（对应 <webview> 的 allowpopups 属性）
        // 注意：在 Electron 中这个属性在 webPreferences 中不存在
        // 需要通过 setWindowOpenHandler 处理
      }
    });

    // 设置透明背景（支持 vibrancy）
    // 对应专家报告：macOS vibrancy 需要 ARGB 格式的透明色
    view.setBackgroundColor('#00000000');

    // 添加到窗口的 contentView
    // 对应专家报告：后添加的 view 会在上层
    this.browserWindow.contentView.addChildView(view);

    // 计算并设置 bounds
    this.updateViewBounds(view);

    // 默认隐藏（除非是第一个标签页）
    if (this.views.size > 0) {
      view.setVisible(false);
    } else {
      // 第一个标签页默认激活
      this.activeTabId = tabId;
    }

    // 保存引用
    this.views.set(tabId, view);

    // 设置事件监听
    this.setupViewListeners(tabId, view);

    // 设置窗口打开处理器（处理 popups）
    // 在新标签页打开链接，而不是新窗口
    view.webContents.setWindowOpenHandler(({ url }) => {
      console.log(`Tab ${tabId} wants to open: ${url}`);
      // 发射事件让主进程创建新标签页
      this.emit('new-window-requested', { url });
      // 阻止默认的新窗口行为
      return { action: 'deny' };
    });

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
   *
   * @param {number} tabId - 要激活的标签页 ID
   */
  switchToTab(tabId) {
    if (!this.views.has(tabId)) {
      console.error(`Cannot switch to non-existent tab ${tabId}`);
      return;
    }

    const oldTabId = this.activeTabId;
    if (oldTabId === tabId) {
      console.log(`Already on tab ${tabId}`);
      return;
    }

    // 隐藏旧标签页
    if (oldTabId !== null && this.views.has(oldTabId)) {
      const oldView = this.views.get(oldTabId);
      oldView.setVisible(false);
    }

    // 显示新标签页
    const newView = this.views.get(tabId);

    // 提升到最顶层（确保在其他 view 上方）
    // 对应专家报告：再次 addChildView 会将其重新排序到最顶层
    this.browserWindow.contentView.addChildView(newView);

    newView.setVisible(true);

    // 防御性代码：强制刷新
    // 对应专家报告：macOS 上从隐藏切换到可见时可能出现空白
    // 解决方案：调用 focus() 强制触发渲染帧生成
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
   *
   * @param {number} tabId - 要关闭的标签页 ID
   */
  async closeTab(tabId) {
    if (!this.views.has(tabId)) {
      console.warn(`Tab ${tabId} does not exist`);
      return;
    }

    const view = this.views.get(tabId);

    // 移除事件监听器
    this.cleanupViewListeners(tabId, view);

    // 从窗口移除
    // 对应专家报告：removeChildView 只是分离，不会自动销毁
    this.browserWindow.contentView.removeChildView(view);

    // 关闭 WebContents
    // 对应专家报告：必须显式调用 close() 或 destroy()
    // close() 是优雅关闭（触发 unload 事件）
    // destroy() 是强制终止
    try {
      await view.webContents.close();
    } catch (err) {
      console.error(`Error closing webContents for tab ${tabId}:`, err);
      // 强制销毁
      view.webContents.destroy();
    }

    // 从 Map 移除引用（允许 GC 回收）
    // 对应专家报告：必须清空所有引用，因为 WebContentsView 依赖 GC
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
   *
   * 布局策略（对应专家报告的布局隔离方案）：
   * - 全屏模式：覆盖整个窗口 {x:0, y:0, width, height}
   * - 显示导航栏：从导航栏下方开始 {x:0, y:38, width, height-38}
   * - 导航栏隐藏：覆盖整个窗口 {x:0, y:0, width, height}
   *
   * @returns {Object} bounds 对象 {x, y, width, height}
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
   *
   * @param {WebContentsView} view - 要更新的 view
   */
  updateViewBounds(view) {
    const bounds = this.calculateBounds();
    view.setBounds(bounds);
  }

  /**
   * 更新所有 views 的 bounds
   *
   * 对应专家报告：窗口 resize 时必须手动调用 setBounds
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
   *
   * @param {boolean} visible - 是否显示导航栏
   */
  setNavBarVisible(visible) {
    if (this.showNav === visible) return;

    this.showNav = visible;
    this.updateAllViewBounds();

    console.log(`Navbar visibility changed: ${visible}`);

    this.emit('navbar-visibility-changed', { visible });
  }

  /**
   * 进入全屏模式
   */
  enterFullscreen() {
    if (this.isFullscreen) return;

    this.isFullscreen = true;
    this.updateAllViewBounds();

    console.log('Entered fullscreen mode');

    this.emit('fullscreen-entered');
  }

  /**
   * 退出全屏模式
   */
  leaveFullscreen() {
    if (!this.isFullscreen) return;

    this.isFullscreen = false;
    this.updateAllViewBounds();

    console.log('Left fullscreen mode');

    this.emit('fullscreen-left');
  }

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

    console.log(`Zoom in: ${Math.round(newZoom * 100)}%`);

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

    console.log(`Zoom out: ${Math.round(newZoom * 100)}%`);

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

    console.log('Zoom reset: 100%');

    this.browserWindow.webContents.send('zoom.changed', {
      factor: 1.0,
      percentage: 100
    });
  }

  /**
   * 保存当前域名的缩放级别
   *
   * @param {WebContentsView} view - 当前 view
   * @param {number} zoomFactor - 缩放因子
   */
  saveZoomForCurrentDomain(view, zoomFactor) {
    try {
      const url = view.webContents.getURL();
      const hostname = new URL(url).hostname;
      this.zoomLevelsByDomain.set(hostname, zoomFactor);
      console.log(`Saved zoom ${Math.round(zoomFactor * 100)}% for ${hostname}`);
    } catch (err) {
      // 忽略无效 URL
    }
  }

  /**
   * 恢复域名的缩放级别
   *
   * @param {WebContentsView} view - 当前 view
   * @param {string} url - 当前 URL
   */
  restoreZoomForDomain(view, url) {
    try {
      const hostname = new URL(url).hostname;
      if (this.zoomLevelsByDomain.has(hostname)) {
        const zoomFactor = this.zoomLevelsByDomain.get(hostname);
        view.webContents.setZoomFactor(zoomFactor);
        console.log(`Restored zoom ${Math.round(zoomFactor * 100)}% for ${hostname}`);
      }
    } catch (err) {
      // 忽略无效 URL
    }
  }

  /**
   * 设置窗口事件监听
   */
  setupWindowListeners() {
    // 窗口 resize 时自动调整所有 view 的 bounds
    // 对应专家报告：必须手动监听 resize 事件
    this.browserWindow.on('resize', () => {
      this.updateAllViewBounds();
    });

    // 窗口关闭时清理所有 views
    this.browserWindow.on('close', () => {
      this.cleanup();
    });
  }

  /**
   * 设置 view 的事件监听
   *
   * 对应专家报告：所有 webContents 事件在主进程监听
   *
   * @param {number} tabId - 标签页 ID
   * @param {WebContentsView} view - view 实例
   */
  setupViewListeners(tabId, view) {
    const wc = view.webContents;

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

      // 发射事件更新 loading 状态
      this.emit('tab-update', { tabId, updates: { loading: false } });
    };

    // 开始加载
    listeners['did-start-loading'] = () => {
      console.log(`Tab ${tabId}: did-start-loading`);
      this.emit('tab-update', { tabId, updates: { loading: true } });
    };

    // 停止加载
    listeners['did-stop-loading'] = () => {
      console.log(`Tab ${tabId}: did-stop-loading`);
      this.emit('tab-update', { tabId, updates: { loading: false } });
    };

    // 导航完成
    listeners['did-navigate'] = (event, url) => {
      console.log(`Tab ${tabId}: did-navigate to ${url}`);

      this.emit('tab-update', { tabId, updates: { url } });

      // 恢复该域名的缩放级别
      this.restoreZoomForDomain(view, url);

      this.emit('tab-navigated', { tabId, url });
    };

    // 页面内导航（单页应用）
    listeners['did-navigate-in-page'] = (event, url) => {
      console.log(`Tab ${tabId}: did-navigate-in-page to ${url}`);
      this.emit('tab-update', { tabId, updates: { url } });
    };

    // 页面标题更新
    listeners['page-title-updated'] = (event, title) => {
      console.log(`Tab ${tabId}: title updated to "${title}"`);

      this.emit('tab-update', { tabId, updates: { title } });
      this.emit('tab-title-updated', { tabId, title });
    };

    // Favicon 更新
    listeners['page-favicon-updated'] = (event, favicons) => {
      const favicon = favicons && favicons.length > 0 ? favicons[0] : null;
      console.log(`Tab ${tabId}: favicon updated`);

      this.emit('tab-update', { tabId, updates: { favicon } });
      this.emit('tab-favicon-updated', { tabId, favicon });
    };

    // 加载失败
    listeners['did-fail-load'] = (event, errorCode, errorDescription, validatedURL) => {
      // 忽略某些无关紧要的错误
      if (errorCode === -3) return; // ERR_ABORTED (用户取消)

      console.error(`Tab ${tabId}: failed to load ${validatedURL}`, errorCode, errorDescription);

      this.emit('tab-update', { tabId, updates: { loading: false } });
      this.emit('tab-load-failed', { tabId, errorCode, errorDescription, url: validatedURL });
    };

    // 进入 HTML5 全屏
    // 对应专家报告：WebContents 支持 enter-html-full-screen 事件
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

    // WebContents 销毁时清理
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

    console.log(`Setup ${Object.keys(listeners).length} listeners for tab ${tabId}`);
  }

  /**
   * 清理 view 的事件监听
   *
   * 对应专家报告：必须显式移除所有监听器，防止内存泄漏
   *
   * @param {number} tabId - 标签页 ID
   * @param {WebContentsView} view - view 实例
   */
  cleanupViewListeners(tabId, view) {
    if (!this.listeners.has(tabId)) {
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

  /**
   * 清理所有资源
   *
   * 对应专家报告：窗口关闭时必须显式清理所有 WebContents
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
   *
   * @returns {WebContentsView|null}
   */
  getActiveView() {
    if (this.activeTabId === null) return null;
    return this.views.get(this.activeTabId);
  }

  /**
   * 获取指定标签页的 view
   *
   * @param {number} tabId - 标签页 ID
   * @returns {WebContentsView|undefined}
   */
  getView(tabId) {
    return this.views.get(tabId);
  }

  /**
   * 获取所有标签页 ID
   *
   * @returns {number[]}
   */
  getAllTabIds() {
    return Array.from(this.views.keys());
  }

  /**
   * 获取视图数量
   *
   * @returns {number}
   */
  getViewCount() {
    return this.views.size;
  }
}

module.exports = WebContentsViewManager;
