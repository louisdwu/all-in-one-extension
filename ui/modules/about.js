/**
 * About / diagnostics panel.
 *
 * Gives the user (and future debugging sessions) one place to see the version,
 * permission status, storage footprint and the full normalized settings object.
 */
import './shared.js';
import { schema, core, toast, formatTime } from './shared.js';

export async function initAbout() {
    const manifest = chrome.runtime.getManifest();
    document.getElementById('about-version').textContent = 'v' + manifest.version + '（schema v' + schema.SCHEMA_VERSION + '）';
    document.getElementById('about-ua').textContent = navigator.userAgent;

    const incognitoEl = document.getElementById('about-incognito');
    chrome.extension.isAllowedIncognitoAccess((allowed) => {
        incognitoEl.textContent = allowed ? '已允许' : '未允许（无痕相关功能不可用）';
        incognitoEl.style.color = allowed ? '' : 'var(--warning)';
    });

    const settings = await schema.load();
    const debugToggle = document.getElementById('about-debug');
    if (debugToggle) debugToggle.checked = settings.aioDebug === true;
    debugToggle?.addEventListener('change', async () => {
        await schema.save({ aioDebug: debugToggle.checked });
        toast(debugToggle.checked ? '调试日志已开启，打开控制台查看 [AIO:*] 输出' : '调试日志已关闭');
    });

    renderStorage();
    renderSnapshot();

    document.getElementById('about-copy')?.addEventListener('click', async () => {
        const text = await diagnosticsText();
        try {
            await navigator.clipboard.writeText(text);
            toast('诊断信息已复制到剪贴板');
        } catch (err) {
            toast('复制失败：' + err.message, 'error');
        }
    });

    document.getElementById('about-sync-check')?.addEventListener('click', async () => {
        const current = await schema.load();
        const migrated = await schema.migrate();
        const missing = Object.keys(schema.DEFAULTS).filter((key) => current[key] === undefined);
        toast(missing.length ? '缺少键：' + missing.join(', ') : (migrated ? '已升级旧配置格式' : '配置完整，无需修复'));
        renderSnapshot();
    });

    document.getElementById('diag-refresh')?.addEventListener('click', () => refreshDiagnostics());
    document.getElementById('diag-clear-log')?.addEventListener('click', async () => {
        await core.sendMessage({ type: 'diag:clearLog' });
        await refreshDiagnostics();
        toast('后台日志已清空');
    });

    document.addEventListener('aio:pane-shown', (event) => {
        if (event.detail.targetId === 'tab-about') {
            renderStorage();
            renderSnapshot();
            refreshDiagnostics();
        }
    });
}

/* --------------------------- diagnostics panel --------------------------- */

/** Message handler statistics + recent warnings/errors from the worker. */
async function refreshDiagnostics() {
    const messagesEl = document.getElementById('diag-messages');
    const errorsEl = document.getElementById('diag-errors');
    if (!messagesEl || !errorsEl) return;

    const snapshot = await core.sendMessage({ type: 'diag:snapshot' }, 5000);
    if (!snapshot || !snapshot.ok) {
        messagesEl.innerHTML = '<div class="help-text" style="padding:10px">无法读取后台诊断信息：Service Worker 可能尚未启动，请稍后再试。</div>';
        errorsEl.textContent = '（无数据）';
        return;
    }

    lastSnapshot = snapshot;

    const header = document.createElement('div');
    header.className = 'diag-row head';
    header.innerHTML = '<span>类型</span><span class="num">调用</span><span class="num">失败</span><span class="num">平均</span>';

    const rows = (snapshot.messageStats || []).map((entry) => {
        const row = document.createElement('div');
        row.className = 'diag-row';
        const type = document.createElement('span');
        type.className = 'type';
        type.textContent = entry.type;
        type.title = entry.lastError ? '最近错误：' + entry.lastError : entry.type;
        const calls = document.createElement('span');
        calls.className = 'num';
        calls.textContent = String(entry.calls);
        const errors = document.createElement('span');
        errors.className = 'num' + (entry.errors ? ' bad' : '');
        errors.textContent = String(entry.errors);
        const avg = document.createElement('span');
        avg.className = 'num';
        avg.textContent = entry.avgMs + 'ms';
        row.append(type, calls, errors, avg);
        return row;
    });

    messagesEl.replaceChildren(header, ...rows);
    if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'help-text';
        empty.style.padding = '10px';
        empty.textContent = '还没有消息调用（Service Worker 可能刚启动）。';
        messagesEl.appendChild(empty);
    }

    const errors = snapshot.errors || [];
    errorsEl.textContent = errors.length
        ? errors.slice().reverse().map((entry) => {
            const time = new Date(entry.at).toLocaleTimeString('zh-CN', { hour12: false });
            return '[' + time + '] ' + entry.level.toUpperCase() + ' ' + entry.tag + ': ' + entry.message;
        }).join('\n')
        : '（暂无告警或错误）';
}

let lastSnapshot = null;

async function renderStorage() {
    const el = document.getElementById('about-storage');
    if (!el) return;
    const sync = await core.storage.getSync(null);
    const local = await core.storage.getLocal(null);
    const syncBytes = new Blob([JSON.stringify(sync)]).size;
    const localBytes = new Blob([JSON.stringify(local)]).size;
    el.textContent = 'sync ' + syncBytes + ' B / local ' + localBytes + ' B';
}

async function renderSnapshot() {
    const el = document.getElementById('about-snapshot');
    if (!el) return;
    const settings = await schema.load();
    const safe = Object.assign({}, settings, {
        biliCookies: { sessdata: settings.biliCookies.sessdata ? '***' : '', dedeUserId: settings.biliCookies.dedeUserId },
        haToken: settings.haToken ? '***' : '',
        waqiToken: settings.waqiToken ? '***' : ''
    });
    el.textContent = JSON.stringify(safe, null, 2);
}

async function diagnosticsText() {
    const settings = await schema.load();
    const data = await core.storage.getLocal(['hudLastSuccessWaqi', 'hudLastSuccessHa', 'hudLastWaqiPubS']);
    const snapshot = lastSnapshot || await core.sendMessage({ type: 'diag:snapshot' }, 5000);
    const worker = snapshot && snapshot.ok
        ? 'worker: v' + snapshot.version + ', schema v' + snapshot.schemaVersion +
          ', sync ' + snapshot.storage.syncBytes + 'B, local ' + snapshot.storage.localBytes + 'B'
        : 'worker: unavailable';
    return [
        'AIO diagnostics ' + new Date().toISOString(),
        'extension: v' + chrome.runtime.getManifest().version,
        'schema: v' + schema.SCHEMA_VERSION,
        'ua: ' + navigator.userAgent,
        worker,
        'waqi last success: ' + formatTime(data.hudLastSuccessWaqi),
        'ha last success: ' + formatTime(data.hudLastSuccessHa),
        'waqi station time: ' + (data.hudLastWaqiPubS || 'never'),
        'message handlers: ' + ((snapshot && snapshot.registeredTypes) || []).join(', '),
        'settings: ' + JSON.stringify(settings)
    ].join('\n');
}
