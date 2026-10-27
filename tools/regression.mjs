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
 *
 * Usage: node tools/regression.mjs [--ext=path] [--port=9444]
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const EXT_DIR = resolve(args.ext || process.cwd());
const PORT = Number(args.port || 9444);
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

function startServer() {
    return new Promise((res) => {
        const server = createServer((req, resp) => {
            resp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            resp.end(PAGE);
        });
        server.listen(0, '127.0.0.1', () => res(server));
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
    const child = spawn('chromium', [
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

    const contexts = new Map();
    cdp.on((msg) => {
        if (msg.method === 'Runtime.executionContextCreated') {
            const list = contexts.get(msg.sessionId) || [];
            list.push(msg.params.context);
            contexts.set(msg.sessionId, list);
        }
    });

    async function openPage(url) {
        const { targetId } = await cdp.send('Target.createTarget', { url });
        const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
        await cdp.send('Runtime.enable', {}, sessionId);
        await wait(1200);
        const list = contexts.get(sessionId) || [];
        const mainCtx = list.find((c) => c.auxData && c.auxData.isDefault);
        const isoCtx = list.find((c) => c.name === 'All in One Extension');
        const evaluate = async (expression, contextId) => {
            const r = await cdp.send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true }, sessionId);
            if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text);
            return r.result && r.result.value;
        };
        return {
            targetId,
            sessionId,
            main: (expr) => evaluate(expr, mainCtx && mainCtx.id),
            iso: (expr) => evaluate(expr, isoCtx && isoCtx.id)
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

    // cleanup state so the profile is not left with test mappings
    await page1.iso('AIO.schema.save({ hotkeyMappings: {} })').catch(() => {});

    cdp.close();
    child.kill('SIGKILL');
    server.close();
    rmSync(userDir, { recursive: true, force: true });

    const failed = results.filter((r) => !r.passed);
    console.log(JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
    process.exit(failed.length ? 1 : 0);
}

main().catch((err) => { console.error('REGRESSION FAILED:', err); process.exit(2); });
