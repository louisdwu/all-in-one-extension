// ============================================================
// Bilibili 1080P Bypass - MAIN World Injection
// 策略：Object.defineProperty 劫持 + setTimeout 劫持 + 持续恢复循环
// 必须在 document_start + MAIN world 执行
// ============================================================
(() => {
    'use strict';

    if (window.__bili1080p_injected) return;
    window.__bili1080p_injected = true;

    // 已登录用户不需要
    if (document.cookie.includes('DedeUserID')) return;

    // ---- 1. 劫持 Object.defineProperty ----
    const _defineProperty = Object.defineProperty;
    Object.defineProperty = function (obj, prop, descriptor) {
        if (prop === 'isViewToday' || prop === 'isVideoAble') {
            descriptor = {
                get: () => true,
                enumerable: false,
                configurable: true
            };
        }
        return _defineProperty.call(this, obj, prop, descriptor);
    };

    // ---- 2. 劫持 setTimeout ----
    const _setTimeout = window.setTimeout;
    const _clearTimeout = window.clearTimeout;
    // 记录可疑定时器 ID 以便后续清除
    const suspectTimerIds = new Set();

    window.setTimeout = function (func, delay) {
        // 精确匹配 30s
        if (delay === 3e4) {
            arguments[1] = 3e8;
        }
        // 宽泛匹配 25s~35s 范围（B 站可能微调了这个值）
        else if (typeof delay === 'number' && delay >= 25000 && delay <= 35000) {
            arguments[1] = 3e8;
        }
        const id = _setTimeout.apply(this, arguments);
        // 追踪 15s~120s 范围内的所有定时器
        if (typeof delay === 'number' && delay >= 15000 && delay <= 120000) {
            suspectTimerIds.add(id);
        }
        return id;
    };

    // ---- 3. 用户操作标记（区分用户暂停 vs 程序化暂停）----
    let userPaused = false;
    let lastUserAction = 0;

    const markUserAction = () => {
        userPaused = true;
        lastUserAction = Date.now();
        _setTimeout(() => { userPaused = false; }, 600);
    };

    // 捕获用户键盘暂停（空格键）
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' || e.key === ' ' || e.key === 'k' || e.key === 'K') {
            markUserAction();
        }
    }, true);

    // 捕获用户鼠标点击播放器区域
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (target && (
            target.closest('.bpx-player-ctrl-play') ||
            target.closest('.bpx-player-video-area') ||
            target.tagName === 'VIDEO'
        )) {
            markUserAction();
        }
    }, true);

    // ---- 4. 强制 localStorage 默认画质 ----
    try {
        const key = 'bilibili_player_settings';
        let raw = localStorage.getItem(key);
        let obj = raw ? JSON.parse(raw) : {};
        if (!obj.setting_config) obj.setting_config = {};
        obj.setting_config.defquality = 80;
        localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) { }

    // ---- 5. 核心循环：自动试看 + 画质切换 + 防暂停 ----
    let hasEverTrialed = false;

    const mainLoop = () => {
        // 5a. 自动点击试看按钮
        const trialBtn = document.querySelector('.bpx-player-toast-confirm-login');
        if (trialBtn) {
            trialBtn.click();
            hasEverTrialed = true;

            // 试看激活后延迟切换画质
            _setTimeout(() => { switchTo1080P(); }, 2000);
        }

        // 5b. 自动关闭/移除各种弹窗
        const popups = document.querySelectorAll(
            '.bili-mini-mask, .login-panel-popover, .vip-login-tip, ' +
            '.bpx-player-toast-login, .video-unlogin-popover, ' +
            '.unlogin-popover, .bili-mini-login-wrapper, .bili-mini-login'
        );
        popups.forEach(el => {
            try { el.style.display = 'none'; } catch (e) { }
        });

        // 5c. 如果视频被程序化暂停，自动恢复
        const video = document.querySelector('video');
        if (video && video.paused && !video.ended && !userPaused && video.readyState >= 2) {
            // 确保不是用户最近 2 秒内的操作
            if (Date.now() - lastUserAction > 2000) {
                video.play().catch(() => { });
                // 暂停后画质可能掉回 360P，重新切换
                _setTimeout(() => { switchTo1080P(); }, 1000);
            }
        }
    };

    const switchTo1080P = () => {
        try {
            const p = window.player;
            if (!p || typeof p.requestQuality !== 'function') return;

            const supported = p.getSupportedQualityList?.() || [];
            const current = p.getQuality?.();
            const nowQ = current?.nowQ || current?.quality || 0;
            const targetQ = 80; // 1080P

            if (supported.includes(targetQ) && nowQ < targetQ) {
                p.requestQuality(targetQ);
            }
        } catch (e) { }
    };

    // 启动主循环
    const startMainLoop = () => {
        // 高频检测前几秒（确保试看按钮第一时间被点击）
        const _setInterval = window.setInterval || setInterval;
        _setInterval(mainLoop, 1500);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startMainLoop);
    } else {
        startMainLoop();
    }

    console.log('[AIO Bilibili 1080P] Bypass active.');
})();
