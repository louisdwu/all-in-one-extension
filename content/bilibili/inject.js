/**
 * Bilibili — MAIN-world injector (formerly bilibili_1080p_inject.js).
 *
 * Scope: while logged out, make the player behave as if the account could play
 * 1080P, show subtitles and load comments; optionally force "stop after finish".
 *
 * Deliberate removals from the previous version (each one broke unrelated sites):
 *   - global override of `Object.defineProperty` (patched every library on the page)
 *   - global override of `window.setTimeout` (delayed every 25–35s timer anywhere)
 * Those "protections" are replaced by the CSS/reply hooks in the ISOLATED guard.
 *
 * MD5 / WBI signing now come from the unit-tested libs (libs/md5.js, libs/wbi.js)
 * instead of an inlined 170-line block.
 */
(function () {
    'use strict';

    if (window.__aioBiliInject) return;
    window.__aioBiliInject = true;

    const AIO = window.AIO;
    if (!AIO || !AIO.md5 || !AIO.wbi) return;
    const { encWbi, useWebKey } = AIO.wbi;
    const log = AIO.core ? AIO.core.log('bili:inject') : { debug() {}, warn() {}, error() {} };

    /* ------------------------------ config ------------------------------ */
    let config = {};
    function readConfig() {
        try {
            const raw = document.documentElement.getAttribute('data-aio-bili-config');
            if (raw) config = JSON.parse(raw);
        } catch (err) { /* keep the previous config */ }
    }
    readConfig();

    const isIncognito = () => {
        try {
            return document.documentElement.getAttribute('data-aio-incognito') === 'true';
        } catch (err) {
            return false;
        }
    };

    // A real login is identified by the presence of DedeUserID__ckMd5. Never
    // intercept anything for logged-in users — their account experience wins.
    const isLogin = !!document.cookie.match(/DedeUserID__ckMd5=([^;]+)/);

    const shouldLockPlayNext = () => {
        if (config.enabled === false || !config.playNextDisabled) return false;
        if (!isIncognito()) return false;
        return document.cookie.includes('aio_pnd=1') || !!config.playNextDisabled;
    };

    /* ----------------------- localStorage play-next lock ----------------------- */
    const nativeGetItem = localStorage.getItem.bind(localStorage);
    const nativeSetItem = localStorage.setItem.bind(localStorage);

    function patchProfile(raw) {
        try {
            const profile = JSON.parse(raw || '{}');
            if (!profile.play) profile.play = {};
            profile.play.play_mode = 2; // 2 = 播完暂停
            return JSON.stringify(profile);
        } catch (err) {
            return raw;
        }
    }

    localStorage.getItem = function (key) {
        const value = nativeGetItem(key);
        if (!shouldLockPlayNext()) return value;
        if (key === 'recommend_auto_play') return 'close';
        if (key === 'bpx_player_profile') return patchProfile(value);
        return value;
    };

    localStorage.setItem = function (key, value) {
        if (!shouldLockPlayNext()) return nativeSetItem(key, value);
        if (key === 'recommend_auto_play') return nativeSetItem(key, 'close');
        if (key === 'bpx_player_profile') return nativeSetItem(key, patchProfile(value));
        return nativeSetItem(key, value);
    };

    function syncPlaybackSettings() {
        try {
            const raw = nativeGetItem('bpx_player_profile');
            const profile = raw ? JSON.parse(raw) : {};
            let changed = false;

            if (config.autoplay !== undefined) {
                if (!profile.media) profile.media = {};
                const desired = !!config.autoplay;
                if (profile.media.autoplay !== desired) {
                    profile.media.autoplay = desired;
                    changed = true;
                }
            }
            if (shouldLockPlayNext()) {
                if (!profile.play) profile.play = {};
                if (profile.play.play_mode !== 2) {
                    profile.play.play_mode = 2;
                    changed = true;
                }
                if (nativeGetItem('recommend_auto_play') !== 'close') nativeSetItem('recommend_auto_play', 'close');
            }
            if (changed) nativeSetItem('bpx_player_profile', JSON.stringify(profile));
        } catch (err) {
            log.warn('playback settings sync failed', err.message);
        }
    }
    syncPlaybackSettings();

    /* --------------------------- logged-out patches --------------------------- */
    const fakeUid = Math.floor(Math.random() * 100000000) + 100000000;

    function mockNav(data) {
        return {
            code: 0,
            message: '0',
            ttl: 1,
            data: {
                isLogin: true,
                face: 'https://i0.hdslb.com/bfs/face/member/noface.jpg',
                mid: fakeUid,
                uname: 'AIO 免登用户',
                level_info: { current_level: 6, current_min: 28800, current_exp: 29050, next_exp: '--' },
                money: 0,
                moral: 70,
                official: { role: 0, title: '', desc: '', type: -1 },
                officialVerify: { type: -1, desc: '' },
                pendant: { pid: 0, name: '', image: '', expire: 0 },
                vipStatus: 0,
                vipType: 0,
                wallet: { mid: fakeUid, bcoin_balance: 0, coupon_balance: 0, coupon_due_time: 0 },
                answer_status: 0,
                is_senior_member: 0,
                wbi_img: {
                    img_url: (data && data.wbi_img && data.wbi_img.img_url) || nativeGetItem('wbi_img_url') || '',
                    sub_url: (data && data.wbi_img && data.wbi_img.sub_url) || nativeGetItem('wbi_sub_url') || ''
                }
            }
        };
    }

    const MOCK_RELATION = {
        code: 0, message: '0', ttl: 1,
        data: { relation: { mid: 0, attribute: 0, mtime: 0, tag: null, special: 0 }, be_relation: { mid: 0, attribute: 0, mtime: 0, tag: null, special: 0 } }
    };
    const MOCK_ARCHIVE_RELATION = {
        code: 0, message: '0', ttl: 1,
        data: { attention: false, favorite: false, season_fav: false, like: false, dislike: false, coin: 0 }
    };

    function needsPatch(url) {
        if (!url) return false;
        return url.includes('/x/web-interface/nav') ||
            url.includes('/x/player/wbi/v2') ||
            url.includes('/x/v2/reply') ||
            url.includes('/x/web-interface/relation') ||
            url.includes('/x/web-interface/archive/relation') ||
            url.includes('/x/space/v2/myinfo');
    }

    function patchBody(text, url) {
        let json;
        try {
            json = JSON.parse(text);
        } catch (err) {
            return text;
        }
        if (!json || typeof json !== 'object') return text;

        if (url.includes('/x/web-interface/nav')) {
            const data = json.data || {};
            // Capture the real WBI keys before replacing the payload.
            if (data.wbi_img) {
                if (data.wbi_img.img_url) nativeSetItem('wbi_img_url', data.wbi_img.img_url);
                if (data.wbi_img.sub_url) nativeSetItem('wbi_sub_url', data.wbi_img.sub_url);
            }
            if (data.isLogin) return text; // a real session appeared: hands off
            return JSON.stringify(mockNav(data));
        }

        if (url.includes('/x/player/wbi/v2') && config.aiSubtitle !== false) {
            if (json.data) {
                json.data.need_login_subtitle = false;
                if (json.data.level_info) json.data.level_info.current_level = 6;
            }
            return JSON.stringify(json);
        }

        if (url.includes('/x/v2/reply') && config.comments !== false) {
            if (json.code !== 0) json.code = 0;
            if (json.data == null) {
                // Empty but structurally valid payload: the comments UI can render.
                json.data = { page: { count: 0, num: 0, size: 20 }, replies: [], hots: [], top: {}, upper: {} };
            }
            return JSON.stringify(json);
        }

        if (url.includes('/x/web-interface/relation')) return JSON.stringify(MOCK_RELATION);
        if (url.includes('/x/web-interface/archive/relation')) return JSON.stringify(MOCK_ARCHIVE_RELATION);
        if (url.includes('/x/space/v2/myinfo')) {
            if (json.code !== 0) json.code = 0;
            if (json.data) {
                json.data.mid = fakeUid;
                json.data.name = 'AIO 免登用户';
            }
            return JSON.stringify(json);
        }
        return text;
    }

    /** Re-sign a playurl query at qn=80 so the CDN accepts our request. */
    function resignPlayurl(rawUrl) {
        try {
            const url = new URL(rawUrl, location.href);
            const params = Object.fromEntries(url.searchParams.entries());
            params.qn = '80';
            params.try_look = '1';
            delete params.w_rid;
            delete params.wts;

            let query = null;
            const imgKey = useWebKey(nativeGetItem('wbi_img_url') || '');
            const subKey = useWebKey(nativeGetItem('wbi_sub_url') || '');
            if (imgKey && subKey) query = encWbi(params, imgKey, subKey);
            else query = new URLSearchParams(params).toString();

            return url.origin + url.pathname + '?' + query;
        } catch (err) {
            log.debug('playurl resign failed', err.message);
            return null;
        }
    }

    function isPlayurl(url) {
        return typeof url === 'string' && url.includes('api.bilibili.com/x/player/wbi/playurl') && config.video1080p !== false;
    }

    /* ------------------------------- XHR hook ------------------------------- */
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
        this.__aioUrl = typeof url === 'string' ? url : '';

        if (typeof url === 'string' && (url.includes('/x/v2/reply/wbi/main') || url.includes('/x/v2/reply/reply'))) {
            try { this.withCredentials = false; } catch (err) { /* ignore */ }
        }
        if (isPlayurl(url)) {
            const rewritten = resignPlayurl(url);
            if (rewritten) {
                arguments[1] = rewritten;
                this.__aioUrl = rewritten;
            }
        }
        return nativeOpen.apply(this, arguments);
    };

    function patchXhrGetter(prop) {
        const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, prop);
        if (!descriptor || !descriptor.get) return;
        Object.defineProperty(XMLHttpRequest.prototype, prop, {
            configurable: true,
            enumerable: descriptor.enumerable,
            get() {
                const value = descriptor.get.call(this);
                if (!this.__aioUrl || !needsPatch(this.__aioUrl)) return value;
                if (prop === 'responseText' && typeof value === 'string') return patchBody(value, this.__aioUrl);
                if (prop === 'response' && value && typeof value === 'object') {
                    try { return JSON.parse(patchBody(JSON.stringify(value), this.__aioUrl)); } catch (err) { return value; }
                }
                return value;
            }
        });
    }
    patchXhrGetter('responseText');
    patchXhrGetter('response');

    /* ------------------------------ fetch hook ------------------------------ */
    const nativeFetch = window.fetch;

    /** Response.url / type / redirected are read-only, but patchable per instance. */
    function cloneWithBody(response, body) {
        const clone = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
        for (const prop of ['url', 'redirected', 'type']) {
            try {
                Object.defineProperty(clone, prop, { value: prop === 'type' ? response.type : response[prop] });
            } catch (err) { /* ignore */ }
        }
        return clone;
    }

    window.fetch = function (input, init) {
        let url = typeof input === 'string' ? input : (input && input.url) || '';
        let nextInput = input;

        // Rewrite playurl requests (never mutate the caller's init object).
        if (isPlayurl(url)) {
            const rewritten = resignPlayurl(url);
            if (rewritten) {
                url = rewritten;
                nextInput = typeof input === 'string' ? rewritten : new Request(rewritten, input);
            }
        }

        // Comment requests must not carry stale credentials.
        let nextInit = init;
        if (typeof url === 'string' && (url.includes('/x/v2/reply/wbi/main') || url.includes('/x/v2/reply/reply'))) {
            nextInit = Object.assign({}, init, { credentials: 'omit' });
        }

        const promise = nextInit ? nativeFetch.call(window, nextInput, nextInit) : nativeFetch.call(window, nextInput);
        if (!needsPatch(url)) return promise;

        return promise.then(async (response) => {
            if (!response.ok) return response;
            const text = await response.text();
            return cloneWithBody(response, patchBody(text, url));
        });
    };

    if (!isLogin && config.comments !== false) {
        if (!document.cookie.includes('DedeUserID=')) {
            document.cookie = 'DedeUserID=' + fakeUid + '; path=/; domain=.bilibili.com; SameSite=Lax';
        }
    }

    /* ---------------------------- player policing ---------------------------- */
    let manualPaused = false;
    let lastUserAction = 0;

    function markUserAction() { lastUserAction = Date.now(); }

    document.addEventListener('mousedown', (event) => {
        const target = event.target;
        if (target && (target.closest('.bpx-player-ctrl-play') || target.closest('.bpx-player-video-area') || target.closest('video'))) {
            markUserAction();
        }
    }, true);
    document.addEventListener('keydown', (event) => {
        if (event.code === 'Space' || event.code === 'KeyK') markUserAction();
    }, true);

    function hookVideo(video) {
        if (!video || video.__aioHooked) return;
        video.__aioHooked = true;
        video.addEventListener('pause', () => { if (Date.now() - lastUserAction < 500) manualPaused = true; });
        video.addEventListener('play', () => { if (Date.now() - lastUserAction < 500) manualPaused = false; });
    }

    function request1080p() {
        if (config.video1080p === false) return;
        try {
            const player = window.player;
            if (!player || typeof player.requestQuality !== 'function') return;
            const supported = player.getSupportedQualityList?.() || [];
            const current = player.getQuality?.();
            const now = current && (current.nowQ || current.quality) || 0;
            if (supported.includes(80) && now < 80) player.requestQuality(80);
        } catch (err) { /* player not ready */ }
    }

    function loop() {
        readConfig();
        const video = document.querySelector('video');
        if (video) hookVideo(video);

        if (!isLogin && config.autoplay && video && video.paused && !video.ended && !manualPaused &&
            video.readyState >= 2 && Date.now() - lastUserAction > 2000) {
            video.play().catch(() => {});
        }
        if (!isLogin) {
            const confirm = document.querySelector('.bpx-player-toast-confirm-login');
            if (confirm) confirm.click();
            request1080p();
        }
        if (shouldLockPlayNext()) syncPlaybackSettings();
    }

    setInterval(loop, 2000);
    log.debug('inject ready', { isLogin, incognito: isIncognito() });
})();
