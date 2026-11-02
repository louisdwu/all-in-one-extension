/**
 * Screenshot scheduler panel: settings, manual trigger, history.
 *
 * Settings go through the schema (sync storage); history lives in
 * chrome.storage.local on the background side and is reached over messages
 * (`screenshot:getHistory` / `screenshot:deleteHistory`).
 */

import '../../libs/core.js';
import '../../libs/schema.js';
import { schema, core, toast, uiLog, formatTime } from './shared.js';

const escapeHtml = (value) => core.dom.escapeHtml(value);

/** Ask Chrome for host access to the capture target; must run inside the click gesture. */
async function requestOriginPermission(url) {
    if (typeof chrome === 'undefined' || !chrome.permissions) return true;
    let origin;
    try {
        origin = new URL(url).origin + '/*';
    } catch (err) {
        return false;
    }
    try {
        const granted = await chrome.permissions.request({ origins: [origin] });
        if (!granted) uiLog.warn('host permission denied for', origin);
        return !!granted;
    } catch (err) {
        // Already-granted requests resolve true; failures here mean the call
        // lost the user gesture or the origin is unsupported — non-fatal.
        uiLog.warn('permission request failed:', err && err.message);
        return false;
    }
}

function send(type, payload = {}) {
    return new Promise((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({ type, ...payload }, (reply) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                resolve(reply || { ok: true });
            });
        } catch (err) {
            reject(err);
        }
    });
}

async function saveSettings(statusEl) {
    const urlEl = document.getElementById('screenshot-url');
    const timeEl = document.getElementById('screenshot-time');
    const offsetEl = document.getElementById('screenshot-offset');
    const waitEl = document.getElementById('screenshot-wait');
    const enabledEl = document.getElementById('screenshot-enabled');
    if (!urlEl || !timeEl || !offsetEl || !waitEl) return;

    const url = urlEl.value.trim();
    if (url && !/^https?:\/\//.test(url)) {
        toast('网页地址必须以 http:// 或 https:// 开头', 'error');
        return;
    }

    // Chrome requires permissions.request to run inside the click gesture —
    // before any other await.
    if (url && enabledEl && enabledEl.checked) await requestOriginPermission(url);

    await schema.save({
        screenshotEnabled: enabledEl ? enabledEl.checked : false,
        screenshotUrl: url,
        screenshotTime: timeEl.value || '09:00',
        screenshotOffsetMin: parseInt(offsetEl.value, 10) || 0,
        screenshotWaitMs: parseInt(waitEl.value, 10) || 10000
    });
    toast('签到设置已保存');
    if (statusEl) statusEl.textContent = '设置已保存，定时任务已更新';
}

async function triggerNow(statusEl) {
    if (statusEl) statusEl.textContent = '正在签到，请稍候…';
    try {
        const reply = await send('screenshot:trigger');
        if (reply && reply.ok) {
            toast('签到完成');
            if (statusEl) statusEl.textContent = '签到完成';
            await renderHistory();
        } else {
            throw new Error((reply && reply.error) || '未知错误');
        }
    } catch (err) {
        toast('签到失败：' + (err && err.message), 'error');
        if (statusEl) statusEl.textContent = '签到失败：' + (err && err.message);
    }
}

async function renderHistory() {
    const container = document.getElementById('screenshot-history');
    if (!container) return;

    let history = [];
    try {
        const reply = await send('screenshot:getHistory');
        history = (reply && reply.history) || [];
    } catch (err) {
        uiLog.warn('load history failed:', err && err.message);
    }

    if (!history.length) {
        container.innerHTML = '<p class="help-text">暂无签到记录</p>';
        return;
    }

    const items = history.map((item) => {
        const url = escapeHtml(item.url || '');
        const shortUrl = url.length > 60 ? url.slice(0, 57) + '…' : url;
        return `
            <div class="screenshot-item">
                <img src="${item.image}" class="screenshot-preview" alt="签到 ${formatTime(item.timestamp)}" loading="lazy">
                <div class="screenshot-info">
                    <div class="screenshot-url" title="${url}">${shortUrl}</div>
                    <div class="screenshot-time">${formatTime(item.timestamp)}</div>
                    <div class="screenshot-actions">
                        <button type="button" class="screenshot-btn view" data-id="${item.id}">查看</button>
                        <button type="button" class="screenshot-btn delete" data-id="${item.id}">删除</button>
                    </div>
                </div>
            </div>`;
    }).join('');
    container.innerHTML = items;

    for (const button of container.querySelectorAll('.screenshot-btn')) {
        button.addEventListener('click', () => {
            const id = Number(button.dataset.id);
            if (button.classList.contains('view')) viewScreenshot(id);
            else deleteScreenshot(id);
        });
    }
}

async function viewScreenshot(id) {
    try {
        const reply = await send('screenshot:getHistory');
        const item = ((reply && reply.history) || []).find((entry) => entry.id === id);
        if (!item || !item.image) {
            toast('找不到这条记录', 'error');
            return;
        }
        // Chrome blocks top-level data: navigation, so wrap the image in a
        // blob URL owned by this extension page.
        const blob = dataUrlToBlob(item.image);
        const blobUrl = URL.createObjectURL(blob);
        chrome.tabs.create({ url: blobUrl, active: true }, (tab) => {
            const tabId = tab && tab.id;
            const cleanup = (removedId) => {
                if (removedId !== tabId) return;
                URL.revokeObjectURL(blobUrl);
                chrome.tabs.onRemoved.removeListener(cleanup);
            };
            chrome.tabs.onRemoved.addListener(cleanup);
        });
    } catch (err) {
        toast('打开截图失败：' + (err && err.message), 'error');
    }
}

async function deleteScreenshot(id) {
    try {
        const reply = await send('screenshot:deleteHistory', { ids: [id] });
        if (!reply || !reply.ok) throw new Error((reply && reply.error) || '未知错误');
        await renderHistory();
    } catch (err) {
        toast('删除失败：' + (err && err.message), 'error');
    }
}

function dataUrlToBlob(dataUrl) {
    const [header, data] = String(dataUrl).split(',');
    const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}

export async function initScreenshot() {
    const settings = await schema.load();

    const enabledEl = document.getElementById('screenshot-enabled');
    const urlEl = document.getElementById('screenshot-url');
    const timeEl = document.getElementById('screenshot-time');
    const offsetEl = document.getElementById('screenshot-offset');
    const waitEl = document.getElementById('screenshot-wait');

    if (enabledEl) enabledEl.checked = settings.screenshotEnabled;
    if (urlEl) urlEl.value = settings.screenshotUrl;
    if (timeEl) timeEl.value = settings.screenshotTime;
    if (offsetEl) offsetEl.value = settings.screenshotOffsetMin;
    if (waitEl) waitEl.value = settings.screenshotWaitMs;

    const saveButton = document.getElementById('screenshot-save');
    if (saveButton) saveButton.addEventListener('click', () => saveSettings(document.getElementById('screenshot-status')));

    const triggerButton = document.getElementById('screenshot-trigger');
    if (triggerButton) triggerButton.addEventListener('click', () => triggerNow(document.getElementById('screenshot-status')));

    await renderHistory();
    uiLog.debug('screenshot panel ready');
}
