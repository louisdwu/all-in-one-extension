// ============================================================
// Bilibili AIO PRO (v4.0) - MAIN World Injection
// 负责：功能环境隔离（无痕 vs 普通） + 自动播放强同步
// ============================================================
(() => {
    'use strict';

    if (window.__bili_aio_v4) return;
    window.__bili_aio_v4 = true;

    const _setTimeout = window.setTimeout;
    const _defineProperty = Object.defineProperty;
    const _getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

    // ---- 1. 配置读取 ----
    let config = {};
    try {
        const configStr = document.documentElement.getAttribute('data-aio-bili-config');
        if (configStr) config = JSON.parse(configStr);
    } catch (e) {
        console.error('[AIO Bili] Failed to parse config', e);
    }

    const inIncognito = !!config.inIncognito;
    console.log(`[AIO Bili] Mode: ${inIncognito ? '🕵️ Incognito' : '🌐 Normal'}`);

    // ---- 2. 自动播放强同步 (覆盖 B 站原生设置) ----
    const syncAutoplay = () => {
        if (config.biliAutoPlay === undefined) return;
        try {
            const profileStr = localStorage.getItem('bpx_player_profile');
            let profile = {};
            if (profileStr) profile = JSON.parse(profileStr);
            
            if (!profile.media) profile.media = {};
            
            // 如果原生设置与插件设置不一致，则强制同步
            if (profile.media.autoplay !== config.biliAutoPlay) {
                console.log(`[AIO Bili] Syncing Bilibili autoplay: ${profile.media.autoplay} -> ${config.biliAutoPlay}`);
                profile.media.autoplay = config.biliAutoPlay;
                localStorage.setItem('bpx_player_profile', JSON.stringify(profile));
            }
        } catch (e) {
            console.warn('[AIO Bili] Autoplay sync failed', e);
        }
    };

    // 立即执行一次同步
    syncAutoplay();

    // ---- 3. 无痕模式专属增强逻辑 (隔离区) ----
    if (inIncognito) {
        // 3.1 Cookie 管理
        let customCookies = {};
        try {
            const confStr = localStorage.getItem('aio_bili_cookies');
            if (confStr) {
                const parsed = JSON.parse(confStr);
                if (parsed && parsed.sessdata) customCookies = parsed;
            }
        } catch (e) {}

        const fakeUid = Math.floor(Math.random() * 100000000) + 100000000;
        const setCookie = (name, val) => {
            if (val) document.cookie = `${name}=${val}; path=/; domain=.bilibili.com`;
        };

        if (customCookies.sessdata) {
            console.log('[AIO Bili] 🔑 Using custom dedicated account cookies.');
            document.cookie = "DedeUserID=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.bilibili.com";
            document.cookie = "SESSDATA=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=.bilibili.com";
            setCookie('SESSDATA', customCookies.sessdata);
            if (customCookies.dedeUserId) setCookie('DedeUserID', customCookies.dedeUserId);
        } else {
            if (!document.cookie.includes('DedeUserID=')) setCookie('DedeUserID', fakeUid);
            if (!document.cookie.includes('SESSDATA=')) setCookie('SESSDATA', 'aio_fake_sess%2C1999999999%2Cabc*42');
        }

        // 3.2 API 劫持与响应补丁
        const patchJSON = (text, url) => {
            try {
                const json = JSON.parse(text);
                if (!json) return text;

                // 个人信息劫持 (用于展示登录态)
                if (url.includes('/x/web-interface/nav')) {
                    json.code = 0;
                    if (json.data) {
                        json.data.isLogin = true;
                        if (!json.data.mid) json.data.mid = fakeUid;
                        if (!json.data.uname) json.data.uname = 'AIO User';
                        if (json.data.level_info) json.data.level_info.current_level = 6;
                    }
                    return JSON.stringify(json);
                }

                // 播放器配置劫持 (用于解锁 AI 字幕)
                if (url.includes('/x/player/wbi/v2') && config.biliAISubtitleEnabled !== false) {
                    if (json.data) {
                        json.data.need_login_subtitle = false;
                        if (json.data.level_info) json.data.level_info.current_level = 6;
                    }
                    return JSON.stringify(json);
                }

                // 评论区劫持
                if (url.includes('/x/v2/reply') && config.biliCommentsEnabled !== false) {
                    if (json.code !== 0) json.code = 0;
                    return JSON.stringify(json);
                }
            } catch (e) {}
            return text;
        };

        const needsPatch = (u) => u && (u.includes('/x/web-interface/nav') || u.includes('/x/player/wbi/v2') || u.includes('/x/v2/reply'));

        // XHR 劫持
        const rawOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
            this._aio_url = typeof url === 'string' ? url : '';
            return rawOpen.apply(this, arguments);
        };

        const xhrRTD = _getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText');
        if (xhrRTD && xhrRTD.get) {
            _defineProperty(XMLHttpRequest.prototype, 'responseText', {
                get: function() {
                    const t = xhrRTD.get.call(this);
                    return needsPatch(this._aio_url) ? patchJSON(t, this._aio_url) : t;
                },
                configurable: true, enumerable: true
            });
        }

        // Fetch 劫持
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

        // 3.3 属性覆盖 (1080P/会员锁定)
        if (config.bili1080PEnabled !== false) {
            Object.defineProperty = function(obj, prop, desc) {
                if (prop === 'isViewToday' || prop === 'isVideoAble') {
                    desc = { get: () => true, enumerable: false, configurable: true };
                }
                return _defineProperty.call(this, obj, prop, desc);
            };
        }

        // 3.4 弹窗拦截与延迟
        window.setTimeout = function(func, delay) {
            if (typeof delay === 'number' && delay >= 25000 && delay <= 35000) arguments[1] = 3e8; // 极大延迟登录弹窗
            return _setTimeout.apply(this, arguments);
        };

        // 3.5 无痕 UI 修正 (CSS)
        const style = document.createElement('style');
        style.textContent = `
            .bpx-player-ctrl-subtitle { display: flex !important; visibility: visible !important; }
            .bpx-player-toast-login, .bpx-player-toast-wrap .bpx-player-toast-item,
            .video-unlogin-popover, .login-panel-popover,
            .bili-mini-mask, .bili-mini-login-wrapper, .bili-mini-login,
            .vip-login-tip, .unlogin-popover { display: none !important; }
            .login-tip, [class*="login-tip"], [class*="unlogin-jump"] { display: none !important; }
            .reply-notice { display: none !important; }
        `;
        document.documentElement.appendChild(style);

        // 3.6 全局清障
        const cleanWalls = () => {
            if (config.biliCommentsEnabled !== false) {
                document.querySelectorAll('.reply-notice, .comment-login-tip, .reply-login-tip, .login-tip, [class*="not-login"], [class*="unlogin"]').forEach(el => el.remove());
            }
            document.querySelectorAll('.bpx-player-toast-item, .bili-toast').forEach(el => {
                if (el.textContent && el.textContent.includes('未登录')) el.remove();
            });
        };
        const obs = new MutationObserver(cleanWalls);
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setInterval(cleanWalls, 2000);
    }

    // ---- 4. 播放控制逻辑 (所有模式通用) ----
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

    const switchTo1080P = () => {
        if (!inIncognito || config.bili1080PEnabled === false) return;
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

        // 如果开启了自动播放且当前处于非活动暂停态
        if (config.biliAutoPlay && v && v.paused && !v.ended && !manualPaused && v.readyState >= 2) {
            // 防打断：如果是因为弹窗导致的暂停，强行起播
            if (Date.now() - lastUI > 2000) {
                v.play().catch(() => {});
                if (inIncognito) _setTimeout(switchTo1080P, 1000);
            }
        }
        
        if (inIncognito) {
            const btn = document.querySelector('.bpx-player-toast-confirm-login');
            if (btn) { btn.click(); _setTimeout(switchTo1080P, 2000); }
            switchTo1080P();
        }
    };

    setInterval(mainLoop, 1500);
})();
