#!/usr/bin/env node
// Diagnostic 2: launch Chromium with --incognito so the first window is a REAL
// incognito window (extension content scripts run if "allow in incognito" is on),
// then verify the seeding pipeline against www.bilibili.com.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXT_DIR = resolve(process.argv[2] || process.cwd());
const DEBUG_PORT = 9341;
const CHROME_BIN = process.env.AIO_CHROME || 'chromium';
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
    constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); }
    async connect() {
        this.ws = new WebSocket(this.wsUrl);
        await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
        this.ws.onmessage = (ev) => {
            const msg = JSON.parse(ev.data);
            if (msg.id && this.pending.has(msg.id)) {
                const { res, rej } = this.pending.get(msg.id);
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
            const timer = setTimeout(() => { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 30000);
            this.pending.set(id, { res: (v) => { clearTimeout(timer); res(v); }, rej: (e) => { clearTimeout(timer); rej(e); } });
        });
    }
    close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

const out = (...a) => console.log('[incognito-test2]', ...a);

const userDir = mkdtempSync(join(tmpdir(), 'aio-incog2-'));
const child = spawn(CHROME_BIN, [
    '--headless=new',
    '--incognito',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + userDir,
    '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-extensions-except=' + EXT_DIR,
    '--load-extension=' + EXT_DIR,
    'https://www.bilibili.com/',
], { stdio: ['ignore', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => {
    const line = String(d);
    if (/Failed to load extension|Manifest is not valid/i.test(line)) out('CHROME-ERR:', line.trim().slice(0, 300));
});

let version = null;
for (let i = 0; i < 80; i++) {
    try { version = await (await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version')).json(); break; }
    catch (e) { await WAIT(100); }
}
if (!version) { console.error('no devtools'); process.exit(1); }

const cdp = new Cdp(version.webSocketDebuggerUrl);
await cdp.connect();

const attach = async (targetId) => {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    return sessionId;
};
const ev = async (expr, session) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, session);
    if (r.exceptionDetails) throw new Error('eval: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result && r.result.value;
};

// wait for both the SW and the bilibili page
const findTarget = async (pred) => {
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos.find(pred);
};
let sw = null, page = null;
for (let i = 0; i < 80 && (!sw || !page); i++) {
    sw = sw || await findTarget((t) => t.type === 'service_worker' && t.url.includes('chrome-extension://'));
    page = page || await findTarget((t) => t.type === 'page' && t.url.includes('bilibili.com'));
    if (!sw || !page) await WAIT(250);
}
out('sw:', sw ? sw.url : 'MISSING', '| page:', page ? page.url.slice(0, 50) : 'MISSING');

// Enable "allow in incognito" via an extensions page, then re-find the SW.
let extId = sw ? new URL(sw.url).host : null;
if (!extId) {
    // maybe extension disabled; find id from any chrome-extension target or use the load path hash later
    out('no SW initially — launching chrome://extensions to configure');
}

const extPage = await cdp.send('Target.createTarget', { url: 'chrome://extensions/' });
const extSession = await attach(extPage.targetId);
await WAIT(1500);
let extIdResolved = extId;
try {
    extIdResolved = await ev(`
        new Promise((resolve) => {
            chrome.developerPrivate.getExtensionsInfo((infos) => {
                const mine = (infos || []).find(i => i.location === 'UNPACKED');
                resolve(mine ? mine.id : null);
            });
        })
    `, extSession);
} catch (e) { out('getExtensionsInfo failed:', e.message.slice(0, 150)); }
out('extId:', extIdResolved);

if (extIdResolved) {
    try {
        const t = await ev(`
            new Promise((resolve) => {
                chrome.developerPrivate.updateExtensionConfiguration(
                    { extensionId: '${extIdResolved}', incognitoAccess: true },
                    () => resolve(chrome.runtime.lastError ? ('err:' + chrome.runtime.lastError.message) : 'ok'));
            })
        `, extSession);
        out('toggle incognito:', t);
        const re = await ev(`
            new Promise((resolve) => {
                chrome.management.setEnabled('${extIdResolved}', true, () =>
                    resolve(chrome.runtime.lastError ? ('err:' + chrome.runtime.lastError.message) : 'ok'));
            })
        `, extSession);
        out('re-enable:', re);
    } catch (e) { out('config failed:', e.message.slice(0, 150)); }
}

// store fake credentials
await WAIT(1500);
let sw2 = null;
for (let i = 0; i < 60; i++) {
    sw2 = await findTarget((t) => t.type === 'service_worker' && t.url.includes('chrome-extension://'));
    if (sw2) break;
    await WAIT(250);
}
if (!sw2) { console.error('SW missing after config'); process.exit(1); }
const swSession = await attach(sw2.targetId);

const fakeCred = {
    sessdata: 'fake%2Csessdata%2Cfake|fake',
    dedeUserId: '424242',
    biliJct: 'fakejct',
    dedeUserIdCkMd5: 'fakemd5'
};
out('credential stored:', await ev(`
    (async () => {
        await chrome.storage.sync.set({ biliCookies: ${JSON.stringify(fakeCred)} });
        return 'ok';
    })()
`, swSession));

// reload the incognito page on a real VIDEO page so guard.js/inject.js run
let page2 = page;
if (!page2) {
    for (let i = 0; i < 40; i++) {
        page2 = await findTarget((t) => t.type === 'page' && t.url.includes('bilibili.com'));
        if (page2) break;
        await WAIT(250);
    }
}
if (!page2) { console.error('bilibili page missing'); process.exit(1); }
const pageSession = await attach(page2.targetId);
await cdp.send('Page.enable', {}, pageSession).catch(() => {});
await cdp.send('Page.navigate', { url: 'https://www.bilibili.com/video/BV1GJ411x7h7/' }, pageSession).catch(() => {});
await WAIT(10000);

const pageState = await ev(`JSON.stringify({
    url: location.href.slice(0, 70),
    incognitoAttr: document.documentElement.getAttribute('data-aio-incognito'),
    loginAttr: document.documentElement.getAttribute('data-aio-bili-login'),
    hasDedeUserID: /DedeUserID=424242/.test(document.cookie),
    hasJct: /bili_jct=fakejct/.test(document.cookie),
    hintAttr: document.documentElement.getAttribute('data-aio-bili-hint'),
    title: document.title
})`, pageSession);
out('REAL incognito VIDEO page state:', pageState);

const swView = await ev(`
    (async () => {
        const stores = await chrome.cookies.getAllCookieStores();
        const out = { storeIds: stores.map(s => ({ id: s.id, tabs: (s.tabIds || []).length })) };
        for (const id of ['0', '1']) {
            try {
                const all = await chrome.cookies.getAll({ url: 'https://www.bilibili.com', storeId: id });
                out['cookies_' + id] = all.map(c => c.name);
            } catch (e) { out['cookies_' + id] = 'err:' + e.message.slice(0, 60); }
        }
        return JSON.stringify(out);
    })()
`, swSession);
out('background view:', swView);

cdp.close();
child.kill();
try { rmSync(userDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
process.exit(0);
