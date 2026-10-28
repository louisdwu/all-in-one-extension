/**
 * Smart speeder — page UI + speed control (ISOLATED world).
 *
 * This file replaces smart_speeder.js + modules/speeder_{styles,ball,menu}.js.
 *
 * Root cause of the old "page freezes on every site" bug: the UI text was
 * rewritten with `textContent` *inside* the MutationObserver callback that
 * watched `document.body`, so every write re-triggered the observer forever and
 * starved the renderer's microtask queue. The rewrite avoids the whole class of
 * bug:
 *   - the UI lives in a shadow root (its mutations never reach the page observer)
 *   - the observer only *scans* for <video> nodes, with rAF coalescing
 *   - text is updated only when the value actually changed
 *   - no interval runs until a video exists and a speed is locked
 */
(function () {
    'use strict';

    const AIO = window.AIO;
    if (!AIO || !AIO.content) return;

    const { log, settings, onChange, isTopFrame, isEditable } = AIO.content;
    const keys = AIO.keys;
    const rules = AIO.rules;
    const dom = AIO.core.dom;
    const storage = AIO.core.storage;
    const speedLog = log('speeder');

    const UI_HOST_ID = 'aio-speed-ui';
    const CSS = `
        :host { all: initial; }
        /* Top-layer popover (AIO.core.dom.topLayer) so the UI stays visible while
           the page is fullscreen; the UA sheet assumes a full-viewport popover,
           so the host is reset to a zero-size anchor. */
        :host([popover]) {
            position: fixed; inset: auto; margin: 0; padding: 0; border: 0;
            width: 0; height: 0; background: transparent; overflow: visible;
            pointer-events: none;
        }
        :host([popover]:not(:popover-open)) { display: none; }
        :host([popover]:popover-open) { display: block; }
        .stage { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; pointer-events: none;
                 font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .ball {
            pointer-events: auto; width: 58px; height: 58px; border-radius: 50%; cursor: pointer;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            color: #fff; background: linear-gradient(135deg, #34c759, #2a9d4a);
            box-shadow: 0 6px 18px rgba(0,0,0,.28); user-select: none;
            transition: transform .16s ease, box-shadow .16s ease;
        }
        .ball:hover { transform: scale(1.06); box-shadow: 0 8px 22px rgba(0,0,0,.34); }
        .ball .value { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
        .ball .label { font-size: 9px; opacity: .85; }
        .ball.idle { background: linear-gradient(135deg, #8e8e93, #636366); }

        .panel {
            pointer-events: auto; position: absolute; right: 0; bottom: 70px; width: 268px;
            background: rgba(28,28,30,.96); color: #f2f2f7; border-radius: 14px; padding: 14px;
            border: 1px solid rgba(255,255,255,.1); box-shadow: 0 18px 44px rgba(0,0,0,.45);
            display: none; backdrop-filter: blur(12px);
        }
        .panel.open { display: block; }
        .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
        .head strong { font-size: 13px; font-weight: 600; }
        .switch { position: relative; width: 38px; height: 20px; border-radius: 20px; background: #48484a; cursor: pointer; transition: background .18s; }
        .switch.on { background: #34c759; }
        .switch i { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform .18s; }
        .switch.on i { transform: translateX(18px); }
        .display { text-align: center; font-size: 30px; font-weight: 700; margin: 4px 0 10px; font-variant-numeric: tabular-nums; }
        .row { display: flex; gap: 8px; }
        button {
            flex: 1; padding: 8px 6px; border: 0; border-radius: 8px; cursor: pointer;
            background: #3a3a3c; color: #f2f2f7; font-size: 12px; font-weight: 600; transition: background .15s;
        }
        button:hover { background: #48484a; }
        button.primary { background: #0a84ff; }
        button.primary:hover { background: #0b74dd; }
        .meta { margin-top: 10px; font-size: 11px; color: #8e8e93; line-height: 1.5; }
        .keys { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; }
        .keys span { display: flex; justify-content: space-between; }
        .keys kbd { background: #2c2c2e; border-radius: 4px; padding: 1px 5px; font-size: 10px; }

        .toast {
            position: fixed; top: 11%; left: 50%; transform: translateX(-50%) scale(.92);
            background: rgba(0,0,0,.78); color: #fff; padding: 12px 26px; border-radius: 12px;
            font-size: 26px; font-weight: 700; opacity: 0; transition: opacity .2s, transform .2s;
            pointer-events: none; font-variant-numeric: tabular-nums;
        }
        .toast.show { opacity: 1; transform: translateX(-50%) scale(1); }
    `;

    const state = {
        settings: null,
        speed: 1,
        active: false,
        videos: new Set(),
        lastAppliedAt: 0,
        ui: null,
        toastTimer: null
    };

    /* ------------------------------- rules ------------------------------- */
    function computeActive(settings) {
        if (!settings.globalEnabled) return false;
        return rules.matches(location.href, settings);
    }

    function clampSpeed(value) {
        const s = state.settings;
        const min = s ? s.speederMinRate : 0.25;
        const max = s ? s.speederMaxRate : 16;
        return Math.min(max, Math.max(min, Math.round(value * 100) / 100));
    }

    /* ------------------------------- video ------------------------------- */
    // Speed changes made by the site itself must be fought; speed changes the
    // user made through the site's own menu must be adopted. The only reliable
    // signal separating them is "did a user gesture just happen?".
    let lastGestureAt = 0;
    for (const type of ['pointerdown', 'keydown', 'touchstart']) {
        window.addEventListener(type, () => { lastGestureAt = Date.now(); }, true);
    }

    const onRateChange = (event) => {
        const video = event.target;
        if (!video || video.tagName !== 'VIDEO') return;
        // A change we made ourselves: ignore.
        if (Date.now() - state.lastAppliedAt < 400) return;
        const rate = video.playbackRate;
        if (!isFinite(rate) || rate <= 0) return;

        const userInitiated = Date.now() - lastGestureAt < 1500;
        if (userInitiated && Math.abs(rate - state.speed) > 0.001) {
            state.speed = clampSpeed(rate);
            updateUI();
            persistSpeed();
            return;
        }
        // Programmatic reset by the player: re-assert our speed.
        if (Math.abs(rate - state.speed) > 0.001) applySpeed();
    };

    function track(video) {
        if (state.videos.has(video)) return;
        state.videos.add(video);
        video.addEventListener('ratechange', onRateChange);
        video.addEventListener('loadedmetadata', () => applySpeed());
        // A frame pays nothing (no storage read, no settings subscription) until
        // it actually contains a video. This matters because the speeder is
        // injected into every iframe on every site.
        boot();
    }

    function scanVideos() {
        for (const video of document.querySelectorAll('video')) track(video);
    }

    const scanSoon = AIO.core.rafThrottle(scanVideos);

    let observer = null;
    function startObserver() {
        if (observer) return;
        observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.tagName === 'VIDEO' || node.querySelector?.('video')) {
                        scanSoon();
                        return;
                    }
                }
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function stopObserver() {
        if (observer) observer.disconnect();
        observer = null;
    }

    /* ------------------------------ applying ------------------------------ */
    /** DOM attribute is the cross-world channel to the MAIN-world injector. */
    function sendLock(action, speed) {
        const root = document.documentElement;
        root.setAttribute('data-aio-speed-action', action);
        root.setAttribute('data-aio-speed-value', String(speed || 0));
    }

    function applySpeed() {
        if (!state.active) return;
        const target = state.speed;
        let touched = false;
        for (const video of state.videos) {
            if (!video.isConnected) {
                state.videos.delete(video);
                continue;
            }
            if (Math.abs(video.playbackRate - target) > 0.001) {
                try {
                    video.playbackRate = target;
                    touched = true;
                } catch (err) {
                    speedLog.debug('rate set failed', err.message);
                }
            }
        }
        if (touched) state.lastAppliedAt = Date.now();
        sendLock('lock', target);
        updateUI();
    }

    function stopAll() {
        sendLock('unlock');
        for (const video of state.videos) {
            try { video.playbackRate = 1; } catch (err) { /* ignore */ }
        }
    }

    /* ------------------------------- actions ------------------------------- */
    function setSpeed(value, { announce = true } = {}) {
        const next = clampSpeed(value);
        if (Math.abs(next - state.speed) < 0.001) return;
        state.speed = next;
        applySpeed();
        if (announce) showToast(next.toFixed(2) + 'x');
        persistSpeed();
    }

    function step(delta) {
        if (!state.active) return;
        setSpeed(state.speed + delta);
    }

    function cyclePreset() {
        if (!state.active) return;
        const presets = AIO.schema.presetList(state.settings);
        if (!presets.length) return;
        if (presets.length === 1) {
            const target = presets[0];
            setSpeed(Math.abs(state.speed - target) < 0.01 ? state.settings.defaultSpeed : target);
            return;
        }
        const index = presets.findIndex((preset) => Math.abs(state.speed - preset) < 0.01);
        setSpeed(presets[(index + 1) % presets.length]);
    }

    function reset() {
        if (!state.settings) return;
        setSpeed(state.settings.defaultSpeed);
    }

    /**
     * Ask the background to remember this speed ('off' | 'global' | 'site').
     *
     * The write is owned by the worker: a page timer would be throttled as soon
     * as the tab goes to the background, so "change speed, switch tab" could lose
     * the value. Sending is debounced only to avoid one message per key repeat.
     */
    const sendPersist = AIO.core.debounce(() => {
        const settings = state.settings;
        if (!settings) return;
        // The worker persists (or not, when memory is off) and always pushes the
        // value to the other frames of this tab.
        AIO.core.post({
            type: 'speeder:remember',
            speed: state.speed,
            mode: settings.speederSpeedMemory,
            hostname: location.hostname
        });
    }, 150);

    /**
     * Adopt a speed pushed by another frame of this tab (see background/features/speeder.js).
     * Only the top frame owns the UI; sub-frames (embedded players) follow it.
     */
    let pendingHostSpeed = null;
    let queriedTabSpeed = false;

    function adoptHostSpeed(value) {
        const next = clampSpeed(value);
        if (!state.settings) {
            pendingHostSpeed = next; // settings not loaded yet: replay after apply()
            return;
        }
        if (!state.active) return;   // this frame is excluded by the URL rules
        if (Math.abs(next - state.speed) < 0.001) return;
        state.speed = next;
        applySpeed();
        updateUI();
    }

    function persistSpeed() {
        if (!state.settings) return;
        sendPersist();
    }

    /** Apply the remembered speed for this hostname (site → global → default). */
    function restoreRememberedSpeed(settings) {
        if (settings.speederSpeedMemory === 'off') return;
        storage.getLocal(['speederSpeeds', 'speederLastSpeed']).then((result) => {
            const resolved = AIO.speedMemory.resolve(result.speederSpeeds, location.hostname, {
                mode: settings.speederSpeedMemory,
                defaultSpeed: settings.defaultSpeed,
                globalSpeed: result.speederLastSpeed
            });
            if (Math.abs(resolved - state.speed) < 0.001) return;
            state.speed = clampSpeed(resolved);
            applySpeed();
        });
    }

    /* --------------------------------- UI --------------------------------- */
    function ensureUI() {
        if (state.ui && state.ui.host.isConnected) return state.ui;
        const { host, root } = dom.shadowHost(UI_HOST_ID, CSS);
        dom.topLayer(host);
        const stage = document.createElement('div');
        stage.className = 'stage';

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="head"><strong>视频速度</strong><div class="switch" data-role="switch"><i></i></div></div>
            <div class="display" data-role="display">1.00x</div>
            <div class="row">
                <button data-role="down">− 慢一点</button>
                <button data-role="up">+ 快一点</button>
            </div>
            <div class="row" style="margin-top:8px">
                <button class="primary" data-role="preset">切换预设</button>
                <button data-role="reset">复位</button>
            </div>
            <div class="row" style="margin-top:8px">
                <button data-role="options">设置</button>
                <button data-role="hide">隐藏浮球</button>
            </div>
            <div class="meta">
                <div data-role="status"></div>
                <div class="keys" data-role="keys"></div>
            </div>`;

        const ball = document.createElement('div');
        ball.className = 'ball';
        ball.innerHTML = '<div class="value" data-role="ball-value">1.00x</div><div class="label">速度</div>';

        const toast = document.createElement('div');
        toast.className = 'toast';

        stage.append(panel, ball);
        root.append(stage, toast);

        const ui = { host, root, stage, panel, ball, toast };
        state.ui = ui;

        ball.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            panel.classList.toggle('open');
        });

        panel.addEventListener('click', (event) => {
            const role = event.target.closest('[data-role]')?.dataset.role;
            if (role) handlePanelAction(role);
            event.stopPropagation();
        });

        document.addEventListener('click', (event) => {
            if (!panel.classList.contains('open')) return;
            const path = event.composedPath ? event.composedPath() : [];
            if (!path.includes(host)) panel.classList.remove('open');
        }, true);

        return ui;
    }

    function handlePanelAction(role) {
        switch (role) {
            case 'up': step(state.settings.speederStep); break;
            case 'down': step(-state.settings.speederStep); break;
            case 'preset': cyclePreset(); break;
            case 'reset': reset(); break;
            case 'options': AIO.core.sendMessage({ type: 'speeder:openOptions' }); break;
            case 'hide':
                AIO.schema.save({ hideFloatingBall: true });
                break;
            case 'switch':
                AIO.schema.save({ globalEnabled: !state.settings.globalEnabled });
                break;
            default: break;
        }
    }

    function updateUI() {
        if (!isTopFrame) return;
        const ui = state.ui;
        if (!ui) return;
        const value = state.speed.toFixed(2) + 'x';
        const ballValue = ui.ball.querySelector('[data-role="ball-value"]');
        if (ballValue && ballValue.textContent !== value) ballValue.textContent = value;
        const display = ui.panel.querySelector('[data-role="display"]');
        if (display && display.textContent !== value) display.textContent = value;

        ui.ball.classList.toggle('idle', !state.active);
        const toggle = ui.panel.querySelector('[data-role="switch"]');
        if (toggle) toggle.classList.toggle('on', !!(state.settings && state.settings.globalEnabled));

        const status = ui.panel.querySelector('[data-role="status"]');
        if (status) {
            const text = state.active ? '当前页面已接管倍速' : '当前页面未启用（检查规则/开关）';
            if (status.textContent !== text) status.textContent = text;
        }

        const keyBox = ui.panel.querySelector('[data-role="keys"]');
        if (keyBox && state.settings) {
            const rows = Object.entries(state.settings.shortcuts).map(([action, combo]) => {
                const label = { increaseSpeed: '加速', decreaseSpeed: '减速', presetSpeed: '预设' }[action] || action;
                return '<span><em style="font-style:normal;color:#c7c7cc">' + label + '</em><kbd>' + AIO.keys.display(combo) + '</kbd></span>';
            });
            const html = rows.join('');
            if (keyBox.dataset.html !== html) {
                keyBox.dataset.html = html;
                keyBox.innerHTML = html;
            }
        }
    }

    function showToast(text) {
        if (!isTopFrame) return;
        const ui = state.ui;
        if (!ui) {
            // Floating ball hidden: fall back to the page-level toast.
            AIO.content.toast(text, 'info', 1200);
            return;
        }
        ui.toast.textContent = text;
        ui.toast.classList.add('show');
        clearTimeout(state.toastTimer);
        state.toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 1200);
    }

    function destroyUI() {
        if (!state.ui) return;
        state.ui.host.remove();
        state.ui = null;
    }

    function refreshUI() {
        if (!isTopFrame) return;
        if (!state.settings || !state.settings.globalEnabled || state.settings.hideFloatingBall) {
            destroyUI();
            return;
        }
        const ui = ensureUI();
        dom.topLayer(ui.host);
        updateUI();
    }

    /* ----------------------------- fullscreen ----------------------------- */
    /**
     * Fallback for browsers without the Popover API: move the UI host into the
     * fullscreen element so it is not painted behind it.
     *
     * A fullscreened <video> never paints its children (they are fallback
     * content), so there the host stays in <body>; the toast is then invisible,
     * which is exactly what the top-layer overlay above fixes on modern Chrome.
     */
    document.addEventListener('fullscreenchange', () => {
        if (!state.ui || state.ui.host.hasAttribute('popover')) return;
        const target = document.fullscreenElement;
        const parent = target && target.tagName !== 'VIDEO'
            ? target
            : (document.body || document.documentElement);
        if (state.ui.host.parentNode !== parent) parent.appendChild(state.ui.host);
    });

    /* -------------------------------- boot -------------------------------- */
    function apply(settings) {
        const wasActive = state.active;
        state.settings = settings;
        state.active = computeActive(settings);

        if (!state.active) {
            if (wasActive) stopAll();
            stopObserver();
            refreshUI();
            return;
        }

        startObserver();
        scanVideos();
        if (!wasActive) {
            state.speed = clampSpeed(settings.defaultSpeed);
            refreshUI();
            restoreRememberedSpeed(settings);
        }
        // A frame that was scrolled into view before its settings arrived.
        if (pendingHostSpeed !== null) {
            const queued = pendingHostSpeed;
            pendingHostSpeed = null;
            if (Math.abs(queued - state.speed) > 0.001) state.speed = queued;
        }
        applySpeed();
        refreshUI();

        // Sub-frames have no UI: adopt whatever the top frame is using.
        if (!isTopFrame && !queriedTabSpeed) {
            queriedTabSpeed = true;
            AIO.core.sendMessage({ type: 'speeder:tabSpeed' }).then((result) => {
                if (result && typeof result.speed === 'number') adoptHostSpeed(result.speed);
            });
        }
    }

    /**
     * Boot once, and only when this frame has something to control.
     * Loading settings and subscribing to changes are the two costs worth
     * deferring; DOM scanning below is allocation-free until a video shows up.
     */
    let bootPromise = null;
    function boot() {
        if (bootPromise) return bootPromise;
        bootPromise = settings().then((loaded) => {
            apply(loaded);
            onChange(apply);
            return loaded;
        });
        return bootPromise;
    }

    // Cheap probe: one observer, no storage access, until a <video> appears.
    startObserver();
    scanVideos();

    /* ------------------------------ keyboard ------------------------------ */
    window.addEventListener('keydown', (event) => {
        if (!state.active || event.defaultPrevented || isEditable(event.target)) return;
        if (event.altKey || event.metaKey) { /* combos may include them; still matched below */ }
        const action = keys.matchAction(event, state.settings.shortcuts);
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        if (action === 'increaseSpeed') step(state.settings.speederStep);
        else if (action === 'decreaseSpeed') step(-state.settings.speederStep);
        else if (action === 'presetSpeed') cyclePreset();
    }, true);

    /* ------------------------------ messages ------------------------------ */
    AIO.core.onMessage((message) => {
        if (!message) return undefined;
        if (message.type === 'speeder:command') {
            // The frame may still be dormant (no video seen yet): boot first.
            return boot().then(() => {
                const action = message.action;
                const stepSize = state.settings ? state.settings.speederStep : 0.25;
                if (action === 'increase') step(stepSize);
                else if (action === 'decrease') step(-stepSize);
                else if (action === 'preset') cyclePreset();
                else if (action === 'reset') reset();
                return { ok: true, speed: state.speed };
            });
        }
        if (message.type === 'speeder:applySpeed') {
            adoptHostSpeed(message.speed);
            return { ok: true, speed: state.speed };
        }
        if (message.type === 'speeder:getSpeed' || message.action === 'getSpeed') {
            return { ok: true, speed: state.speed, active: state.active, dormant: !bootPromise };
        }
        if (message.type === 'aio:toast') {
            if (isTopFrame) AIO.content.toast(message.message, message.level || 'info');
            return { ok: true };
        }
        if (message.type === 'aio:settingsChanged' || message.type === 'speeder:settingsChanged') {
            return { ok: true }; // schema.subscribe already refreshed the settings
        }
        return undefined;
    });

    speedLog.debug('ready', { active: state.active });
})();
