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
 */
function applySpeedToVideos() {
    if (!shouldApplySpeed()) {
        document.querySelectorAll('video').forEach(v => v.playbackRate = 1.0);
        return;
    }
    document.querySelectorAll('video').forEach(v => {
        if (v.readyState >= 2) v.playbackRate = window.speederCurrentSpeed;
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
    setTimeout(() => {
        applySpeedToVideos();
        setupVideoObserver();
    }, 100);
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
        document.body.appendChild(el);
    }
    el.textContent = msg || `${window.speederCurrentSpeed.toFixed(2)}x`;
    el.style.opacity = '1';
    
    clearTimeout(window.speederIndicatorTimer);
    window.speederIndicatorTimer = setTimeout(() => {
        el.style.opacity = '0';
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