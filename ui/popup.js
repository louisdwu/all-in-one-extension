/**
 * Toolbar popup (ES module).
 *
 * The old popup was a 300-line callback tangle that re-ran its whole
 * initialisation every time a `reloadSettings` message arrived, stacking
 * duplicate click handlers (one click = N speed changes). This version
 * initialises once and keeps a single render path.
 */
import '../libs/core.js';
import '../libs/schema.js';
import '../libs/keys.js';
import '../libs/rules.js';
import '../libs/i18n.js';

const AIO = globalThis.AIO;
const { log } = AIO.core;
const popupLog = log('popup');

/* ------------------------------ helpers ------------------------------ */
async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0] || null;
}

function sendToTab(tabId, message, timeoutMs = 3000) {
    return new Promise((resolve) => {
        if (tabId === undefined || tabId < 0) return resolve(null);
        const timer = setTimeout(() => resolve(null), timeoutMs);
        try {
            chrome.tabs.sendMessage(tabId, message, (response) => {
                clearTimeout(timer);
                void chrome.runtime.lastError;
                resolve(response === undefined ? null : response);
            });
        } catch (err) {
            clearTimeout(timer);
            resolve(null);
        }
    });
}

function el(tag, props = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'className') node.className = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else node.setAttribute(key, value);
    }
    if (text !== undefined) node.textContent = text;
    return node;
}

/* -------------------------------- HUD -------------------------------- */
async function renderHud() {
    const list = document.getElementById('hud-list');
    const data = await AIO.core.storage.getLocal(['hudState', 'hudQueueKeys']);
    const state = data.hudState || {};
    const queue = data.hudQueueKeys || [];

    list.replaceChildren();
    if (!queue.length) {
        list.appendChild(el('div', { className: 'empty' }, AIO.i18n.t('popupHudEmpty', '未配置监控项，去设置页添加')));
        return;
    }
    for (const key of queue) {
        const item = state[key];
        if (!item) continue;
        const row = el('div', { className: 'hud-row' });
        row.append(el('span', { className: 'hud-name' }, item.name || key));
        row.append(el('span', { className: 'hud-value' + (item.error ? ' error' : '') }, String(item.value)));
        list.appendChild(row);
    }
}

/* ------------------------------ speeder ------------------------------ */
function presetCycle(currentSpeed, settings) {
    const presets = AIO.schema.presetList(settings);
    if (!presets.length) return currentSpeed;
    if (presets.length === 1) {
        return Math.abs(currentSpeed - presets[0]) < 0.01 ? settings.defaultSpeed : presets[0];
    }
    const index = presets.findIndex((value) => Math.abs(currentSpeed - value) < 0.01);
    return presets[(index + 1) % presets.length];
}

async function initSpeeder(settings) {
    const toggle = document.getElementById('speeder-toggle');
    const value = document.getElementById('speed-value');
    const stateLabel = document.getElementById('speed-state');
    const hint = document.getElementById('speed-hint');
    toggle.checked = settings.globalEnabled !== false;

    const tab = await activeTab();
    const response = await sendToTab(tab && tab.id, { type: 'speeder:getSpeed' });
    let currentSpeed = response && typeof response.speed === 'number' ? response.speed : settings.defaultSpeed;

    const render = () => {
        value.textContent = currentSpeed.toFixed(2) + 'x';
        const active = response ? response.active !== false : AIO.rules.matches(tab ? tab.url : '', settings);
        stateLabel.textContent = active ? '已接管' : '未启用（规则/开关）';
        stateLabel.classList.toggle('off', !active);
        hint.textContent = '快捷键：' + Object.entries(settings.shortcuts)
            .map(([action2, combo]) => ({ increaseSpeed: '加速', decreaseSpeed: '减速', presetSpeed: '预设' }[action2] + ' ' + AIO.keys.display(combo)))
            .join(' · ');
    };
    render();

    const command = async (action) => {
        const tabInfo = await activeTab();
        const result = await sendToTab(tabInfo && tabInfo.id, { type: 'speeder:command', action });
        if (result && typeof result.speed === 'number') currentSpeed = result.speed;
        else {
            // No content script (chrome:// page, PDF, just-installed): compute locally for display only.
            if (action === 'increase') currentSpeed = Math.min(settings.speederMaxRate, currentSpeed + settings.speederStep);
            else if (action === 'decrease') currentSpeed = Math.max(settings.speederMinRate, currentSpeed - settings.speederStep);
            else if (action === 'preset') currentSpeed = presetCycle(currentSpeed, settings);
        }
        render();
    };

    document.getElementById('speed-up').addEventListener('click', () => command('increase'));
    document.getElementById('speed-down').addEventListener('click', () => command('decrease'));
    document.getElementById('speed-preset').addEventListener('click', () => command('preset'));

    toggle.addEventListener('change', async () => {
        await AIO.schema.save({ globalEnabled: toggle.checked });
        await AIO.core.sendMessage({ type: 'speeder:saveSettings', settings: { globalEnabled: toggle.checked } });
        const tabInfo = await activeTab();
        await sendToTab(tabInfo && tabInfo.id, { type: 'aio:settingsChanged' });
    });
}

/* ------------------------------ hotkeys ------------------------------ */
async function initHotkeys(settings) {
    const siteEl = document.getElementById('hotkey-site');
    const toggle = document.getElementById('hotkey-toggle');
    const original = document.getElementById('hotkey-original');
    const replacement = document.getElementById('hotkey-new');
    const list = document.getElementById('hotkey-list');

    const context = await AIO.core.sendMessage({ type: 'hotkeys:context' });
    const hostname = (context && context.hostname) || '';
    if (!hostname) {
        siteEl.textContent = '当前页面不支持（chrome:// 或扩展页）';
        document.getElementById('hotkey-add').disabled = true;
        return;
    }
    siteEl.textContent = hostname;

    let mappings = (context && context.mappings) || {};
    const enabledSites = settings.enabledSites || {};
    toggle.checked = enabledSites[hostname] !== false;

    const render = () => {
        list.replaceChildren();
        const entries = Object.entries(mappings);
        if (!entries.length) {
            list.appendChild(el('div', { className: 'empty' }, AIO.i18n.t('popupHotkeyEmpty', '暂无映射')));
            return;
        }
        for (const [from, to] of entries) {
            const row = el('div', { className: 'mapping-row' });
            const keys = el('div', { className: 'mapping-keys' });
            keys.append(el('span', { className: 'key-badge' }, from), el('span', { className: 'arrow' }, '→'), el('span', { className: 'key-badge' }, to));
            const remove = el('button', { type: 'button', className: 'link-btn', title: '删除' }, '✕');
            remove.addEventListener('click', async () => {
                const result = await AIO.core.sendMessage({ type: 'hotkeys:deleteMapping', hostname, key: from });
                mappings = (result && result.mappings) || {};
                render();
            });
            row.append(keys, remove);
            list.appendChild(row);
        }
    };
    render();

    const record = (input, then) => {
        input.addEventListener('focus', () => {
            input.value = '';
            input.classList.add('recording');
        });
        input.addEventListener('blur', () => input.classList.remove('recording'));
        input.addEventListener('keydown', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') return;
            if (AIO.keys.MODIFIER_KEYS.includes(event.key)) return;
            input.value = AIO.keys.serialize(event);
            input.classList.remove('recording');
            input.blur();
            if (then) then();
        });
    };
    record(original, () => replacement.focus());
    record(replacement);

    toggle.addEventListener('change', async () => {
        await AIO.core.sendMessage({ type: 'hotkeys:setSiteEnabled', hostname, enabled: toggle.checked });
    });

    document.getElementById('hotkey-add').addEventListener('click', async () => {
        const from = original.value.trim();
        const to = replacement.value.trim();
        if (!from || !to) return;
        if (from === to) {
            original.value = '';
            replacement.value = '';
            return;
        }
        mappings[from] = to;
        const result = await AIO.core.sendMessage({ type: 'hotkeys:setMappings', hostname, mappings });
        mappings = (result && result.mappings) || mappings;
        original.value = '';
        replacement.value = '';
        render();
    });

    document.getElementById('hotkey-clear').addEventListener('click', async () => {
        if (!Object.keys(mappings).length) return;
        const result = await AIO.core.sendMessage({ type: 'hotkeys:clearSite', hostname });
        mappings = (result && result.mappings) || {};
        render();
    });
}

/* -------------------------------- boot -------------------------------- */
async function boot() {
    AIO.i18n.apply();
    document.getElementById('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());

    const settings = await AIO.schema.load();

    const tabsToggle = document.getElementById('aio-tabs-toggle');
    tabsToggle.checked = settings.aioTabsEnabled !== false;
    tabsToggle.addEventListener('change', () => AIO.schema.save({ aioTabsEnabled: tabsToggle.checked }));

    const hudToggle = document.getElementById('hud-toggle');
    hudToggle.checked = settings.hudEnabled !== false;
    hudToggle.addEventListener('change', async () => {
        await AIO.schema.save({ hudEnabled: hudToggle.checked });
        await AIO.core.sendMessage({ type: 'hud:updateConfig' });
    });

    const ezKey = document.getElementById('ez-key');
    ezKey.textContent = { ctrlKey: 'Ctrl', altKey: 'Alt', shiftKey: 'Shift', metaKey: 'Meta' }[settings.modifierKey] || 'Ctrl';

    await Promise.all([renderHud(), initSpeeder(settings), initHotkeys(settings)]);

    // Live updates while the popup is open.
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.hudState || changes.hudQueueKeys)) renderHud();
        if (area === 'sync' && changes.globalEnabled) {
            document.getElementById('speeder-toggle').checked = changes.globalEnabled.newValue !== false;
        }
    });
    popupLog.debug('ready');
}

document.addEventListener('DOMContentLoaded', () => {
    boot().catch((err) => popupLog.error('popup init failed', err));
});
