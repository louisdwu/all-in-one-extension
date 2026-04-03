// ============================================================
// Bilibili 1080P Bypass - ISOLATED World Bridge
// 负责：CSS 注入屏蔽弹窗 + 从 chrome.storage 读取开关状态
// ============================================================
(() => {
    'use strict';

    // ---- 1. 注入 CSS 强制隐藏所有打断播放的弹窗 ----
    const style = document.createElement('style');
    style.id = 'aio-bili-1080p-css';
    style.textContent = [
        '.bili-mini-mask',
        '.bili-mini-login-right-wp',
        '.login-panel-popover',
        '.vip-login-tip',
        '.bpx-player-toast-login',
        '.bpx-player-toast-wrap',
        '.video-unlogin-popover',
        '.unlogin-popover',
        '.bili-mini-login-wrapper',
        '.lt-row',
        '.bili-mini-login',
        '.van-popover'
    ].join(',\n') + ' {\n' +
        '  display: none !important;\n' +
        '  visibility: hidden !important;\n' +
        '  opacity: 0 !important;\n' +
        '  pointer-events: none !important;\n' +
        '  width: 0 !important;\n' +
        '  height: 0 !important;\n' +
        '  overflow: hidden !important;\n' +
        '}';
    (document.head || document.documentElement).appendChild(style);

    // ---- 2. MutationObserver 持续清理新出现的弹窗 ----
    const popupSelectors = [
        '.bili-mini-mask',
        '.login-panel-popover',
        '.vip-login-tip',
        '.bpx-player-toast-login',
        '.bpx-player-toast-wrap',
        '.video-unlogin-popover',
        '.unlogin-popover',
        '.bili-mini-login-wrapper',
        '.bili-mini-login'
    ];

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                for (const sel of popupSelectors) {
                    if (node.matches && node.matches(sel)) {
                        node.remove();
                        return;
                    }
                    const inner = node.querySelector && node.querySelector(sel);
                    if (inner) inner.remove();
                }
            }
        }
    });

    if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            observer.observe(document.body, { childList: true, subtree: true });
        });
    }

    console.log('[AIO Bilibili 1080P] CSS popup blocker active.');
})();
