// ============================================================
// Bilibili AIO PRO (v3.5) - MAIN World Injection
// document_start + MAIN world
// 新增：SESSDATA 注入 + 评论区持续清障 + AI 字幕限制说明
// ============================================================
(() => {
    'use strict';

    if (window.__bili_aio_v3) return;
    window.__bili_aio_v3 = true;

    const _setTimeout = window.setTimeout;
    const _defineProperty = Object.defineProperty;
    const _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

    // ---- 0. Cookie 管理（定制专属账号 vs 伪造）----
    // 解析由 content script 同步过来的原生 localStorage（为了保证在 document_start 同步读取）
    let customCookies = {};
    try {
        const confStr = localStorage.getItem('aio_bili_cookies');
        if (confStr) {
            const parsed = JSON.parse(confStr);
            if (parsed && parsed.sessdata) {
                customCookies = parsed;
            }
        }
    } catch (e) {}

    const fakeUid = Math.floor(Math.random() * 100000000) + 100000000;

    const setCookie = (name, val) => {
        // 如果有自定义的真实cookie且匹配了当前项，我们优先考虑让原生B站逻辑走，
        // 或者直接写入真实的cookie值
        if (val) {
            document.cookie = `${name}=${val}; path=/; domain=.bilibili.com`;
        }
    };

    if (customCookies.sessdata) {
        // 方案A：使用了专属账号 Cookie，直接注入真实数据
        console.log('[AIO Bili] 🔑 Using custom dedicated account cookies.');
        // 先移除可能存在的假cookie
        document.cookie = "DedeUserID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.bilibili.com";
        document.cookie = "SESSDATA=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.bilibili.com";
        document.cookie = "bili_jct=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.bilibili.com";
        document.cookie = "DedeUserID__ckMd5=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.bilibili.com";

        setCookie('SESSDATA', customCookies.sessdata);
        if (customCookies.dedeUserId) {
            setCookie('DedeUserID', customCookies.dedeUserId);
        }
        // 当拥有真实账户时，某些拦截我们可能仍然需要（如1080P可能需要会员，专属账号若非会员也需要），
        // 但对于免登录相关补丁，保持开启也没有副作用。
    } else {
        // 方案B：现有的无cookie半成品方案
        if (!document.cookie.includes('DedeUserID=')) setCookie('DedeUserID', fakeUid);
        if (!document.cookie.includes('DedeUserID__ckMd5=')) setCookie('DedeUserID__ckMd5', 'aio_ck_md5');
        if (!document.cookie.includes('SESSDATA=')) setCookie('SESSDATA', 'aio_fake_sess%2C1999999999%2Cabc*42');
        if (!document.cookie.includes('bili_jct=')) setCookie('bili_jct', '00000000000000000000000000000000');
    }

    // ---- 1. JSON 响应补丁 ----
    const patchJSON = (text, url) => {
        try {
            const json = JSON.parse(text);
            if (!json || !json.data) return text;

            if (url.includes('/x/web-interface/nav')) {
                // 关键修复：必须把 code 从 -101 改为 0，否则组件直接判定失败
                json.code = 0;
                json.message = '0';
                json.data.isLogin = true;
                if (!json.data.mid) json.data.mid = fakeUid;
                if (!json.data.uname) json.data.uname = 'AIO';
                if (json.data.level_info) json.data.level_info.current_level = 6;
                console.log('[AIO Bili] ✓ nav patched: code=0, isLogin=true');
                return JSON.stringify(json);
            }

            if (url.includes('/x/player/wbi/v2')) {
                json.data.need_login_subtitle = false;
                if (json.data.level_info) json.data.level_info.current_level = 6;
                const subCount = json.data.subtitle?.subtitles?.length || 0;
                console.log('[AIO Bili] ✓ player patched: subtitles=' + subCount);
                return JSON.stringify(json);
            }
            // 1.3 评论接口：确保返回正常
            if (url.includes('/x/v2/reply')) {
                if (json.code !== 0) {
                    console.log('[AIO Bili] ✓ reply API patched: code', json.code, '→ 0');
                    json.code = 0;
                }
                return JSON.stringify(json);
            }
        } catch (e) {}
        return text;
    };

    // ---- 2. XHR getter 覆盖 ----
    const rawOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._aio_url = typeof url === 'string' ? url : '';
        return rawOpen.apply(this, arguments);
    };

    const needsPatch = (u) => u && (u.includes('/x/web-interface/nav') || u.includes('/x/player/wbi/v2') || u.includes('/x/v2/reply'));

    const xhrRTD = _getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
    const xhrRD = _getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response');

    if (xhrRTD && xhrRTD.get) {
        _defineProperty(XMLHttpRequest.prototype, 'responseText', {
            get: function() {
                const t = xhrRTD.get.call(this);
                return needsPatch(this._aio_url) ? patchJSON(t, this._aio_url) : t;
            },
            configurable: true, enumerable: true
        });
    }
    if (xhrRD && xhrRD.get) {
        _defineProperty(XMLHttpRequest.prototype, 'response', {
            get: function() {
                const r = xhrRD.get.call(this);
                if (needsPatch(this._aio_url)) {
                    if (typeof r === 'string') return patchJSON(r, this._aio_url);
                    if (r && typeof r === 'object' && !(r instanceof ArrayBuffer) && !(r instanceof Blob)) {
                        if (this._aio_url.includes('/x/web-interface/nav')) { r.code = 0; if (r.data) r.data.isLogin = true; }
                        if (this._aio_url.includes('/x/player/wbi/v2') && r.data) r.data.need_login_subtitle = false;
                        if (this._aio_url.includes('/x/v2/reply')) { r.code = 0; }
                        return r;
                    }
                }
                return r;
            },
            configurable: true, enumerable: true
        });
    }

    // ---- 3. Fetch 劫持 ----
    const rawFetch = window.fetch;
    window.fetch = async (...args) => {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (needsPatch(url)) {
            const resp = await rawFetch(...args);
            const text = await resp.text();
            return new Response(patchJSON(text, url), {
                status: resp.status, statusText: resp.statusText, headers: resp.headers
            });
        }
        return rawFetch(...args);
    };

    // ---- 4. __INITIAL_STATE__ 拦截 ----
    const existing = window.__INITIAL_STATE__;
    let _is = existing;
    try {
        _defineProperty(window, '__INITIAL_STATE__', {
            set(v) { _is = v; },
            get() { return _is; },
            configurable: true, enumerable: true
        });
    } catch(e) {}

    // ---- 5. Object.defineProperty（1080P）----
    Object.defineProperty = function(obj, prop, desc) {
        if (prop === 'isViewToday' || prop === 'isVideoAble') {
            desc = { get: () => true, enumerable: false, configurable: true };
        }
        return _defineProperty.call(this, obj, prop, desc);
    };

    // ---- 6. setTimeout（弹窗延迟）----
    window.setTimeout = function(func, delay) {
        if (typeof delay === 'number' && delay >= 25000 && delay <= 35000) arguments[1] = 3e8;
        return _setTimeout.apply(this, arguments);
    };

    // ---- 7. CSS 注入 ----
    const style = document.createElement('style');
    style.textContent = `
        .bpx-player-ctrl-subtitle { display: flex !important; visibility: visible !important; }
        .bpx-player-toast-login, .bpx-player-toast-wrap .bpx-player-toast-item,
        .video-unlogin-popover, .login-panel-popover,
        .bili-mini-mask, .bili-mini-login-wrapper, .bili-mini-login,
        .vip-login-tip, .unlogin-popover { display: none !important; }
        .login-tip, [class*="login-tip"], [class*="unlogin-jump"] { display: none !important; }
        .reply-notice { display: none !important; }
        .bili-toast, .bili-toast__wrap, .toast-wrap { display: none !important; }
    `;
    document.documentElement.appendChild(style);

    // ---- 8. 全局清障（评论区 + Toast）----
    const cleanWalls = () => {
        // 8.1 移除评论区登录提示
        document.querySelectorAll([
            '.reply-notice',
            '.comment-login-tip',
            '.reply-login-tip',
            '.login-tip',
            '[class*="not-login"]',
            '[class*="noLogin"]',
            '[class*="no-login"]',
            '[class*="unlogin"]'
        ].join(',')).forEach(el => el.remove());

        // 8.2 移除任何包含"未登录"文字的 toast/提示
        document.querySelectorAll('.bpx-player-toast-item, .bili-toast, [class*="toast"], [class*="Toast"]').forEach(el => {
            if (el.textContent && el.textContent.includes('未登录')) {
                el.remove();
            }
        });
    };

    const startCleaner = () => {
        const obs = new MutationObserver(cleanWalls);
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setInterval(cleanWalls, 2000);
    };

    // ---- 9. 暂停保护 ----
    let manualPaused = false, lastUI = 0;
    document.addEventListener('mousedown', (e) => {
        const t = e.target;
        if (t && (t.closest('.bpx-player-ctrl-play') || t.closest('.bpx-player-video-area') || t.tagName === 'VIDEO')) lastUI = Date.now();
    }, true);
    document.addEventListener('keydown', (e) => { if (['Space', 'KeyK'].includes(e.code)) lastUI = Date.now(); }, true);

    const hookVideo = (v) => {
        if (v.__aio_hooked) return;
        v.__aio_hooked = true;
        v.addEventListener('pause', () => { if (Date.now() - lastUI < 500) manualPaused = true; });
        v.addEventListener('play', () => { if (Date.now() - lastUI < 500) manualPaused = false; });
    };

    // ---- 10. 主循环 ----
    const switchTo1080P = () => {
        try {
            const p = window.player;
            if (!p || typeof p.requestQuality !== 'function') return;
            const s = p.getSupportedQualityList?.() || [];
            const c = p.getQuality?.();
            const q = c?.nowQ || c?.quality || 0;
            if (s.includes(80) && q < 80) p.requestQuality(80);
        } catch (e) {}
    };

    const mainLoop = () => {
        const v = document.querySelector('video');
        if (v) hookVideo(v);
        const btn = document.querySelector('.bpx-player-toast-confirm-login');
        if (btn) { btn.click(); _setTimeout(switchTo1080P, 2000); }
        if (v && v.paused && !v.ended && !manualPaused && v.readyState >= 2) {
            if (Date.now() - lastUI > 2000) { v.play().catch(() => {}); _setTimeout(switchTo1080P, 1000); }
        }
        switchTo1080P();
    };

    const init = () => {
        setInterval(mainLoop, 1500);
        startCleaner();
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    console.log('[AIO Bili] v3.9 Loaded. Sync custom cookies via localStorage.');
})();
