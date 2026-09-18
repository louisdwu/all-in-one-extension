/**
 * All-in-One Extension: Smart Speeder MAIN World 注入脚本
 *
 * 通信方式: DOM 属性（跨 isolated world 和 MAIN world 最稳健的共享通道）
 *   Content Script 设置 document.documentElement 的 data-aio-speed-* 属性
 *   MAIN world 通过 MutationObserver + 轮询读取这些属性
 *
 * 防御策略：
 *   1. 现代 Web 播放器内核接管（window.player / xgplayer）：
 *      抖音滑动流基于 DASH/MediaStream，直接调控 window.player.playbackRate 才能穿透管线。
 *   2. 原生 HTMLMediaElement.prototype 锁定（兼容 B站、YouTube、常规视频）。
 *   3. 200ms 轮询与媒体事件（play, playing, timeupdate）持续纠偏。
 */

(function () {
    'use strict';

    if (window.__aioSpeedLockInstalled) return;
    window.__aioSpeedLockInstalled = true;

    let lockEnabled = false;
    let targetSpeed = 1.0;
    let enforcerTimer = null;

    // === 原型链解析 ===
    function resolveDescriptor(prop) {
        const candidates = [
            window.HTMLVideoElement && window.HTMLVideoElement.prototype,
            window.HTMLMediaElement && window.HTMLMediaElement.prototype
        ].filter(Boolean);

        for (const p of candidates) {
            const desc = Object.getOwnPropertyDescriptor(p, prop);
            if (desc) return { desc, proto: p };
        }
        return null;
    }

    const rateFound = resolveDescriptor('playbackRate');
    const defaultRateFound = resolveDescriptor('defaultPlaybackRate');

    const origGet = rateFound ? rateFound.desc.get : function () { return this.playbackRate; };
    const origSet = rateFound ? rateFound.desc.set : function (v) { this.playbackRate = v; };
    const origDefaultGet = defaultRateFound ? defaultRateFound.desc.get : null;
    const origDefaultSet = defaultRateFound ? defaultRateFound.desc.set : null;

    // === L1: 重定义原生 playbackRate setter（常规视频兜底） ===
    function safeDefine(protoOrObj, prop, descriptor) {
        if (!protoOrObj) return;
        try {
            Object.defineProperty(protoOrObj, prop, Object.assign({ configurable: false, enumerable: true }, descriptor));
        } catch (_) {
            try {
                Object.defineProperty(protoOrObj, prop, Object.assign({ configurable: true, enumerable: true }, descriptor));
            } catch (_) {}
        }
    }

    const mediaProto = window.HTMLMediaElement ? window.HTMLMediaElement.prototype : null;
    const videoProto = window.HTMLVideoElement ? window.HTMLVideoElement.prototype : null;

    const rateDescriptor = {
        get() {
            return origGet.call(this);
        },
        set(val) {
            if (!lockEnabled) {
                origSet.call(this, val);
                return;
            }
            if (Math.abs(val - targetSpeed) > 0.001) {
                origSet.call(this, targetSpeed);
                return;
            }
            origSet.call(this, val);
        }
    };

    safeDefine(mediaProto, 'playbackRate', rateDescriptor);
    if (videoProto && videoProto !== mediaProto) {
        safeDefine(videoProto, 'playbackRate', rateDescriptor);
    }

    if (origDefaultGet && origDefaultSet) {
        const defaultRateDescriptor = {
            get() {
                return lockEnabled ? targetSpeed : origDefaultGet.call(this);
            },
            set(val) {
                if (!lockEnabled) {
                    origDefaultSet.call(this, val);
                    return;
                }
                origDefaultSet.call(this, targetSpeed);
            }
        };
        safeDefine(mediaProto, 'defaultPlaybackRate', defaultRateDescriptor);
        if (videoProto && videoProto !== mediaProto) {
            safeDefine(videoProto, 'defaultPlaybackRate', defaultRateDescriptor);
        }
    }

    // === 核心：调控播放器内核与常规视频 ===
    function syncAllPlayersAndVideos() {
        if (!lockEnabled) return;

        // 1. 核心接管：抖音/西瓜播放器内核单例
        try {
            const p = window.player || window.xgplayer;
            if (p && typeof p === 'object') {
                if (Math.abs(p.playbackRate - targetSpeed) > 0.001) {
                    p.playbackRate = targetSpeed;
                }
            }
        } catch (_) {}

        // 2. DOM 容器可能挂载的 player 实例
        try {
            document.querySelectorAll('.xgplayer, .douyin-player, xg-video-container').forEach(el => {
                const ep = el.player || el.__player;
                if (ep && Math.abs(ep.playbackRate - targetSpeed) > 0.001) {
                    ep.playbackRate = targetSpeed;
                }
            });
        } catch (_) {}

        // 3. 常规 video 标签兜底
        try {
            document.querySelectorAll('video').forEach(v => {
                try {
                    const current = origGet ? origGet.call(v) : v.playbackRate;
                    if (Math.abs(current - targetSpeed) > 0.001) {
                        if (origSet) origSet.call(v, targetSpeed);
                        v.playbackRate = targetSpeed;
                    }
                    if (origDefaultSet) origDefaultSet.call(v, targetSpeed);
                    v.defaultPlaybackRate = targetSpeed;
                } catch (_) {}
            });
        } catch (_) {}
    }

    // === L2: 捕获阶段拦截媒体事件（切视频、播放时立刻纠偏） ===
    let lastTimeUpdate = 0;
    ['ratechange', 'loadstart', 'loadedmetadata', 'loadeddata',
     'canplay', 'play', 'playing', 'seeked', 'timeupdate'].forEach(evt => {
        try {
            document.addEventListener(evt, function () {
                if (!lockEnabled) return;
                if (evt === 'timeupdate') {
                    const now = Date.now();
                    if (now - lastTimeUpdate < 400) return;
                    lastTimeUpdate = now;
                }
                syncAllPlayersAndVideos();
            }, true);
        } catch (_) {}
    });

    // === 通信：读取 DOM 属性 ===
    function readCommand() {
        try {
            const el = document.documentElement;
            if (!el) return;
            const action = el.getAttribute('data-aio-speed-action');
            const speedStr = el.getAttribute('data-aio-speed-value');
            const speed = parseFloat(speedStr);

            if (action === 'lock' && !isNaN(speed) && speed > 0) {
                const changed = Math.abs(targetSpeed - speed) > 0.001;
                if (!lockEnabled || changed) {
                    lockEnabled = true;
                    targetSpeed = speed;
                    syncAllPlayersAndVideos();
                    startEnforcer();
                }
            } else if (action === 'unlock') {
                if (lockEnabled) {
                    lockEnabled = false;
                    stopEnforcer();
                    try {
                        if (window.player) window.player.playbackRate = 1.0;
                    } catch (_) {}
                    document.querySelectorAll('video').forEach(v => {
                        try {
                            if (origDefaultSet) origDefaultSet.call(v, 1.0);
                            v.defaultPlaybackRate = 1.0;
                            if (origSet) origSet.call(v, 1.0);
                            v.playbackRate = 1.0;
                        } catch (_) {}
                    });
                }
            }
        } catch (_) {}
    }

    // 监听 DOM 属性变化
    function setupAttrObserver() {
        try {
            const el = document.documentElement;
            if (!el) return;
            const observer = new MutationObserver(() => readCommand());
            observer.observe(el, {
                attributes: true,
                attributeFilter: ['data-aio-speed-action', 'data-aio-speed-value']
            });
        } catch (_) {}
    }

    // === L3: 轮询兜底（200ms 心跳） ===
    function startEnforcer() {
        stopEnforcer();
        enforcerTimer = setInterval(() => {
            readCommand();
            if (!lockEnabled) return;
            syncAllPlayersAndVideos();
        }, 200);
    }

    function stopEnforcer() {
        if (enforcerTimer !== null) {
            clearInterval(enforcerTimer);
            enforcerTimer = null;
        }
    }

    // 动态 DOM 节点监听
    function setupDomObserver() {
        try {
            const target = document.body || document.documentElement;
            if (!target) return;
            const observer = new MutationObserver(() => {
                if (!lockEnabled) return;
                syncAllPlayersAndVideos();
            });
            observer.observe(target, { childList: true, subtree: true });
        } catch (_) {}
    }

    // === 初始化启动 ===
    setupAttrObserver();
    readCommand();

    if (document.body) {
        setupDomObserver();
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            setupDomObserver();
            readCommand();
        });
    }

    startEnforcer();
})();
