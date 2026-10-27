/**
 * Bilibili — ISOLATED world guard (formerly bilibili_1080p.js + part of
 * bilibili_subtitles.js).
 *
 * Responsibilities:
 *  1. hide the login/VIP popups that interrupt playback for logged-out users
 *  2. publish the resolved bilibili config to the MAIN world via a DOM attribute
 *     (replaces the old inline <script> injection, which page CSP could block)
 */
(function () {
    'use strict';

    const AIO = window.AIO;

    // Publish the incognito flag *synchronously* — the MAIN-world injector runs
    // right after this file and needs it before the player reads localStorage.
    try {
        const inIncognito = chrome.extension && chrome.extension.inIncognitoContext;
        document.documentElement.setAttribute('data-aio-incognito', String(!!inIncognito));
    } catch (err) { /* not allowed in some contexts */ }

    if (!AIO || !AIO.content) return;
    const { log, settings, onChange, isTopFrame } = AIO.content;
    const guardLog = log('bili:guard');

    const POPUP_SELECTORS = [
        '.bili-mini-mask', '.bili-mini-login-wrapper', '.bili-mini-login', '.bili-mini-login-right-wp',
        '.login-panel-popover', '.vip-login-tip', '.bpx-player-toast-login', '.bpx-player-toast-wrap',
        '.video-unlogin-popover', '.unlogin-popover', '.lt-row', '.reply-notice', '.login-tip',
        '[class*="unlogin-jump"]', '[class*="not-login"]'
    ];

    const CSS_TEXT = POPUP_SELECTORS.join(',\n') + ` {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        width: 0 !important;
        height: 0 !important;
        overflow: hidden !important;
    }
    .bpx-player-ctrl-subtitle { display: flex !important; visibility: visible !important; }`;

    let styleEl = null;
    let observer = null;
    let removing = false;

    function installStyles() {
        if (styleEl && styleEl.isConnected) return;
        styleEl = document.createElement('style');
        styleEl.id = 'aio-bili-guard-css';
        styleEl.textContent = CSS_TEXT;
        (document.head || document.documentElement).appendChild(styleEl);
    }

    function removePopups() {
        if (removing) return;
        removing = true;
        try {
            for (const selector of POPUP_SELECTORS) {
                for (const node of document.querySelectorAll(selector)) node.remove();
            }
            for (const node of document.querySelectorAll('.bpx-player-toast-item, .bili-toast')) {
                if (node.textContent && node.textContent.includes('未登录')) node.remove();
            }
        } finally {
            removing = false;
        }
    }

    function startObserver() {
        if (observer) return;
        observer = new MutationObserver((mutations) => {
            if (removing) return;
            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    removePopups();
                    return;
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopObserver() {
        if (observer) observer.disconnect();
        observer = null;
    }

    function publishConfig(settingsValue) {
        const payload = {
            enabled: settingsValue.biliEnabled !== false,
            video1080p: settingsValue.bilibili1080PEnabled !== false,
            comments: settingsValue.biliCommentsEnabled !== false,
            aiSubtitle: settingsValue.biliAISubtitleEnabled !== false,
            autoSubtitle: settingsValue.biliAutoSubtitle !== false,
            autoplay: !!settingsValue.biliAutoPlay,
            playNextDisabled: !!settingsValue.biliPlayNextDisabled,
            subtitleHotkey: settingsValue.bilibiliSubtitles.subtitleHotkey || 's'
        };
        try {
            document.documentElement.setAttribute('data-aio-bili-config', JSON.stringify(payload));
        } catch (err) {
            guardLog.debug('publish failed', err.message);
        }
        return payload;
    }

    function apply(settingsValue) {
        const enabled = settingsValue.biliEnabled !== false;
        // Always publish: the MAIN world needs to know it must stay dormant.
        const config = publishConfig(settingsValue);
        if (!enabled) {
            stopObserver();
            if (styleEl) styleEl.remove();
            styleEl = null;
            return;
        }
        if (isTopFrame) {
            installStyles();
            startObserver();
            removePopups();
        }
        guardLog.debug('config published', config);
    }

    settings().then(apply);
    onChange(apply);
})();
