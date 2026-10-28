import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Measures the extension's per-frame overhead.
 *
 * Loads a page with N same-origin iframes (no videos) twice — once without the
 * extension, once with it — and compares renderer main-thread time. Use it
 * before/after adding anything that is injected into every frame.
 *
 * Usage: node tools/perf.mjs [--frames=20] [--runs=3] [--port=9471]
 * Requires a local Chromium/Chrome (override with AIO_CHROME).
 */
const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
}));
const EXT_DIR = resolve(args.ext || process.cwd());
const PORT = Number(args.port || 9471);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FRAMES = Number(args.frames || 20);
const RUNS = Number(args.runs || 3);

const FRAME_HTML = '<!doctype html><html><body><p>frame</p></body></html>';
function pageHtml() {
    let frames = '';
    for (let i = 0; i < FRAMES; i++) frames += '<iframe src="/frame?' + i + '" width="100" height="60"></iframe>';
    return '<!doctype html><html><head><title>perf</title></head><body><h1>perf</h1>' + frames + '</body></html>';
}

function startServer() {
    return new Promise((res) => {
        const server = createServer((req, resp) => {
            resp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            resp.end(req.url.startsWith('/frame') ? FRAME_HTML : pageHtml());
        });
        server.listen(0, '127.0.0.1', () => res(server));
    });
}

class Cdp {
    constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
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
            }
        };
    }
    send(method, params = {}, sessionId) {
        const id = ++this.id;
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        this.ws.send(JSON.stringify(payload));
        return new Promise((res, rej) => {
            const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('timeout ' + method)); }, 20000);
            this.pending.set(id, { res, rej, timer });
        });
    }
    close() { try { this.ws.close(); } catch (e) {} }
}

async function runOnce(withExtension) {
    const userDir = mkdtempSync(join(tmpdir(), 'aio-perf-'));
    const server = await startServer();
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    const args = [
        '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
        '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'
    ];
    if (withExtension) args.splice(args.length - 1, 0, '--disable-extensions-except=' + EXT_DIR, '--load-extension=' + EXT_DIR);
    const child = spawn(process.env.AIO_CHROME || 'chromium', args, { stdio: 'ignore' });

    let version = null;
    for (let i = 0; i < 100; i++) {
        try { version = await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json(); break; } catch (e) { await wait(100); }
    }
    const cdp = new Cdp(version.webSocketDebuggerUrl);
    await cdp.connect();

    const { targetId } = await cdp.send('Target.createTarget', { url });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Performance.enable', {}, sessionId).catch(() => {});
    await wait(3000); // let every frame finish injecting and the page settle

    const evalIn = async (expression) => {
        const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        return r.result && r.result.value;
    };
    const metrics = await cdp.send('Performance.getMetrics', {}, sessionId).catch(() => ({ metrics: [] }));
    const metric = (name) => {
        const found = (metrics.metrics || []).find((m) => m.name === name);
        return found ? found.value : null;
    };
    const loadEnd = await evalIn('(function(){var n=performance.getEntriesByType("navigation")[0];return n?n.loadEventEnd:n;})()');
    const frames = await evalIn('document.querySelectorAll("iframe").length');

    await wait(200);
    const result = {
        frames,
        loadEventEndMs: Math.round(loadEnd || 0),
        taskDurationMs: Math.round((metric('TaskDuration') || 0) * 1000),
        scriptDurationMs: Math.round((metric('ScriptDuration') || 0) * 1000),
        nodes: Math.round(metric('Nodes') || 0)
    };

    cdp.close();
    child.kill('SIGKILL');
    server.close();
    rmSync(userDir, { recursive: true, force: true });
    return result;
}

async function main() {
    const runs = { without: [], with: [] };
    for (let i = 0; i < RUNS; i++) {
        runs.without.push(await runOnce(false));
        runs.with.push(await runOnce(true));
    }
    const median = (list, key) => {
        const sorted = list.map((r) => r[key]).sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
    };
    const summarize = (list) => ({
        loadEventEndMs: median(list, 'loadEventEndMs'),
        taskDurationMs: median(list, 'taskDurationMs'),
        scriptDurationMs: median(list, 'scriptDurationMs')
    });
    const without = summarize(runs.without);
    const withExt = summarize(runs.with);
    console.log(JSON.stringify({
        iframes: FRAMES,
        runs: { without: runs.without, with: runs.with },
        median: { without, with: withExt },
        delta: {
            loadEventEndMs: withExt.loadEventEndMs - without.loadEventEndMs,
            taskDurationMs: withExt.taskDurationMs - without.taskDurationMs,
            scriptDurationMs: withExt.scriptDurationMs - without.scriptDurationMs
        }
    }, null, 2));
}

main().catch((err) => { console.error('PERF PROBE FAILED:', err); process.exit(2); });
