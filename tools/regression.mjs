#!/usr/bin/env node
/**
 * Behavioural regression tests (Chromium + CDP).
 *
 * The smoke test answers "does anything throw?"; this one answers
 * "do the three trickiest features still actually work?":
 *
 *   A. tab switcher: right-mouse-down + wheel opens the overlay, mouseup closes it
 *   B. speeder gating: turning the switch off releases the page's own playback rate
 *      and removes the UI; turning it back on re-locks
 *   C. hotkey remap: pressing the mapped key is delivered to the page as the
 *      original key, and the original key is swallowed
 *   D. per-site speed memory: a speed chosen on a site is stored and restored
 *      when the same site is opened again
 *
 * Usage: node tools/regression.mjs [--ext=path] [--port=9444]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const EXT_DIR = resolve(args.ext || process.cwd());
const PORT = Number(args.port || 9444);
const CHROME_BIN = process.env.AIO_CHROME || 'chromium';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error('[regression]', ...a);

const PAGE = [
    '<!doctype html><html><head><meta charset="utf-8"><title>AIO regression page</title></head><body>',
    '<h1>regression</h1><video id="v1" width="320" height="180"></video>',
    '<script>',
    '  window.__keys = [];',
    '  document.addEventListener("keydown", function (e) { window.__keys.push(e.key); });',
    '  var v = document.getElementById("v1");',
    '  v.playbackRate = 1.75;',
    '  setInterval(function () { try { v.playbackRate = 1.75; } catch (e) {} }, 150);',
    '</script></body></html>'
].join('\n');

const FRAME_PAGE = [
    '<!doctype html><html><head><meta charset="utf-8"><title>AIO frame</title></head><body>',
    '<video id="v1" width="320" height="180"></video>',
    '</body></html>'
].join('\n');

// Stand-in for the bilibili player's subtitle menu. The extension's bilibili
// content script only runs on *.bilibili.com, so the harness loads the script
// itself after stubbing the AIO runtime it expects.
const BILI_PAGE = [
    '<!doctype html><html><head><meta charset="utf-8"><title>AIO bili player stub</title></head><body>',
    '<div class="bpx-player-ctrl-btn bpx-player-ctrl-subtitle">字幕</div>',
    '<div class="bpx-player-ctrl-subtitle-menu">',
    '  <ul>',
    '    <li class="bpx-player-ctrl-subtitle-language-item" data-lan="zh-Hans">中文（中国）</li>',
    '    <li class="bpx-player-ctrl-subtitle-language-item" data-lan="ai-zh">中文（自动生成）</li>',
    '  </ul>',
    '  <div class="bpx-player-ctrl-subtitle-close-switch bpx-state-active">关闭字幕</div>',
    '</div>',
    '<script>',
    '(function () {',
    '  var menu = document.querySelector(".bpx-player-ctrl-subtitle-menu");',
    '  var button = document.querySelector(".bpx-player-ctrl-subtitle");',
    '  var items = Array.prototype.slice.call(menu.querySelectorAll(".bpx-player-ctrl-subtitle-language-item"));',
    '  var closeSwitch = menu.querySelector(".bpx-player-ctrl-subtitle-close-switch");',
    '  window.__sub = { on: false, lan: null };',
    '  window.__subClicks = 0;',
    '  window.__setSub = function (lan) {',
    '    window.__sub.on = true; window.__sub.lan = lan;',
    '    items.forEach(function (item) { item.classList.toggle("bpx-state-active", item.getAttribute("data-lan") === lan); });',
    '    closeSwitch.classList.remove("bpx-state-active");',
    '  };',
    '  button.addEventListener("mouseenter", function () { menu.style.display = "block"; });',
    '  button.addEventListener("mouseleave", function () { menu.style.display = "none"; });',
    '  items.forEach(function (item) {',
    '    item.addEventListener("click", function () { window.__subClicks += 1; window.__setSub(item.getAttribute("data-lan")); });',
    '  });',
    '  closeSwitch.addEventListener("click", function () {',
    '    window.__subClicks += 1; window.__sub.on = false; window.__sub.lan = null;',
    '    items.forEach(function (item) { item.classList.remove("bpx-state-active"); });',
    '    closeSwitch.classList.add("bpx-state-active");',
    '  });',
    '  if (location.search.indexOf("on=1") !== -1) window.__setSub("ai-zh");',
    '  menu.style.display = "none";',
    '})();',
    '<' + '/script>',
    '</body></html>'
].join('\n');

function startServer() {
    return new Promise((res) => {
        const server = createServer((req, resp) => {
            resp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            // /frame is served under a *different* hostname (localhost) so the
            // per-site speed memory cannot accidentally satisfy the assertion.
            resp.end(req.url.startsWith('/frame') ? FRAME_PAGE : req.url.startsWith('/bili') ? BILI_PAGE : PAGE);
        });
        // Bind on all interfaces so both 127.0.0.1 and localhost resolve.
        server.listen(0, () => res(server));
    });
}

class Cdp {
    constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.handlers = []; }
    async connect() {
        this.ws = new WebSocket(this.url);
        await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
        this.ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { res, rej, timer } = this.pending.get(msg.id);
                clearTimeout(timer);
                this.pending.delete(msg.id);
                if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
            } else if (msg.method) {
                for (const h of this.handlers) h(msg);
            }
        };
    }
    send(method, params = {}, sessionId) {
        const id = ++this.id;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((res, rej) => {
            const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 15000);
            this.pending.set(id, { res, rej, timer });
        });
    }
    on(fn) { this.handlers.push(fn); }
    close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

const results = [];
function check(name, passed, detail) {
    results.push({ name, passed, detail });
    log((passed ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}

async function main() {
    const userDir = mkdtempSync(join(tmpdir(), 'aio-reg-'));
    const server = await startServer();
    const base = 'http://127.0.0.1:' + server.address().port + '/';
    const child = spawn(CHROME_BIN, [
        '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
        '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-extensions-except=' + EXT_DIR, '--load-extension=' + EXT_DIR, 'about:blank'
    ], { stdio: 'ignore' });

    let version = null;
    for (let i = 0; i < 80; i++) {
        try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(100); }
    }
    if (!version) throw new Error('chromium did not expose a debugging port');

    const cdp = new Cdp(version.webSocketDebuggerUrl);
    await cdp.connect();

    // Live execution contexts, keyed by the session they belong to.
    // Cross-site iframes run in a separate renderer process (OOPIF) whose
    // contexts are only reported on an auto-attached child session, so the
    // registry is global and each entry remembers its own sessionId.
    // Destroyed contexts must be pruned, otherwise a navigation leaves a stale
    // id behind and the next evaluate fails with "Cannot find context".
    const contexts = new Map();      // sessionId -> context[]
    const allContexts = [];          // { sessionId, context }

    cdp.on((msg) => {
        if (msg.method === 'Target.attachedToTarget') {
            const childSession = msg.params.sessionId;
            // Enable the domains we need on the OOPIF session.
            cdp.send('Runtime.enable', {}, childSession).catch(() => {});
            cdp.send('Page.enable', {}, childSession).catch(() => {});
            return;
        }
        if (msg.method === 'Runtime.executionContextCreated') {
            const list = contexts.get(msg.sessionId) || [];
            list.push(msg.params.context);
            contexts.set(msg.sessionId, list);
            allContexts.push({ sessionId: msg.sessionId, context: msg.params.context });
        } else if (msg.method === 'Runtime.executionContextDestroyed') {
            const id = msg.params.executionContextId;
            contexts.set(msg.sessionId, (contexts.get(msg.sessionId) || []).filter((c) => c.id !== id));
            for (let i = allContexts.length - 1; i >= 0; i--) {
                if (allContexts[i].sessionId === msg.sessionId && allContexts[i].context.id === id) allContexts.splice(i, 1);
            }
        } else if (msg.method === 'Runtime.executionContextsCleared') {
            contexts.set(msg.sessionId, []);
            for (let i = allContexts.length - 1; i >= 0; i--) {
                if (allContexts[i].sessionId === msg.sessionId) allContexts.splice(i, 1);
            }
        }
    });

    async function openPage(url) {
        const { targetId } = await cdp.send('Target.createTarget', { url });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Runtime.enable', {}, sessionId);
        // Auto-attach so out-of-process iframes expose their contexts.
        await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)
            .catch(() => {});
        await wait(1200);
        /** Resolve the wanted world *now* — contexts change across navigations. */
        const evaluate = async (expression, world) => {
            const list = contexts.get(sessionId) || [];
            const context = world === 'iso'
                ? list.filter((c) => c.name === 'All in One Extension').pop()
                : list.filter((c) => c.auxData && c.auxData.isDefault).pop();
            // userGesture: the fullscreen assertion below needs an activation.
            const params = { expression, returnByValue: true, awaitPromise: true, userGesture: true };
            if (context) params.contextId = context.id;

            let result;
            try {
                result = await cdp.send('Runtime.evaluate', params, sessionId);
            } catch (err) {
                if (!params.contextId) throw err;
                // The context vanished between lookup and evaluation: use the
                // session's default context instead of failing the whole run.
                delete params.contextId;
                result = await cdp.send('Runtime.evaluate', params, sessionId);
            }
            if (result.exceptionDetails) {
                throw new Error((result.exceptionDetails.exception || {}).description || result.exceptionDetails.text);
            }
            return result.result && result.result.value;
        };
        /**
         * Evaluate inside a sub-frame.
         *
         * The frame's main-world context reports the real page origin, while its
         * isolated (content-script) context reports the *extension* origin. So:
         * find the main context by origin, take its frameId, then pick the
         * isolated context with the same frameId. Cross-site frames live in
         * another process; their contexts arrive on an auto-attached session,
         * which is why the registry is global.
         */
        const evaluateInFrame = async (urlPrefix, world, expression) => {
            const mainEntry = allContexts.filter((entry) => {
                const aux = entry.context.auxData || {};
                return !!aux.isDefault && (entry.context.origin || '').startsWith(urlPrefix);
            }).pop();
            if (!mainEntry) {
                const seen = allContexts.map((entry) => (entry.context.origin || '?') + '/' + (entry.context.name || 'main')).join(', ');
                throw new Error('no frame with origin ' + urlPrefix + ' (have: ' + seen + ')');
            }
            let match = mainEntry;
            if (world === 'iso') {
                const frameId = mainEntry.context.auxData.frameId;
                match = allContexts.filter((entry) => {
                    const aux = entry.context.auxData || {};
                    return aux.frameId === frameId && entry.context.name === 'All in One Extension';
                }).pop();
                if (!match) {
                    throw new Error('no isolated context in frame ' + urlPrefix + ' (content script not injected?)');
                }
            }
            const result = await cdp.send('Runtime.evaluate', {
                expression, contextId: match.context.id, returnByValue: true, awaitPromise: true
            }, match.sessionId);
            if (result.exceptionDetails) {
                throw new Error((result.exceptionDetails.exception || {}).description || result.exceptionDetails.text);
            }
            return result.result && result.result.value;
        };

        return {
            targetId,
            sessionId,
            main: (expr) => evaluate(expr, 'main'),
            iso: (expr) => evaluate(expr, 'iso'),
            frame: evaluateInFrame
        };
    }

    // ---------- A. tab switcher ----------
    const page1 = await openPage(base);
    const page2 = await openPage(base + '?two');
    await wait(800);

    const tabCount = await page1.iso('AIO.core.sendMessage({ type: "tabs:list" }).then(r => (r && r.tabs ? r.tabs.length : -1))');
    check('tabs:list returns the window tabs', typeof tabCount === 'number' && tabCount >= 2, 'count=' + tabCount);

    await page2.main('window.__keys = window.__keys || []');
    // Bring page1 to front: the switcher needs input events on the focused page.
    await cdp.send('Target.activateTarget', { targetId: page1.targetId });
    await page1.main([
        'window.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true, cancelable: true }));',
        'window.dispatchEvent(new WheelEvent("wheel", { deltaY: 120, bubbles: true, cancelable: true }));'
    ].join('\n'));
    await wait(700);
    const hostOpen = await page1.main('!!document.getElementById("aio-tab-switcher-host")');
    check('right-click + wheel opens the switcher overlay', hostOpen === true, 'host=' + hostOpen);

    const rows = await page1.main('(function(){var h=document.getElementById("aio-tab-switcher-host");return h&&h.shadowRoot?h.shadowRoot.querySelectorAll(".row").length:0;})()');
    check('switcher renders one row per tab', rows >= 2, 'rows=' + rows);

    await page1.main('window.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true, cancelable: true }))');
    await wait(500);
    const hostClosed = await page1.main('!!document.getElementById("aio-tab-switcher-host")');
    check('mouseup closes the switcher overlay', hostClosed === false, 'host=' + hostClosed);

    // ---------- B. speeder gating ----------
    const locked = await page1.main('({ rate: document.getElementById("v1").playbackRate, ui: !!document.getElementById("aio-speed-ui") })');
    check('speeder locks the rate by default', locked.rate === 1 && locked.ui === true, JSON.stringify(locked));

    await page1.iso('AIO.schema.save({ globalEnabled: false })');
    await wait(1200);
    const released = await page1.main('({ rate: document.getElementById("v1").playbackRate, ui: !!document.getElementById("aio-speed-ui") })');
    check('disabling the speeder releases page control', released.rate > 1.2 && released.ui === false, JSON.stringify(released));

    await page1.iso('AIO.schema.save({ globalEnabled: true })');
    await wait(1200);
    const relocked = await page1.main('({ rate: document.getElementById("v1").playbackRate, ui: !!document.getElementById("aio-speed-ui") })');
    check('re-enabling the speeder re-locks the rate', relocked.rate === 1 && relocked.ui === true, JSON.stringify(relocked));

    // ---------- C. hotkey remap ----------
    const mappingPayload = await page1.iso([
        'AIO.schema.save({ hotkeyMappings: { "127.0.0.1": { F: "H" } }, enabledSites: {} })',
        '  .then(() => new Promise(r => setTimeout(r, 400)))',
        '  .then(() => document.documentElement.getAttribute("data-aio-hotkeys"))'
    ].join(''));
    check('hotkey gate publishes the mapping to the MAIN world', typeof mappingPayload === 'string' && mappingPayload.includes('"F":"H"'), String(mappingPayload));

    await wait(400);
    const remap = await page1.main([
        '(function(){',
        '  window.__keys = [];',
        '  document.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true, cancelable: true }));',
        '  var mapped = window.__keys.slice();',
        '  window.__keys = [];',
        '  document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", bubbles: true, cancelable: true }));',
        '  var blocked = window.__keys.slice();',
        '  return { mapped: mapped, blocked: blocked };',
        '})()'
    ].join('\n'));
    check('mapped key is delivered as the original key', Array.isArray(remap.mapped) && remap.mapped.join(',') === 'f', JSON.stringify(remap));
    check('original key is swallowed', Array.isArray(remap.blocked) && remap.blocked.length === 0, JSON.stringify(remap));

    // ---------- D. per-site speed memory ----------
    const swTarget = (await cdp.send('Target.getTargets')).targetInfos
        .find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
    const extId = swTarget ? new URL(swTarget.url).host : null;

    log('D: configuring speed memory');
    await page1.iso('AIO.schema.save({ speederSpeedMemory: "site", defaultSpeed: 1, presetSpeed: "2.0", globalEnabled: true })');
    await wait(600);

    log('D: resolving tab id');
    const tabId = await page1.iso('AIO.core.sendMessage({ type: "tabs:list" }).then(function (r) { var t = (r.tabs || []).filter(function (x) { return x.url.indexOf(location.origin) === 0; })[0]; return t ? t.id : -1; })');
    log('D: tabId=' + tabId);

    if (extId && typeof tabId === 'number' && tabId > 0) {
        log('D: opening options page');
        const ext = await openPage('chrome-extension://' + extId + '/ui/options.html');
        log('D: sending speeder:command');
        // Drive the real command channel: options page -> background/tab -> content script.
        const commandResult = await ext.main('chrome.tabs.sendMessage(' + tabId + ', { type: "speeder:command", action: "preset" })');
        check('speed command reaches the content script', !!commandResult && commandResult.ok === true && commandResult.speed === 2, JSON.stringify(commandResult));

        await wait(2200); // persist debounce is 800ms; leave headroom for worker wake-ups
        const store = await page1.iso('AIO.core.storage.getLocal(["speederSpeeds"])');
        check('chosen speed is remembered for the hostname', !!store && store.speederSpeeds && store.speederSpeeds['127.0.0.1'] === 2, JSON.stringify(store));

        log('D: opening a fresh tab for the same site');
        const page3 = await openPage(base + '?three');
        await wait(1600);
        const restored = await page3.main('document.getElementById("v1").playbackRate');
        check('remembered speed is restored on the next visit', restored === 2, 'rate=' + restored);
    } else {
        check('speed command reaches the content script', false, 'could not resolve extension id / tab id');
    }


    // ---------- E. sub-frame follows the top frame ----------
    // Created *after* the top frame picked 2x: the frame cannot rely on the
    // broadcast, it has to ask the worker for the tab speed on init.
    const frameOrigin = 'http://localhost:' + server.address().port;
    log('E: injecting a late iframe from ' + frameOrigin);
    await page1.main([
        'var f = document.createElement("iframe");',
        'f.id = "embedded";',
        'f.width = 320; f.height = 180;',
        'f.src = "' + frameOrigin + '/frame?late=1";',
        'document.body.appendChild(f);',
        'true'
    ].join('\n'));
    await wait(2500);

    const frameSpeed = await page1.frame(frameOrigin, 'iso', 'AIO.core.sendMessage({ type: "speeder:tabSpeed" })');
    check('sub-frame can read the tab speed', !!frameSpeed && frameSpeed.speed === 2, JSON.stringify(frameSpeed));

    const frameRate = await page1.frame(frameOrigin, 'main', 'document.getElementById("v1").playbackRate');
    check('late iframe adopts the top-frame speed', frameRate === 2, 'rate=' + frameRate);

    // ---------- F. bilibili subtitle switch ----------
    // The bilibili content script only matches *.bilibili.com, so run it on the
    // stub page against a minimal AIO runtime. This covers the two behaviours
    // that used to be conflated: "off" must actually close restored subtitles,
    // "on" must prefer the official Chinese track.
    const biliUiSource = readFileSync(join(EXT_DIR, 'content/bilibili/ui.js'), 'utf8');
    const biliBootstrap = (autoSubtitle) => [
        'window.__aioSettings = { biliEnabled: true, biliAutoSubtitle: ' + autoSubtitle + ', bilibiliSubtitles: { subtitleHotkey: "s" } };',
        'window.AIO = window.AIO || {};',
        'window.AIO.core = {',
        '  log: function () { var noop = function () {}; return { debug: noop, info: noop, warn: noop, error: noop }; },',
        '  rafThrottle: function () { return function () {}; },',
        '  onMessage: function () { return function () {}; },',
        '  dom: { waitFor: function (selector) { return Promise.resolve(document.querySelector(selector)); } }',
        '};',
        'window.AIO.content = {',
        '  log: window.AIO.core.log,',
        '  settings: function () { return Promise.resolve(window.__aioSettings); },',
        '  onChange: function (callback) { window.__aioOnChange = callback; },',
        '  isTopFrame: true,',
        '  isEditable: function () { return false; }',
        '};',
        'true'
    ].join('\n');

    log('F: auto-subtitle off must close restored subtitles');
    const biliOff = await openPage(base + 'bili?on=1');
    await biliOff.main(biliBootstrap(false));
    await biliOff.main(biliUiSource);
    await wait(2600);
    const closedState = await biliOff.main('({ on: window.__sub.on, lan: window.__sub.lan, clicks: window.__subClicks })');
    check('auto-subtitle off closes the subtitles bilibili restored', closedState.on === false && closedState.clicks >= 1, JSON.stringify(closedState));

    log('F: auto-subtitle on must prefer the official track');
    const biliOn = await openPage(base + 'bili');
    await biliOn.main(biliBootstrap(true));
    await biliOn.main(biliUiSource);
    await wait(2600);
    const picked = await biliOn.main('({ on: window.__sub.on, lan: window.__sub.lan })');
    check('auto-subtitle on prefers the official Chinese track', picked.on === true && picked.lan === 'zh-Hans', JSON.stringify(picked));

    await biliOn.main('window.__aioOnChange({ biliEnabled: true, biliAutoSubtitle: false, bilibiliSubtitles: { subtitleHotkey: "s" } })');
    await wait(1600);
    const toggledOff = await biliOn.main('({ on: window.__sub.on, lan: window.__sub.lan })');
    check('turning the option off closes subtitles right away', toggledOff.on === false, JSON.stringify(toggledOff));

    // ---------- G. speed toast stays visible in fullscreen ----------
    // Regression: a page that fullscreens the <video> element itself never paints
    // the video's children (they are fallback content), so the old "move the UI
    // host into the fullscreen element" trick made the toast invisible on every
    // native player. The overlay must live in the top layer instead.
    log('G: fullscreen speed toast');
    // requestFullscreen only works in the active document: earlier cases opened
    // other tabs, so bring this one back to the front first.
    await cdp.send('Target.activateTarget', { targetId: page1.targetId });
    await wait(600);
    const fsTarget = await page1.main('document.getElementById("v1").requestFullscreen().then(function () { return document.fullscreenElement ? document.fullscreenElement.tagName : null; }).catch(function (e) { return "err:" + e.message; })');
    await wait(700);
    await page1.main('window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))');
    await wait(400);
    const toastState = await page1.main([
        '(function () {',
        '  var ui = document.getElementById("aio-speed-ui");',
        '  var toast = ui && ui.shadowRoot ? ui.shadowRoot.querySelector(".toast") : null;',
        '  var rect = toast ? toast.getBoundingClientRect() : null;',
        '  return {',
        '    fullscreen: document.fullscreenElement ? document.fullscreenElement.tagName : null,',
        '    uiParent: ui && ui.parentElement ? ui.parentElement.tagName : null,',
        '    shown: toast ? toast.classList.contains("show") : false,',
        '    width: rect ? Math.round(rect.width) : 0,',
        '    height: rect ? Math.round(rect.height) : 0,',
        '    text: toast ? toast.textContent : null',
        '  };',
        '})()'
    ].join('\n'));
    check('speed toast stays visible while the video element is fullscreen',
        fsTarget === 'VIDEO' && toastState.fullscreen === 'VIDEO' && toastState.shown === true &&
        toastState.width > 0 && toastState.height > 0,
        JSON.stringify(toastState));
    await page1.main('document.exitFullscreen && document.exitFullscreen()').catch(() => {});
    await wait(400);

    // ---------- H. bilibili 1080P loop must yield to the server cap ----------
    // bilibili advertises 1080P in accept_quality but only hands out 480P
    // renditions to logged-out clients. Asking again every 2s only produced a
    // "清晰度不可用" toast loop, so the injector must ask once, notice the
    // downgrade and stop — with a hint pointing at the account setting.
    log('H: server-side quality cap must stop the 1080P loop');
    const biliInject = await openPage(base + 'bili?inject=1');
    await biliInject.main([
        'window.__qualityCalls = [];',
        'window.player = {',
        '  requestQuality: function (q) { window.__qualityCalls.push(q); },',
        '  getSupportedQualityList: function () { return [80, 64, 32, 16]; },',
        '  getQuality: function () { return { nowQ: 64 }; }',
        '};',
        'window.__playurlBody = JSON.stringify({ code: 0, data: {',
        '  quality: 64, accept_quality: [112, 80, 64, 32, 16],',
        '  dash: { video: [{ id: 32, height: 480 }, { id: 16, height: 360 }] }',
        '} });',
        'var realFetch = window.fetch.bind(window);',
        'window.fetch = function (input, init) {',
        '  var url = typeof input === "string" ? input : (input && input.url) || "";',
        '  if (url.indexOf("/x/player/wbi/playurl") >= 0) {',
        '    return Promise.resolve(new Response(window.__playurlBody, { status: 200, headers: { "content-type": "application/json" } }));',
        '  }',
        '  return realFetch(input, init);',
        '};',
        'document.documentElement.setAttribute("data-aio-bili-login", "no");',
        'true'
    ].join('\n'));
    await biliInject.main(readFileSync(join(EXT_DIR, 'libs/md5.js'), 'utf8'));
    await biliInject.main(readFileSync(join(EXT_DIR, 'libs/wbi.js'), 'utf8'));
    await biliInject.main(readFileSync(join(EXT_DIR, 'content/bilibili/inject.js'), 'utf8'));
    await wait(3000);
    const firstRound = await biliInject.main('window.__qualityCalls.slice()');
    check('logged-out page still asks for 1080P once', firstRound.indexOf(80) >= 0, JSON.stringify(firstRound));

    await biliInject.main('fetch("https://api.bilibili.com/x/player/wbi/playurl?avid=1&cid=1&qn=80&fnval=4048").then(function () { return true; })');
    await wait(600);
    const settled = await biliInject.main('window.__qualityCalls.length');
    await wait(4500); // more than two 2s ticks
    const capped = await biliInject.main('({ calls: window.__qualityCalls.length, hint: document.documentElement.getAttribute("data-aio-bili-hint") })');
    check('a server-side downgrade stops the repeated 1080P requests', settled === capped.calls,
        'before=' + settled + ' after=' + capped.calls);
    check('the cap is explained to the user', !!capped.hint && capped.hint.indexOf('480P') >= 0, capped.hint || 'no hint');

    // cleanup state so the profile is not left with test mappings/speeds
    await page1.iso('AIO.schema.save({ hotkeyMappings: {}, speederSpeedMemory: "site" })').catch(() => {});
    await page1.iso('AIO.core.storage.setLocal({ speederSpeeds: {} })').catch(() => {});

    cdp.close();
    child.kill('SIGKILL');
    server.close();
    rmSync(userDir, { recursive: true, force: true });

    const failed = results.filter((r) => !r.passed);
    console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error('REGRESSION FAILED:', err); process.exit(2); });
