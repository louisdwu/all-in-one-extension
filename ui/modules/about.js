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

    document.addEventListener('aio:pane-shown', (event) => {
        if (event.detail.targetId === 'tab-about') {
            renderStorage();
            renderSnapshot();
        }
    });
}

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
    return [
        'AIO diagnostics ' + new Date().toISOString(),
        'extension: v' + chrome.runtime.getManifest().version,
        'schema: v' + schema.SCHEMA_VERSION,
        'ua: ' + navigator.userAgent,
        'waqi last success: ' + formatTime(data.hudLastSuccessWaqi),
        'ha last success: ' + formatTime(data.hudLastSuccessHa),
        'waqi station time: ' + (data.hudLastWaqiPubS || 'never'),
        'settings: ' + JSON.stringify(settings)
    ].join('\n');
}
