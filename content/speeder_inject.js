/**
 * Speed lock — MAIN world.
 *
 * Some players (Douyin, Xigua, custom xgplayer builds) reset `playbackRate`
 * from their own control loop, so setting it once from the content script is not
 * enough. This injector defends the target rate from inside the page and drives
 * the player core when one is exposed.
 *
 * Rewritten to be idle by default: the previous version started a 200ms
 * `setInterval` on *every* page, forever, whether or not a video existed.
 * Now the timer only runs while a lock is active and stops when the last video
 * disappears.
 */
(function () {
    'use strict';

    if (window.__aioSpeedLock) return;
    window.__aioSpeedLock = true;

    let lockEnabled = false;
    let targetSpeed = 1;
    let timer = null;
    let idleTicks = 0;

    function resolveDescriptor(prop) {
        const candidates = [window.HTMLMediaElement && window.HTMLMediaElement.prototype,
            window.HTMLVideoElement && window.HTMLVideoElement.prototype].filter(Boolean);
        for (const proto of candidates) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, prop);
            if (descriptor) return { descriptor, proto };
        }
        return null;
    }

    const rate = resolveDescriptor('playbackRate');
    const origGet = rate ? rate.descriptor.get : function () { return this.playbackRate; };
    const origSet = rate ? rate.descriptor.set : function (value) { this.playbackRate = value; };

    function safeDefine(proto, prop, descriptor) {
        if (!proto) return;
        try {
            Object.defineProperty(proto, prop, Object.assign({ configurable: true, enumerable: true }, descriptor));
        } catch (err) { /* page locked the prototype (rare) */ }
    }

    const mediaProto = window.HTMLMediaElement && window.HTMLMediaElement.prototype;
    safeDefine(mediaProto, 'playbackRate', {
        get() { return origGet.call(this); },
        set(value) {
            if (!lockEnabled) return origSet.call(this, value);
            if (Math.abs(value - targetSpeed) > 0.001) return origSet.call(this, targetSpeed);
            return origSet.call(this, value);
        }
    });

    function setPlayerRate() {
        try {
            const player = window.player || window.xgplayer;
            if (player && typeof player === 'object' && Math.abs(player.playbackRate - targetSpeed) > 0.001) {
                player.playbackRate = targetSpeed;
            }
        } catch (err) { /* player core unavailable */ }

        for (const selector of ['.xgplayer', '.douyin-player', 'xg-video-container']) {
            for (const node of document.querySelectorAll(selector)) {
                const instance = node.player || node.__player;
                if (instance && Math.abs(instance.playbackRate - targetSpeed) > 0.001) {
                    try { instance.playbackRate = targetSpeed; } catch (err) { /* ignore */ }
                }
            }
        }
    }

    function applyToVideos() {
        let count = 0;
        for (const video of document.querySelectorAll('video')) {
            count++;
            try {
                if (Math.abs(origGet.call(video) - targetSpeed) > 0.001) origSet.call(video, targetSpeed);
            } catch (err) { /* not ready yet */ }
        }
        setPlayerRate();
        return count;
    }

    function tick() {
        if (!lockEnabled) return stop();
        const count = applyToVideos();
        // Nothing to defend any more: stop burning a timer on this page.
        idleTicks = count === 0 ? idleTicks + 1 : 0;
        if (idleTicks > 20) stop();
    }

    function start() {
        if (timer) return;
        idleTicks = 0;
        timer = setInterval(tick, 500);
    }

    function stop() {
        if (timer) clearInterval(timer);
        timer = null;
    }

    // One capture listener for the handful of media events worth reacting to.
    const MEDIA_EVENTS = ['playing', 'loadeddata', 'canplay', 'seeked'];
    let lastTimeUpdate = 0;
    document.addEventListener('ratechange', (event) => {
        if (!lockEnabled) return;
        if (event.target && event.target.tagName === 'VIDEO') applyToVideos();
    }, true);
    for (const type of MEDIA_EVENTS) {
        document.addEventListener(type, () => {
            if (!lockEnabled) return;
            const now = Date.now();
            if (now - lastTimeUpdate < 300) return;
            lastTimeUpdate = now;
            applyToVideos();
        }, true);
    }

    function readCommand() {
        const root = document.documentElement;
        const action = root.getAttribute('data-aio-speed-action');
        const value = parseFloat(root.getAttribute('data-aio-speed-value'));
        if (action === 'lock' && isFinite(value) && value > 0) {
            const changed = !lockEnabled || Math.abs(targetSpeed - value) > 0.001;
            lockEnabled = true;
            targetSpeed = value;
            if (changed) applyToVideos();
            start();
        } else if (action === 'unlock' && lockEnabled) {
            lockEnabled = false;
            stop();
            for (const video of document.querySelectorAll('video')) {
                try { origSet.call(video, 1); } catch (err) { /* ignore */ }
            }
            try { if (window.player) window.player.playbackRate = 1; } catch (err) { /* ignore */ }
        }
    }

    new MutationObserver(readCommand).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-aio-speed-action', 'data-aio-speed-value']
    });
    readCommand();
})();
