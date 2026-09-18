/**
 * All-in-One Extension: Smart Speeder Core
 * Refactored into component architecture.
 */

// 全局状态挂载 (供子模块 speeder_ball.js / speeder_menu.js 访问)
window.speederSettings = {
    globalEnabled: true,
    hideFloatingBall: false,
    excludeRules: [],
    includeRules: [],
    defaultSpeed: 1.0,
    presetSpeed: "2.0"
};
window.speederCurrentSpeed = 1.0;

let videoObserver = null;
let customShortcuts = {};

/**
 * 与 MAIN world 注入脚本通信，锁定/解锁速度
 * 通过 DOM 属性通信（最可靠的跨世界通信方式）
 * - CustomEvent.detail 无法跨世界
 * - postMessage 可能被网站拦截
 * - DOM 属性两个世界共享同一份 DOM，保证可达
 */
function sendSpeedLockCommand(action, speed) {
    const el = document.documentElement;
    if (!el) return;
    el.setAttribute('data-aio-speed-action', action);
    el.setAttribute('data-aio-speed-value', String(speed || 0));
}

/**
 * 加载配置
 */
function loadSettings() {
    chrome.runtime.sendMessage({ action: 'getSpeederSettings' }, (response) => {
        if (response) {
            window.speederSettings = {
                globalEnabled: response.globalEnabled !== false,
                hideFloatingBall: response.hideFloatingBall || false,
                excludeRules: Array.isArray(response.excludeRules) ? response.excludeRules : [],
                includeRules: Array.isArray(response.includeRules) ? response.includeRules : [],
                defaultSpeed: response.defaultSpeed || 1.0,
                presetSpeed: response.presetSpeed !== undefined ? String(response.presetSpeed) : "2.0"
            };
            window.speederCurrentSpeed = window.speederSettings.defaultSpeed;
            checkAndApplySpeed();
        }
        initUIComponents();
    });
}

/**
 * 初始化 UI 组件 (按需加载)
 */
function initUIComponents() {
    const s = window.speederSettings;
    if (s.globalEnabled && !s.hideFloatingBall) {
        if (typeof createFloatingBall === 'function') createFloatingBall();
    } else {
        document.getElementById('video-speed-float-ball')?.remove();
    }
}

/**
 * 核心逻辑：规则检查
 */
function shouldApplySpeed() {
    const url = window.location.href;
    const s = window.speederSettings;
    if (!s.globalEnabled) return false;

    if (s.includeRules.length > 0) {
        return s.includeRules.some(rule => new RegExp(rule).test(url));
    }
    if (s.excludeRules.length > 0) {
        if (s.excludeRules.some(rule => new RegExp(rule).test(url))) return false;
    }
    return true;
}

/**
 * 核心逻辑：应用倍速
 * 同时通知 MAIN world 注入脚本锁定速度，以对抗抖音等网站的速度重置
 */
function applySpeedToVideos() {
    if (!shouldApplySpeed()) {
        sendSpeedLockCommand('unlock');
        document.querySelectorAll('video').forEach(v => v.playbackRate = 1.0);
        return;
    }
    const speed = window.speederCurrentSpeed;
    // 先通知 MAIN world 锁定速度（对抗 playbackRate 劫持）
    sendSpeedLockCommand('lock', speed);
    // 同时在 Content Script 侧也设置一遍（兼容未被劫持的普通网站）
    document.querySelectorAll('video').forEach(v => {
        v.playbackRate = speed;
    });
    if (typeof updateFloatingBall === 'function') updateFloatingBall();
    if (typeof updateMenuUI === 'function') updateMenuUI();
}

/**
 * 辅助逻辑：探测新视频
 */
function setupVideoObserver() {
    if (videoObserver) videoObserver.disconnect();
    videoObserver = new MutationObserver(() => applySpeedToVideos());
    videoObserver.observe(document.body, { childList: true, subtree: true });
}

function checkAndApplySpeed() {
    // 多次延迟重试，确保 SPA 路由切换 / 视频懒加载场景下也能锁定
    const delays = [100, 500, 1500, 3000];
    delays.forEach(delay => {
        setTimeout(() => applySpeedToVideos(), delay);
    });
    setupVideoObserver();
}

/**
 * 倍速控制 API
 */
function increaseSpeed() {
    if (!shouldApplySpeed()) return;
    window.speederCurrentSpeed = Math.min(window.speederCurrentSpeed + 0.25, 16.0);
    applySpeedToVideos();
    showSpeedIndicator();
}

function decreaseSpeed() {
    if (!shouldApplySpeed()) return;
    window.speederCurrentSpeed = Math.max(window.speederCurrentSpeed - 0.25, 0.25);
    applySpeedToVideos();
    showSpeedIndicator();
}

function presetSpeed() {
    if (!shouldApplySpeed()) return;
    const presets = String(window.speederSettings.presetSpeed).split(/[,，]/)
        .map(s => parseFloat(s.trim()))
        .filter(s => !isNaN(s) && s > 0);
    
    if (presets.length === 0) return;

    if (presets.length === 1) {
        const target = presets[0];
        window.speederCurrentSpeed = (Math.abs(window.speederCurrentSpeed - target) < 0.01) 
            ? window.speederSettings.defaultSpeed : target;
    } else {
        let idx = presets.findIndex(s => Math.abs(window.speederCurrentSpeed - s) < 0.01);
        window.speederCurrentSpeed = presets[(idx + 1) % presets.length];
    }
    applySpeedToVideos();
    showSpeedIndicator();
}

/**
 * 顶部状态指示器
 */
function showSpeedIndicator(msg) {
    let el = document.getElementById('video-speed-indicator');
    if (!el) {
        el = document.createElement('div');
        el.id = 'video-speed-indicator';
        
        // 设置行内样式作为保底和动画基础
        Object.assign(el.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            background: 'rgba(0, 0, 0, 0.75)',
            color: 'white',
            padding: '16px 32px',
            borderRadius: '12px',
            fontSize: '28px',
            fontWeight: 'bold',
            zIndex: '100000',
            fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            pointerEvents: 'none',
            opacity: '0',
            transform: 'translate(-50%, -50%) scale(0.8)',
            transition: 'opacity 0.25s ease, transform 0.25s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            backdropFilter: 'blur(10px)',
            webkitBackdropFilter: 'blur(10px)'
        });
    }

    // 确定挂载容器，适配全屏播放器
    const fsElement = document.fullscreenElement || 
                      document.webkitFullscreenElement || 
                      document.mozFullScreenElement || 
                      document.msFullscreenElement;
    
    let targetContainer = document.body;
    if (fsElement) {
        targetContainer = fsElement.tagName === 'VIDEO' ? fsElement.parentNode : fsElement;
    }

    if (el.parentNode !== targetContainer) {
        targetContainer.appendChild(el);
    }
    
    el.textContent = msg || `${window.speederCurrentSpeed.toFixed(2)}x`;
    el.style.opacity = '1';
    el.style.transform = 'translate(-50%, -50%) scale(1)';
    
    clearTimeout(window.speederIndicatorTimer);
    clearTimeout(window.speederIndicatorRemoveTimer);
    
    window.speederIndicatorTimer = setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -50%) scale(0.8)';
        
        window.speederIndicatorRemoveTimer = setTimeout(() => {
            if (el.parentNode && el.parentNode !== document.body) {
                document.body.appendChild(el);
            }
        }, 300);
    }, 1500);
}

/**
 * 快捷键逻辑
 */
function loadCustomShortcuts() {
    chrome.runtime.sendMessage({ action: 'getSpeederShortcuts' }, (res) => {
        if (res) {
            customShortcuts = res;
            document.removeEventListener('keydown', handleKey);
            document.addEventListener('keydown', handleKey);
        }
    });
}

function handleKey(e) {
    if (!shouldApplySpeed()) return;
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Meta');
    
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
        let k = e.key;
        if (k === ' ') k = 'Space';
        else if (k.startsWith('Arrow')) k = k.replace('Arrow', '');
        if (k.length === 1) k = k.toUpperCase();
        parts.push(k);
    }
    const shortcut = parts.join('+');

    for (const [action, expected] of Object.entries(customShortcuts)) {
        if (shortcut === expected) {
            e.preventDefault();
            if (action === 'increaseSpeed') increaseSpeed();
            else if (action === 'decreaseSpeed') decreaseSpeed();
            else if (action === 'presetSpeed') presetSpeed();
            break;
        }
    }
}

/**
 * 消息中心
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const actions = {
        increaseSpeed, decreaseSpeed, presetSpeed,
        getSpeed: () => sendResponse({ speed: window.speederCurrentSpeed }),
        reloadSettings: () => { loadSettings(); loadCustomShortcuts(); }
    };
    if (actions[request.action]) {
        actions[request.action]();
        sendResponse({ success: true });
    }
});

// 启动程序
loadSettings();
loadCustomShortcuts();
// 暴露应用函数供 UI 调用
window.increaseSpeed = increaseSpeed;
window.decreaseSpeed = decreaseSpeed;
window.presetSpeed = presetSpeed;
window.applySpeedToVideos = applySpeedToVideos;