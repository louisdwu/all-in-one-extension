/**
 * All-in-One Extension: Smart Speeder Floating Menu
 */

function showFloatingMenu() {
    const existingMenu = document.getElementById('video-speed-floating-menu');
    if (existingMenu) {
        existingMenu.remove();
        return;
    }

    const menu = document.createElement('div');
    menu.id = 'video-speed-floating-menu';

    const currentUrl = window.location.hostname;
    const currentSpeed = window.speederCurrentSpeed || 1.0;
    const settings = window.speederSettings || {};

    menu.innerHTML = `
        <div class="menu-header">🎬 视频速度控制器</div>
        <div class="menu-status" id="menuStatus"></div>
        
        <div class="menu-section">
            <div class="menu-toggle-container">
                <span><strong>全局开关</strong></span>
                <div class="menu-toggle-switch" id="menuGlobalToggle">
                    <div class="menu-toggle-slider"></div>
                </div>
            </div>
        </div>
        
        <div class="menu-section">
            <div class="menu-section-title">当前速度</div>
            <div class="menu-speed-display" id="menuSpeedDisplay">${currentSpeed.toFixed(2)}x</div>
            <div class="menu-button-group">
                <button class="menu-btn" id="menuDecreaseBtn">- 降低</button>
                <button class="menu-btn" id="menuIncreaseBtn">+ 提高</button>
            </div>
        </div>
        
        <div class="menu-section">
            <div class="menu-section-title">预设速度切换</div>
            <div class="menu-speed-display" id="menuPresetDisplay">${settings.presetSpeed || "2.0"}x</div>
            <div class="menu-button-group">
                <button class="menu-btn" id="menuPresetBtn">切换预设</button>
            </div>
        </div>
        
        <div class="menu-section">
            <div class="menu-button-group">
                <button class="menu-secondary-btn" id="menuResetBtn">重置</button>
                <button class="menu-secondary-btn" id="menuOptionsBtn">设置</button>
            </div>
        </div>
        
        <div class="menu-info">当前页面: <span id="menuCurrentUrl">${currentUrl}</span></div>
        <div class="menu-close-hint">点击外部或再次点击悬浮球关闭</div>
    `;

    menu.style.cssText = `
        position: fixed;
        bottom: 90px;
        right: 20px;
        width: 300px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.2);
        z-index: 10000;
        font-family: Arial, sans-serif;
        color: #333;
        overflow: hidden;
    `;

    document.body.appendChild(menu);
    updateMenuUI();
    setupMenuEventListeners(menu);

    // 点击外部关闭逻辑
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!menu.contains(e.target) && !e.target.closest('#video-speed-float-ball')) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}

function updateMenuUI() {
    const menu = document.getElementById('video-speed-floating-menu');
    if (!menu) return;

    const settings = window.speederSettings || {};
    const currentSpeed = window.speederCurrentSpeed || 1.0;

    const toggle = menu.querySelector('#menuGlobalToggle');
    const status = menu.querySelector('#menuStatus');
    if (settings.globalEnabled) {
        toggle.classList.add('active');
        status.className = 'menu-status enabled';
        status.textContent = '✓ 功能已开启';
    } else {
        toggle.classList.remove('active');
        status.className = 'menu-status disabled';
        status.textContent = '✗ 功能已关闭';
    }

    const speedDisplay = menu.querySelector('#menuSpeedDisplay');
    if (speedDisplay) speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;

    const presetDisplay = menu.querySelector('#menuPresetDisplay');
    if (presetDisplay) presetDisplay.textContent = `${settings.presetSpeed}x`;
}

function setupMenuEventListeners(menu) {
    // 全局开关
    menu.querySelector('#menuGlobalToggle')?.addEventListener('click', () => {
        const settings = window.speederSettings;
        settings.globalEnabled = !settings.globalEnabled;
        chrome.runtime.sendMessage({ action: 'saveSpeederSettings', settings }, () => {
            updateMenuUI();
            chrome.runtime.sendMessage({ action: 'reloadSettings' });
        });
    });

    // 提高/降低
    menu.querySelector('#menuIncreaseBtn')?.addEventListener('click', () => {
        if (typeof increaseSpeed === 'function') {
            increaseSpeed();
            updateMenuUI();
        }
    });
    menu.querySelector('#menuDecreaseBtn')?.addEventListener('click', () => {
        if (typeof decreaseSpeed === 'function') {
            decreaseSpeed();
            updateMenuUI();
        }
    });

    // 预设
    menu.querySelector('#menuPresetBtn')?.addEventListener('click', () => {
        if (typeof presetSpeed === 'function') {
            presetSpeed();
            updateMenuUI();
        }
    });

    // 重置
    menu.querySelector('#menuResetBtn')?.addEventListener('click', () => {
        window.speederCurrentSpeed = window.speederSettings.defaultSpeed || 1.0;
        if (typeof applySpeedToVideos === 'function') applySpeedToVideos();
        updateMenuUI();
    });

    // 跳转设置页
    menu.querySelector('#menuOptionsBtn')?.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'openOptionsPage' });
    });
}

// 暴露全局
window.showFloatingMenu = showFloatingMenu;
window.updateMenuUI = updateMenuUI;
