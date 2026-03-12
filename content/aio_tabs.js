(() => {
    // 状态变量
    let isRightMouseDown = false;
    let switcherActive = false;
    let tabsList = [];
    let selectedIndex = 0;

    // 开关与延迟配置状态
    let isAioTabsEnabled = true;
    let aioTabsDelay = 1000;
    let activationTimer = null;

    // 初始化读取设置并监听更改
    chrome.storage.sync.get(['aioTabsEnabled', 'aioTabsDelay'], (result) => {
        if (result.aioTabsEnabled !== undefined) {
            isAioTabsEnabled = result.aioTabsEnabled;
        }
        if (result.aioTabsDelay !== undefined) {
            aioTabsDelay = parseInt(result.aioTabsDelay);
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') {
            if (changes.aioTabsEnabled !== undefined) {
                isAioTabsEnabled = changes.aioTabsEnabled.newValue;
            }
            if (changes.aioTabsDelay !== undefined) {
                aioTabsDelay = parseInt(changes.aioTabsDelay.newValue);
            }
        }
    });

    // UI 元素
    let hostContainer = null;
    let shadowRoot = null;

    // 样式定义
    const styles = `
    :host {
      all: initial; /* 隔离全局样式 */
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647; /* 保证在最顶层 */
      pointer-events: none; /* 让鼠标事件透过，除了具体的列表区域 */
      display: flex;
      justify-content: center;
      align-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    
    .switcher-container {
      background: rgba(30, 30, 30, 0.75);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 12px;
      width: 600px;
      max-width: 80vw;
      max-height: 70vh;
      overflow-y: auto;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
      pointer-events: auto; /* 恢复本身区域的鼠标事件接收 */
      
      /* 隐藏滚动条但保留滚动功能 */
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    
    .switcher-container::-webkit-scrollbar {
      display: none;
    }
    
    .tab-item {
      display: flex;
      align-items: center;
      padding: 10px 14px;
      margin-bottom: 4px;
      border-radius: 8px;
      color: #e0e0e0;
      font-size: 14px;
      transition: all 0.15s ease;
      cursor: pointer;
    }
    
    .tab-item:last-child {
      margin-bottom: 0;
    }
    
    .tab-item.active {
      background: rgba(255, 255, 255, 0.15);
      color: #ffffff;
      transform: scale(1.02);
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }
    
    .tab-icon {
      width: 16px;
      height: 16px;
      margin-right: 12px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    
    .tab-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      flex-grow: 1;
    }
  `;

    function initUI() {
        if (hostContainer) return;

        hostContainer = document.createElement('div');
        hostContainer.id = 'aio-tab-switcher-host';

        // 创建 Shadow DOM
        shadowRoot = hostContainer.attachShadow({ mode: 'closed' });

        const styleEl = document.createElement('style');
        styleEl.textContent = styles;
        shadowRoot.appendChild(styleEl);

        const containerEl = document.createElement('div');
        containerEl.className = 'switcher-container';
        shadowRoot.appendChild(containerEl);

        document.documentElement.appendChild(hostContainer);
    }

    function destroyUI() {
        if (hostContainer && hostContainer.parentNode) {
            hostContainer.parentNode.removeChild(hostContainer);
            hostContainer = null;
            shadowRoot = null;
        }
    }

    function renderTabs() {
        if (!shadowRoot) return;
        const container = shadowRoot.querySelector('.switcher-container');
        container.innerHTML = '';

        tabsList.forEach((tab, index) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'tab-item' + (index === selectedIndex ? ' active' : '');
            itemEl.dataset.index = index;

            const iconEl = document.createElement('img');
            iconEl.className = 'tab-icon';
            iconEl.src = tab.favIconUrl || 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iI2NjYyIgZD0iTTggMTJhNCA0IDAgMSAwIDAtOCA0IDQgMCAwIDAgMCA4em0wIDFBNSA1IDAgMSAxIDggM2E1IDUgMCAwIDEgMCAxMHoiLz48L3N2Zz4='; // Default icon fallback
            iconEl.onerror = () => {
                iconEl.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iI2NjYyIgZD0iTTggMTJhNCA0IDAgMSAwIDAtOCA0IDQgMCAwIDAgMCA4em0wIDFBNSA1IDAgMSAxIDggM2E1IDUgMCAwIDEgMCAxMHoiLz48L3N2Zz4=';
            };

            const titleEl = document.createElement('div');
            titleEl.className = 'tab-title';
            titleEl.textContent = tab.title;

            itemEl.appendChild(iconEl);
            itemEl.appendChild(titleEl);

            // 添加鼠标悬停监听器
            itemEl.addEventListener('mouseenter', () => {
                if (isRightMouseDown) {
                    selectedIndex = index;
                    switcherActive = true;
                    // 只更新高亮，不自动滚动，避免鼠标悬停导致列表上下移动
                    updateHighlight(false);
                }
            });

            container.appendChild(itemEl);
        });

        scrollToSelected();
    }

    function updateHighlight(autoScroll = true) {
        if (!shadowRoot) return;
        const container = shadowRoot.querySelector('.switcher-container');
        const items = container.querySelectorAll('.tab-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('active');
            } else {
                item.classList.remove('active');
            }
        });
        if (autoScroll) {
            scrollToSelected();
        }
    }

    function scrollToSelected() {
        if (!shadowRoot) return;
        const container = shadowRoot.querySelector('.switcher-container');
        const activeItem = container.querySelector('.tab-item.active');
        if (activeItem) {
            // 保持选中项在视图中间偏上的位置
            const containerHeight = container.clientHeight;
            const itemOffset = activeItem.offsetTop;
            const itemHeight = activeItem.clientHeight;

            container.scrollTo({
                top: itemOffset - containerHeight / 2 + itemHeight / 2,
                behavior: 'smooth'
            });
        }
    }

    function activateSwitcher() {
        if (switcherActive) return;
        
        // 请求所有 tabs 数据
        try {
            chrome.runtime.sendMessage({ action: 'getTabs' }, (tabs) => {
                if (chrome.runtime.lastError) {
                    console.error("Error communicating with aio background:", chrome.runtime.lastError);
                    return;
                }
                if (tabs && tabs.length > 0) {
                    tabsList = tabs;
                    selectedIndex = tabs.findIndex(t => t.active);
                    if (selectedIndex === -1) selectedIndex = 0;

                    switcherActive = true;
                    initUI();
                    renderTabs();
                }
            });
        } catch (err) {
            console.error(err);
        }
    }

    // 事件监听器
    document.addEventListener('mousedown', (e) => {
        if (e.button === 2 && isAioTabsEnabled) {
            isRightMouseDown = true;
            switcherActive = false;

            // 清除之前的定时器
            if (activationTimer) clearTimeout(activationTimer);

            // 开启延迟判定
            if (aioTabsDelay > 0) {
                activationTimer = setTimeout(() => {
                    if (isRightMouseDown) {
                        activateSwitcher();
                    }
                }, aioTabsDelay);
            } else {
                // 如果设置为0，则立即触发（兼容旧行为）
                activateSwitcher();
            }
        }
    }, true);

    window.addEventListener('wheel', (e) => {
        if (isRightMouseDown && isAioTabsEnabled) {
            // 如果滚轮滚动，且右键还按着，无论是否到了延迟时间，立即唤起
            if (!switcherActive) {
                if (activationTimer) clearTimeout(activationTimer);
                activateSwitcher();
                // 注意：由于 activateSwitcher 是异步获取 tabs 的，
                // 第一个滚动事件可能无法直接操作列表，UI会在 tabs 返回后显示。
            }

            if (tabsList.length > 0) {
                e.preventDefault();
                e.stopPropagation();

                if (e.deltaY > 0) {
                    selectedIndex = (selectedIndex + 1) % tabsList.length;
                } else if (e.deltaY < 0) {
                    selectedIndex = (selectedIndex - 1 + tabsList.length) % tabsList.length;
                }
                updateHighlight(true);
            }
        }
    }, { passive: false, capture: true });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isRightMouseDown = false;
            if (activationTimer) clearTimeout(activationTimer);

            if (switcherActive) {
                const selectedTab = tabsList[selectedIndex];
                if (selectedTab) {
                    try {
                        chrome.runtime.sendMessage({ action: 'switchToTab', tabId: selectedTab.id });
                    } catch (err) {
                        console.error(err);
                    }
                }
                // 标志着已经处理了切换动作，contextmenu 应该被屏蔽
                // 但这里直接 destroyUI 并等待 contextmenu 事件
            }

            destroyUI();
        }
    }, true);

    // 阻止默认的右键菜单（如果已经进行了切换动作）
    window.addEventListener('contextmenu', (e) => {
        if (switcherActive) {
            e.preventDefault();
            e.stopPropagation();
            switcherActive = false; // 重置状态
        }
    }, true);

})();
