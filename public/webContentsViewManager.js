/**
 * WebContentsView 管理器
 *
 * 负责创建、管理和销毁所有 WebContentsView 实例（包括 NavBar 和内容标签页）
 *
 * 核心职责：
 * - 创建/销毁独立的 NavBarView 和 ContentViews
 * - 管理标签页切换和可见性
 * - 计算和更新 view bounds（响应窗口 resize 和导航栏显示/隐藏）
 * - 处理全屏模式
 * - 管理缩放级别（按域名持久化）
 * - 设置 WebContents 事件监听
 * - 实现 Structural View Hierarchy Isolation - NavBar 和 Content 各自独立接收输入事件
 */

const { WebContentsView } = require('electron');
const EventEmitter = require('events');
const path = require('path');

const NAVBAR_FULL_HEIGHT = 38;   // 完整导航栏高度
const NAVBAR_HIDDEN_HEIGHT = 0;  // 隐藏时高度为0，使用 overlay dragbar 代替

class WebContentsViewManager extends EventEmitter {
  constructor(browserWindow, globalZoomPercentage = 100) {
    super();

    this.browserWindow = browserWindow;

    // 核心数据结构
    this.navBarView = null;           // Independent NavBar WebContentsView
    this.contentViews = new Map();    // tabId -> Content WebContentsView
    this.listeners = new Map();       // tabId -> { wc, listeners }
    this.activeTabId = null;
    this.showNav = true;              // 导航栏是否显示（true=完整高度，false=15px拖动条）
    this.isFullscreen = false;        // 是否处于全屏模式
    this.overlayMode = null;          // 当前 overlay 模式: null, 'settings', 'search'

    // 缩放管理
    // zoomOffsetsByDomain: 每个域名的缩放偏移倍数（默认 1.0）
    // 最终缩放 = defaultZoomFactor * offset
    this.zoomOffsetsByDomain = new Map(); // hostname -> offset multiplier (default 1.0)
    this.defaultZoomFactor = globalZoomPercentage / 100; // 全局默认缩放因子 (0.5-2.0)

    // Detached mode CSS keys (for removing CSS when exiting detached mode)
    this.detachedModeCssKeys = new Map(); // tabId -> CSS key

    // 创建独立的 NavBar View
    this.createNavBarView();

    // 创建独立的 Overlay View (用于Settings和Search)
    this.createOverlayView();

    // 监听窗口事件
    this.setupWindowListeners();
  }

  /**
   * 创建独立的 NavBar WebContentsView
   *
   * 这是实现 Structural View Hierarchy Isolation 的关键
   * NavBar 作为独立的 WebContentsView 只接收其 bounds 内的输入事件
   */
  createNavBarView() {
    this.navBarView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'navbar-preload.js'),
        partition: 'persist:direct',
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false
      }
    });

    // 设置透明背景（支持 vibrancy）
    this.navBarView.setBackgroundColor('#00000000');

    // 添加到窗口的 contentView（NavBar 在最上层）
    this.browserWindow.contentView.addChildView(this.navBarView);

    // 计算并设置初始 bounds
    this.updateNavBarBounds();

    // 加载 navbar.html
    const isDev = !!process.env.APP_URL;
    if (isDev) {
      // Development: Load from Vite dev server
      const navbarUrl = `${process.env.APP_URL}/navbar.html`;
      this.navBarView.webContents.loadURL(navbarUrl).catch(err => {
        console.error('[ViewManager] Failed to load NavBar from dev server:', err);
      });
    } else {
      // Production: Load from build directory
      const navbarPath = path.join(__dirname, '../build/navbar.html');
      this.navBarView.webContents.loadFile(navbarPath).catch(err => {
        console.error('[ViewManager] Failed to load NavBar from file:', err);
      });
    }

    // Setup NavBar-specific event listeners
    this.setupNavBarListeners();
  }

  /**
   * Setup NavBar-specific event listeners
   */
  setupNavBarListeners() {
    const wc = this.navBarView.webContents;

    wc.on('dom-ready', () => {
    });

    wc.on('did-finish-load', () => {
    });

    wc.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      if (errorCode === -3) return; // ERR_ABORTED
      console.error('[ViewManager] NavBar failed to load:', errorCode, errorDescription);
    });

    wc.on('console-message', (event, level, message, line, sourceId) => {
    });
  }

  /**
   * 创建独立的 Overlay WebContentsView (用于Settings和Search)
   *
   * Overlay层覆盖整个窗口，用于显示Settings panel和Search bar
   * 必须作为WebContentsView添加，这样才能渲染在content views上面
   */
  createOverlayView() {
    this.overlayView = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        partition: 'persist:direct',
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        backgroundThrottling: false
      }
    });

    this.overlayView.setBackgroundColor('#00000000'); // Transparent

    this.browserWindow.contentView.addChildView(this.overlayView);
    this.updateOverlayBounds();

    const isDev = !!process.env.APP_URL;
    if (isDev) {
      const overlayUrl = `${process.env.APP_URL}/overlay.html`;
      this.overlayView.webContents.loadURL(overlayUrl);
    } else {
      const overlayPath = path.join(__dirname, '../build/overlay.html');
      this.overlayView.webContents.loadFile(overlayPath);
    }

    this.setupOverlayListeners();
  }

  /**
   * 设置 Overlay 的事件监听器
   */
  setupOverlayListeners() {
    const wc = this.overlayView.webContents;

    wc.on('dom-ready', () => {
    });

    wc.on('did-finish-load', () => {
      // IMPORTANT: 默认从视图层级中移除overlay，这样不会阻挡下面的views
      // 当显示Settings或Search时，会通过IPC消息重新添加
      this.browserWindow.contentView.removeChildView(this.overlayView);
      this.overlayMode = null;  // 重置模式
    });

    wc.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[ViewManager] Overlay failed to load:', errorCode, errorDescription);
    });

    wc.on('console-message', (event, level, message, line, sourceId) => {
    });
  }

  /**
   * 清除 overlay mode（当 overlay 被隐藏时）
   */
  clearOverlayMode() {
    this.overlayMode = null;
  }

  /**
   * 创建简单的 Drag Bar WebContentsView
   * 极简 HTML，不使用 React，纯粹测试 -webkit-app-region: drag
   */
  createDragBarView() {
    this.dragBarView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true
      }
    });

    // 设置透明背景
    this.dragBarView.setBackgroundColor('#00000000');

    // 加载极简 drag bar HTML
    const dragBarPath = path.join(__dirname, 'dragbar.html');
    this.dragBarView.webContents.loadFile(dragBarPath).catch(err => {
      console.error('[ViewManager] Failed to load DragBar:', err);
    });
  }

  /**
   * 更新 Overlay 的 bounds (全屏覆盖 - 用于 Settings)
   */
  updateOverlayBounds() {
    if (!this.overlayView) return;

    const [width, height] = this.browserWindow.getContentSize();
    this.overlayView.setBounds({
      x: 0,
      y: 0,
      width,
      height
    });

    this.overlayMode = 'settings';  // 记住当前模式
  }

  /**
   * 设置 Overlay 的 bounds 为搜索栏小区域 (右上角)
   * CSS: .search-bar-floating { position: fixed; top: 20px; right: 20px; }
   * 搜索栏实际位置: 38 (navbar) + 20 (css top) = 58px from window top
   */
  setOverlaySearchBounds() {
    if (!this.overlayView) return;

    const [windowWidth] = this.browserWindow.getContentSize();

    // 响应式搜索栏宽度：最小 280px，最大 450px
    const maxSearchBarWidth = 450;
    const minSearchBarWidth = 280;
    const marginRight = 30; // 右边距

    // 根据窗口宽度计算搜索栏宽度
    const availableWidth = windowWidth - marginRight;
    const searchBarWidth = Math.min(maxSearchBarWidth, Math.max(minSearchBarWidth, availableWidth));

    const searchBarHeight = 100; // 固定高度确保按钮和阴影不被裁剪
    const searchBarX = Math.max(0, windowWidth - searchBarWidth - 10); // 确保不会变负数
    const searchBarY = 38; // 从 navbar 下方开始 (navbar 高度 38px)

    this.overlayView.setBounds({
      x: searchBarX,
      y: searchBarY,
      width: searchBarWidth,
      height: searchBarHeight
    });

    this.overlayMode = 'search';  // 记住当前模式
  }

  /**
   * 设置 Overlay 的 bounds 为 drag bar 区域 (顶部 15px)
   * 用于 navbar 隐藏时显示拖动区域
   */
  setOverlayDragBarBounds() {
    if (!this.overlayView) return;

    const [width] = this.browserWindow.getContentSize();
    this.overlayView.setBounds({
      x: 0,
      y: 0,
      width,
      height: 15  // 只显示顶部 15px 的 drag bar
    });

    this.overlayMode = 'dragbar';  // 记住当前模式
  }

  /**
   * 更新 NavBar 的 bounds
   */
  updateNavBarBounds() {
    if (!this.navBarView) return;

    const [width] = this.browserWindow.getContentSize();
    const navHeight = this.isFullscreen ? 0 : (this.showNav ? NAVBAR_FULL_HEIGHT : NAVBAR_HIDDEN_HEIGHT);

    this.navBarView.setBounds({
      x: 0,
      y: 0,
      width,
      height: navHeight
    });
  }

  /**
   * 创建新的标签页 view
   *
   * @param {number} tabId - 标签页 ID
   * @param {string} url - 初始 URL
   * @returns {WebContentsView} 创建的 view 实例
   */
  createView(tabId, url = 'about:blank') {
    if (this.contentViews.has(tabId)) {
      return this.contentViews.get(tabId);
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
    if (this.contentViews.size > 0) {
      view.setVisible(false);
    } else {
      // 第一个标签页默认激活
      this.activeTabId = tabId;
    }

    // 保存引用
    this.contentViews.set(tabId, view);

    // 设置事件监听
    this.setupViewListeners(tabId, view);

    // 设置窗口打开处理器（处理 popups）
    // 在新标签页打开链接，而不是新窗口
    view.webContents.setWindowOpenHandler(({ url }) => {
      // 发射事件让主进程创建新标签页
      this.emit('new-window-requested', { url });
      // 阻止默认的新窗口行为
      return { action: 'deny' };
    });

    // 阻止链接拖放到外部浏览器
    view.webContents.on('dom-ready', () => {
      view.webContents.executeJavaScript(`
        document.addEventListener('dragstart', (e) => {
          if (e.target.tagName === 'A' || e.target.closest('a')) {
            e.preventDefault();
          }
        }, true);
        document.addEventListener('drop', (e) => {
          e.preventDefault();
        }, true);
        document.addEventListener('dragover', (e) => {
          e.preventDefault();
        }, true);
      `).catch(() => {});
    });

    // 应用默认缩放因子（在 dom-ready 后应用，因为加载时可能被重置）
    const defaultZoom = this.defaultZoomFactor;
    view.webContents.once('dom-ready', () => {
      view.webContents.setZoomFactor(defaultZoom);
    });

    // 加载 URL
    if (url && url !== 'about:blank') {
      view.webContents.loadURL(url).catch(err => {
        console.error(`Failed to load URL for tab ${tabId}:`, err);
      });
    }

    return view;
  }

  /**
   * 设置默认缩放因子，并立即更新所有标签页
   *
   * @param {number} factor - 缩放因子 (0.5-2.0)
   */
  setDefaultZoomFactor(factor) {
    this.defaultZoomFactor = Math.max(0.5, Math.min(2.0, factor));

    // 立即更新所有现有标签页的缩放
    this.contentViews.forEach((view, tabId) => {
      try {
        const url = view.webContents.getURL();
        const hostname = new URL(url).hostname;
        const offset = this.zoomOffsetsByDomain.get(hostname) || 1.0;
        const finalZoom = this.defaultZoomFactor * offset;
        view.webContents.setZoomFactor(finalZoom);
      } catch (err) {
        // 对于无效 URL（如空白页），直接使用默认缩放
        view.webContents.setZoomFactor(this.defaultZoomFactor);
      }
    });
  }

  /**
   * 切换激活的标签页
   *
   * @param {number} tabId - 要激活的标签页 ID
   */
  switchToTab(tabId) {
    if (!this.contentViews.has(tabId)) {
      return;
    }

    const oldTabId = this.activeTabId;
    if (oldTabId === tabId) {
      return;
    }

    // 隐藏旧标签页
    if (oldTabId !== null && this.contentViews.has(oldTabId)) {
      const oldView = this.contentViews.get(oldTabId);
      oldView.setVisible(false);
    }

    // 显示新标签页
    const newView = this.contentViews.get(tabId);

    // 提升到最顶层（确保在其他 view 上方，但保持在 NavBar 下方）
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

    this.emit('tab-switched', { oldTabId, newTabId: tabId });
  }

  /**
   * 关闭标签页
   *
   * @param {number} tabId - 要关闭的标签页 ID
   */
  async closeTab(tabId) {
    if (!this.contentViews.has(tabId)) {
      return;
    }

    const view = this.contentViews.get(tabId);

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
    this.contentViews.delete(tabId);

    // 如果关闭的是激活标签页，切换到其他标签页
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.contentViews.keys());
      if (remainingTabs.length > 0) {
        this.switchToTab(remainingTabs[0]);
      } else {
        this.activeTabId = null;
      }
    }

    this.emit('tab-closed', { tabId });
  }

  /**
   * 计算 content view 的 bounds
   *
   * 新布局策略：
   * - 全屏模式：覆盖整个窗口 {x:0, y:0, width, height}
   * - 显示导航栏：从导航栏下方开始 {x:0, y:38, width, height-38}
   * - 导航栏隐藏（15px拖动条）：从拖动条下方开始 {x:0, y:15, width, height-15}
   *
   * @returns {Object} bounds 对象 {x, y, width, height}
   */
  calculateBounds() {
    const [width, height] = this.browserWindow.getContentSize();

    // 计算 navbar 高度
    const navHeight = this.isFullscreen ? 0 : (this.showNav ? NAVBAR_FULL_HEIGHT : NAVBAR_HIDDEN_HEIGHT);

    return {
      x: 0,
      y: navHeight,
      width,
      height: height - navHeight
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
   * 更新所有 views 的 bounds（包括 NavBar 和 Content views）
   *
   * 对应专家报告：窗口 resize 时必须手动调用 setBounds
   */
  updateAllViewBounds() {
    // Update NavBar bounds
    this.updateNavBarBounds();

    // Update Overlay bounds 根据当前模式
    if (this.overlayMode === 'settings') {
      this.updateOverlayBounds();
    } else if (this.overlayMode === 'search') {
      this.setOverlaySearchBounds();
    } else if (this.overlayMode === 'dragbar') {
      this.setOverlayDragBarBounds();
    }
    // 如果 overlayMode 是 null，不更新（overlay 未显示）

    // Update all content view bounds
    const contentBounds = this.calculateBounds();
    this.contentViews.forEach((view) => {
      view.setBounds(contentBounds);
    });
  }

  /**
   * 设置导航栏可见性
   *
   * @param {boolean} visible - 是否显示导航栏
   */
  setNavBarVisible(visible) {
    if (this.showNav === visible) return;

    this.showNav = visible;

    // 隐藏导航栏时显示 overlay dragbar，显示导航栏时隐藏
    if (!visible) {
      this.showFullscreenDragBar();
    } else {
      this.hideFullscreenDragBar();
    }

    this.updateAllViewBounds();

    this.emit('navbar-visibility-changed', { visible });
  }

  /**
   * 进入全屏模式
   */
  enterFullscreen() {
    if (this.isFullscreen) return;

    this.isFullscreen = true;

    // 显示 dragbar overlay 以便用户可以拖动窗口
    this.showFullscreenDragBar();

    this.updateAllViewBounds();

    this.emit('fullscreen-entered');
  }

  /**
   * 退出全屏模式
   */
  leaveFullscreen() {
    if (!this.isFullscreen) return;

    this.isFullscreen = false;

    // 隐藏全屏时的 dragbar overlay
    this.hideFullscreenDragBar();

    this.updateAllViewBounds();

    this.emit('fullscreen-left');
  }

  /**
   * 显示全屏模式下的 Overlay DragBar
   */
  showFullscreenDragBar() {
    if (!this.overlayView) return;

    // 只有当没有其他 overlay 模式时才显示 dragbar
    if (this.overlayMode && this.overlayMode !== 'dragbar') return;

    // 添加 overlay view 到窗口
    if (!this.browserWindow.contentView.children.includes(this.overlayView)) {
      this.browserWindow.contentView.addChildView(this.overlayView);
    }

    this.setOverlayDragBarBounds();

    // 通知 overlay 显示 dragbar
    if (this.overlayView.webContents) {
      this.overlayView.webContents.send('fullscreen.dragbar.show');
    }
  }

  /**
   * 隐藏全屏模式下的 Overlay DragBar
   */
  hideFullscreenDragBar() {
    if (!this.overlayView) return;

    // 只有当前是 dragbar 模式才隐藏
    if (this.overlayMode !== 'dragbar') return;

    // 从窗口移除 overlay view
    if (this.browserWindow.contentView.children.includes(this.overlayView)) {
      this.browserWindow.contentView.removeChildView(this.overlayView);
    }

    this.overlayMode = null;

    // 通知 overlay 隐藏 dragbar
    if (this.overlayView.webContents) {
      this.overlayView.webContents.send('fullscreen.dragbar.hide');
    }
  }

  /**
   * 放大（增加域名偏移量）
   */
  zoomIn() {
    const activeView = this.getActiveView();
    if (!activeView) return;

    try {
      const url = activeView.webContents.getURL();
      const hostname = new URL(url).hostname;

      // 获取当前偏移量，增加 0.1
      const currentOffset = this.zoomOffsetsByDomain.get(hostname) || 1.0;
      const newOffset = Math.min(3.0, currentOffset + 0.1);
      this.zoomOffsetsByDomain.set(hostname, newOffset);

      // 计算最终缩放
      const finalZoom = this.defaultZoomFactor * newOffset;
      activeView.webContents.setZoomFactor(finalZoom);

      // 通知 navbar 显示缩放指示器
      if (this.navBarView && this.navBarView.webContents) {
        this.navBarView.webContents.send('zoom.changed', {
          factor: finalZoom,
          percentage: Math.round(finalZoom * 100)
        });
      }
    } catch (err) {
      // 对于无效 URL，直接调整绝对缩放
      const currentZoom = activeView.webContents.getZoomFactor();
      const newZoom = Math.min(3.0, currentZoom + 0.1);
      activeView.webContents.setZoomFactor(newZoom);
    }
  }

  /**
   * 缩小（减少域名偏移量）
   */
  zoomOut() {
    const activeView = this.getActiveView();
    if (!activeView) return;

    try {
      const url = activeView.webContents.getURL();
      const hostname = new URL(url).hostname;

      // 获取当前偏移量，减少 0.1
      const currentOffset = this.zoomOffsetsByDomain.get(hostname) || 1.0;
      const newOffset = Math.max(0.3, currentOffset - 0.1);
      this.zoomOffsetsByDomain.set(hostname, newOffset);

      // 计算最终缩放
      const finalZoom = this.defaultZoomFactor * newOffset;
      activeView.webContents.setZoomFactor(finalZoom);

      if (this.navBarView && this.navBarView.webContents) {
        this.navBarView.webContents.send('zoom.changed', {
          factor: finalZoom,
          percentage: Math.round(finalZoom * 100)
        });
      }
    } catch (err) {
      // 对于无效 URL，直接调整绝对缩放
      const currentZoom = activeView.webContents.getZoomFactor();
      const newZoom = Math.max(0.5, currentZoom - 0.1);
      activeView.webContents.setZoomFactor(newZoom);
    }
  }

  /**
   * 重置缩放（清除域名偏移，恢复到全局默认值）
   */
  zoomReset() {
    const activeView = this.getActiveView();
    if (!activeView) return;

    // 清除该域名的偏移设置
    try {
      const url = activeView.webContents.getURL();
      const hostname = new URL(url).hostname;
      this.zoomOffsetsByDomain.delete(hostname);
    } catch (err) {
      // 忽略无效 URL
    }

    // 应用全局默认缩放（无偏移）
    const resetZoom = this.defaultZoomFactor;
    activeView.webContents.setZoomFactor(resetZoom);

    if (this.navBarView && this.navBarView.webContents) {
      this.navBarView.webContents.send('zoom.changed', {
        factor: resetZoom,
        percentage: Math.round(resetZoom * 100)
      });
    }
  }

  /**
   * 恢复域名的缩放级别（使用偏移量）
   *
   * @param {WebContentsView} view - 当前 view
   * @param {string} url - 当前 URL
   */
  restoreZoomForDomain(view, url) {
    try {
      const hostname = new URL(url).hostname;
      const offset = this.zoomOffsetsByDomain.get(hostname) || 1.0;
      const finalZoom = this.defaultZoomFactor * offset;
      view.webContents.setZoomFactor(finalZoom);
    } catch (err) {
      // 对于无效 URL，使用默认缩放
      view.webContents.setZoomFactor(this.defaultZoomFactor);
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

    // Note: Obsolete mouse event interception code removed.
    // With independent NavBarView, each view naturally only receives events within its bounds.
    // This is Structural View Hierarchy Isolation - the correct architecture.
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
      this.emit('tab-dom-ready', { tabId });
    };

    // 页面加载完成
    listeners['did-finish-load'] = () => {
      this.emit('tab-loaded', { tabId });

      // 发射事件更新 loading 状态
      this.emit('tab-update', { tabId, updates: { loading: false } });
    };

    // 拦截导航请求，阻止外部协议（如 slack://）打开外部应用
    listeners['will-navigate'] = (event, url) => {
      try {
        const urlObj = new URL(url);
        // 只允许 http 和 https 协议
        if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
          event.preventDefault();
          console.log('[ViewManager] Blocked external protocol:', url);
        }
      } catch (e) {
        // URL 解析失败，阻止导航
        event.preventDefault();
      }
    };

    // 开始加载
    listeners['did-start-loading'] = () => {
      this.emit('tab-update', { tabId, updates: { loading: true } });
    };

    // 停止加载
    listeners['did-stop-loading'] = () => {
      this.emit('tab-update', { tabId, updates: { loading: false } });
    };

    // 导航完成
    listeners['did-navigate'] = (event, url) => {
      this.emit('tab-update', { tabId, updates: { url } });

      // 恢复该域名的缩放级别
      this.restoreZoomForDomain(view, url);

      this.emit('tab-navigated', { tabId, url });
    };

    // 页面内导航（单页应用）
    listeners['did-navigate-in-page'] = (event, url) => {
      this.emit('tab-update', { tabId, updates: { url } });
    };

    // 页面标题更新
    listeners['page-title-updated'] = (event, title) => {
      this.emit('tab-update', { tabId, updates: { title } });
      this.emit('tab-title-updated', { tabId, title });
    };

    // Favicon 更新
    listeners['page-favicon-updated'] = (event, favicons) => {
      const favicon = favicons && favicons.length > 0 ? favicons[0] : null;

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
      this.enterFullscreen();

      // 通知 navbar 隐藏导航栏
      if (this.navBarView && this.navBarView.webContents) {
        this.navBarView.webContents.send('fullscreen.enter');
      }

      // macOS 隐藏交通灯按钮
      if (process.platform === 'darwin') {
        this.browserWindow.setWindowButtonVisibility(false);
      }
    };

    // 退出 HTML5 全屏
    listeners['leave-html-full-screen'] = () => {
      this.leaveFullscreen();

      // 通知 navbar 恢复导航栏
      if (this.navBarView && this.navBarView.webContents) {
        this.navBarView.webContents.send('fullscreen.leave');
      }

      // macOS 显示交通灯按钮 (only if navbar is visible)
      if (process.platform === 'darwin' && this.showNav) {
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
      this.cleanupViewListeners(tabId, view);
    };

    // Note: Obsolete before-input-event listener removed.
    // With independent NavBarView, input event routing is handled naturally by the OS.
    // Each view only receives events within its own bounds.

    // 注册所有监听器
    Object.entries(listeners).forEach(([event, handler]) => {
      wc.on(event, handler);
    });

    // 保存引用（用于清理）
    this.listeners.set(tabId, { wc, listeners });
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
  }

  /**
   * 清理所有资源
   *
   * 对应专家报告：窗口关闭时必须显式清理所有 WebContents
   */
  async cleanup() {
    const tabIds = Array.from(this.contentViews.keys());

    for (const tabId of tabIds) {
      await this.closeTab(tabId);
    }

    this.removeAllListeners();
  }

  /**
   * 获取激活的 view
   *
   * @returns {WebContentsView|null}
   */
  getActiveView() {
    if (this.activeTabId === null) return null;
    return this.contentViews.get(this.activeTabId);
  }

  /**
   * 获取指定标签页的 view
   *
   * @param {number} tabId - 标签页 ID
   * @returns {WebContentsView|undefined}
   */
  getView(tabId) {
    return this.contentViews.get(tabId);
  }

  /**
   * 获取所有标签页 ID
   *
   * @returns {number[]}
   */
  getAllTabIds() {
    return Array.from(this.contentViews.keys());
  }

  /**
   * 获取视图数量
   *
   * @returns {number}
   */
  getViewCount() {
    return this.contentViews.size;
  }

  /**
   * 为所有标签页设置 detached mode（禁用/启用 pointer events）
   *
   * @param {boolean} enabled - 是否启用 detached mode
   */
  setDetachedModeForAllTabs(enabled) {
    if (enabled) {
      // 注入 CSS 禁用 pointer events
      const css = `
        *, *::before, *::after {
          pointer-events: none !important;
          cursor: default !important;
        }
        html, body {
          pointer-events: none !important;
        }
      `;

      this.contentViews.forEach((view, tabId) => {
        view.webContents.insertCSS(css).then(key => {
          this.detachedModeCssKeys.set(tabId, key);
        }).catch(err => {
          console.error(`[ViewManager] Failed to inject detached CSS for tab ${tabId}:`, err);
        });
      });
    } else {
      // 移除注入的 CSS
      this.contentViews.forEach((view, tabId) => {
        const cssKey = this.detachedModeCssKeys.get(tabId);
        if (cssKey) {
          view.webContents.removeInsertedCSS(cssKey).catch(err => {
            console.error(`[ViewManager] Failed to remove detached CSS for tab ${tabId}:`, err);
          });
          this.detachedModeCssKeys.delete(tabId);
        }
      });
    }
  }

  // Note: setNavbarFocus method removed - no longer needed with independent NavBarView.
  // The NavBar and Content views are now completely isolated.
}

module.exports = WebContentsViewManager;
