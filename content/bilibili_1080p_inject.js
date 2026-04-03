// ============================================================
// Bilibili 1080P Bypass - MAIN World Injection
// 参考 GreasyFork #467511 的实现方式：
//   不伪造登录态，而是利用 B 站自带的"试看"机制 + 无限延长试看时间
// 必须在 document_start + MAIN world 执行
// ============================================================
(() => {
    'use strict';

    // 防止重复注入
    if (window.__bili1080p_injected) return;
    window.__bili1080p_injected = true;

    // 如果用户已登录，则不需要本脚本
    if (document.cookie.includes('DedeUserID')) {
        console.log('[AIO Bilibili 1080P] User is logged in, bypass not needed.');
        return;
    }

    // ---- 1. 劫持 Object.defineProperty ----
    // 让播放器认为当前允许试看（isViewToday / isVideoAble 永远为 true）
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

    // ---- 2. 劫持 setTimeout，无限延长试看倒计时 ----
    // B 站试看结束的 setTimeout 延迟通常为 30000ms (30s)
    const _setTimeout = window.setTimeout;
    window.setTimeout = function (func, delay) {
        if (delay === 3e4) {
            // 将 30 秒倒计时推迟到约 83 小时
            delay = 3e8;
        }
        return _setTimeout.apply(this, arguments);
    };

    // ---- 3. 自动点击试看按钮 + 切换画质 ----
    const _setInterval = window.setInterval || setInterval;
    _setInterval(async () => {
        const trialBtn = document.querySelector('.bpx-player-toast-confirm-login');
        if (!trialBtn) return;

        // 等待一小段时间后自动点击试看按钮
        await new Promise(resolve => _setTimeout(resolve, 500));
        trialBtn.click();

        // 试看激活后，等几秒让流切换完成，然后请求 1080P
        _setTimeout(() => {
            try {
                const player = window.player;
                if (player && typeof player.requestQuality === 'function') {
                    const supported = player.getSupportedQualityList?.() || [];
                    const targetQ = 80; // 80 = 1080P
                    if (supported.includes(targetQ)) {
                        const current = player.getQuality?.();
                        const nowQ = current?.nowQ || 0;
                        if (nowQ < targetQ) {
                            player.requestQuality(targetQ);
                            console.log('[AIO Bilibili 1080P] Switched to 1080P.');
                        }
                    }
                }
            } catch (e) {
                console.warn('[AIO Bilibili 1080P] Quality switch error:', e);
            }
        }, 3000);
    }, 1500);

    // ---- 4. 强制 localStorage 默认画质为 1080P ----
    try {
        const key = 'bilibili_player_settings';
        let raw = localStorage.getItem(key);
        let obj = raw ? JSON.parse(raw) : {};
        if (!obj.setting_config) obj.setting_config = {};
        obj.setting_config.defquality = 80;
        localStorage.setItem(key, JSON.stringify(obj));
    } catch (e) { }

    console.log('[AIO Bilibili 1080P] MAIN world bypass active (trial mode).');
})();
