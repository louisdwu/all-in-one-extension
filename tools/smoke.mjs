#!/usr/bin/env node
/**
 * AIO smoke test harness — loads the unpacked extension in headless Chromium,
 * captures background service-worker errors, then loads options/popup/test pages
 * and reports console errors + behavioural assertions.
 *
 * Usage: node tools/smoke.mjs [--ext=path] [--port=9333] [--keep]
 * Exit code: 0 = no errors captured, non-zero otherwise.
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
const DEBUG_PORT = Number(args.port || 9333);
const WAIT_MS = (ms) => new Promise((r) => setTimeout(r, ms));
const LOG = (...a) => console.error('[smoke]', ...a);

const TEST_PAGE = [
  '<!doctype html><html><head><meta charset="utf-8"><title>AIO Test Page</title></head><body>',
  '<h1>AIO smoke test page</h1>',
  '<video id="v1" width="320" height="180"></video>',
  '<video id="v2" width="320" height="180"></video>',
  '<a id="link" href="https://example.com/x?utm_source=t&spm_id_from=1&p=2">a link</a>',
  '<script>',
  '  window.__pageErrors = [];',
  '  window.addEventListener("error", function (e) { window.__pageErrors.push(String(e.message)); });',
  '  var v = document.getElementById("v1");',
  '  v.playbackRate = 1.75;',
  '  setInterval(function () { try { v.playbackRate = 1.75; } catch (e) {} }, 150);',
  '</script>',
  '</body></html>',
].join('\n');

function startServer() {
  return new Promise((res) => {
    const server = createServer((req, resp) => {
      if (req.url.startsWith('/frame')) {
        resp.writeHead(200, { 'content-type': 'text/html' });
        resp.end('<!doctype html><html><body><video id="vf"></video></body></html>');
        return;
      }
      resp.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      resp.end(TEST_PAGE);
    });
    server.listen(0, '127.0.0.1', () => res(server));
  });
}

class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.id = 0; this.pending = new Map(); this.handlers = [];
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new Error('CDP timeout: ' + method));
      }, 15000);
      this.pending.set(id, {
        res: (v) => { clearTimeout(timer); res(v); },
        rej: (e) => { clearTimeout(timer); rej(e); },
      });
    });
  }
  onEvent(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

function extractText(arg) {
  if (!arg) return '';
  if (arg.value !== undefined) return String(arg.value);
  if (arg.description) return arg.description;
  if (arg.preview) return JSON.stringify(arg.preview);
  return arg.type || '';
}

const report = { extension: EXT_DIR, background: [], pages: [], assertions: [], stderr: [] };

async function main() {
  LOG('starting chromium for', EXT_DIR);
  const userDir = mkdtempSync(join(tmpdir(), 'aio-profile-'));
  const server = await startServer();
  const port = server.address().port;
  const targetUrl = 'http://127.0.0.1:' + port + '/';

  const child = spawn('chromium', [
    '--headless=new',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + userDir,
    '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-dev-shm-usage',
    '--enable-logging=stderr', '--log-level=0',
    '--disable-extensions-except=' + EXT_DIR,
    '--load-extension=' + EXT_DIR,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  child.stderr.on('data', (d) => {
    for (const line of String(d).split('\n')) {
      if (!line.trim()) continue;
      if (/CONSOLE|Uncaught|Failed to load extension|extension/i.test(line)) {
        report.stderr.push(line.trim().slice(0, 500));
      }
    }
  });

  let version = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + DEBUG_PORT + '/json/version');
      version = await r.json();
      break;
    } catch (e) { await WAIT_MS(100); }
  }
  if (!version) throw new Error('Chromium did not expose a debugging port');
  LOG('devtools up:', version.Browser);

  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.connect();

  const findSw = async () => {
    const { targetInfos } = await cdp.send('Target.getTargets');
    return targetInfos.find((t) => t.type === 'service_worker' && t.url.indexOf('chrome-extension://') === 0);
  };
  let swTarget = null;
  for (let i = 0; i < 50; i++) {
    swTarget = await findSw();
    if (swTarget) break;
    await WAIT_MS(100);
  }
  const extId = swTarget ? new URL(swTarget.url).host : null;
  LOG('service worker target:', swTarget ? swTarget.url : 'NOT FOUND', '=> extId', extId);

  const attach = async (targetId) => {
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    try { await cdp.send('Log.enable', {}, sessionId); } catch (e) { /* ignore */ }
    return sessionId;
  };

  const swErrors = [];
  let swSessionId = null;
  cdp.onEvent((msg) => {
    // Only collect events from the service-worker target: page errors are
    // reported separately per page session and would otherwise be duplicated.
    if (swSessionId && msg.sessionId && msg.sessionId !== swSessionId) return;
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      swErrors.push('EXCEPTION: ' + ((d.exception && d.exception.description) || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].indexOf(msg.params.type) >= 0) {
      swErrors.push(msg.params.type.toUpperCase() + ': ' + msg.params.args.map(extractText).join(' '));
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      swErrors.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  if (swTarget) {
    const swSession = await attach(swTarget.targetId);
    swSessionId = swSession;
    try {
      const r = await cdp.send('Runtime.evaluate', {
        expression: 'JSON.stringify({name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version})',
        returnByValue: true, awaitPromise: true,
      }, swSession);
      report.manifestProbe = r.result && r.result.value;
    } catch (e) { swErrors.push('PROBE: ' + e.message); }
  } else {
    report.assertions.push({ name: 'extensionLoaded', value: 'FAILED: no service worker target' });
  }

  const loadPage = async (url, label, waitMs) => {
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const sessionId = await attach(targetId);
    const info = { label, url, errors: [] };
    cdp.onEvent((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        info.errors.push('EXCEPTION: ' + ((d.exception && d.exception.description) || d.text));
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        info.errors.push('ERROR: ' + msg.params.args.map(extractText).join(' '));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        info.errors.push('LOG: ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
      }
    });
    await WAIT_MS(waitMs || 1500);
    info.evaluate = async (expr) => {
      const r = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId);
      return r.result && r.result.value;
    };
    report.pages.push(info);
    return info;
  };

  if (extId) {
    LOG('loading options page');
    const opt = await loadPage('chrome-extension://' + extId + '/ui/options.html', 'options', 2200);
    report.assertions.push({
      name: 'options.dom',
      value: await opt.evaluate('JSON.stringify({version: (document.getElementById("sidebar-version") || {}).textContent, panes: document.querySelectorAll(".tab-pane").length, navButtons: document.querySelectorAll(".nav button").length, shortcutItems: document.querySelectorAll(".shortcut-item").length, hudMetrics: document.querySelectorAll("[id^=waqi-metric-]").length})'),
    });
    const pop = await loadPage('chrome-extension://' + extId + '/ui/popup.html', 'popup', 1600);
    report.assertions.push({
      name: 'popup.dom',
      value: await pop.evaluate('JSON.stringify({title: (document.querySelector(".title") || {}).textContent, cards: document.querySelectorAll(".card").length, speed: (document.getElementById("speed-value") || {}).textContent, hud: (document.getElementById("hud-list") || {}).textContent.slice(0, 30)})'),
    });
  }

  LOG('loading test page', targetUrl);
  const page = await loadPage(targetUrl, 'web-page', 3000);
  report.assertions.push({
    name: 'content.page',
    value: await page.evaluate([
      'JSON.stringify({',
      '  ball: !!(document.getElementById("aio-speed-ui") && document.getElementById("aio-speed-ui").shadowRoot),',
      '  uiHost: !!document.getElementById("aio-speed-ui"),',
      '  styles: !!document.getElementById("aio-speed-ui"),',
      '  rate1: document.getElementById("v1").playbackRate,',
      '  rate2: document.getElementById("v2").playbackRate,',
      '  pageErrors: window.__pageErrors || [],',
      '  attrAction: document.documentElement.getAttribute("data-aio-speed-action"),',
      '  attrValue: document.documentElement.getAttribute("data-aio-speed-value")',
      '})',
    ].join('\n')),
  });

  report.background = swErrors;
  LOG('done, shutting down');
  cdp.close();
  child.kill('SIGKILL');
  server.close();
  if (!args.keep) rmSync(userDir, { recursive: true, force: true });

  console.log(JSON.stringify(report, null, 2));
  const bad = report.background.length + report.pages.reduce((n, p) => n + p.errors.length, 0);
  console.log('');
  console.log('=== SUMMARY ===');
  console.log('background issues: ' + report.background.length);
  for (const p of report.pages) console.log(p.label + ' issues: ' + p.errors.length);
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE FAILED:', e); process.exit(2); });
