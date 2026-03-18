document.addEventListener('DOMContentLoaded', () => {
    initEZIncognito();
    initAioTabs();
    initHAMonitor();
    initSmartSpeeder();
    initHotkeyChanger();
    initSync(); // 新增同步逻辑

    document.getElementById('open-options-icon').addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });
});

// ==== Sync Logic ====
function initSync() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;
        
        // 映射存储键名到 DOM ID
        const syncMap = {
            aioTabsEnabled: 'aio-tabs-toggle',
            globalEnabled: 'speeder-global-toggle'
        };

        for (const [key, id] of Object.entries(syncMap)) {
            if (changes[key]) {
                const el = document.getElementById(id);
                if (el) el.checked = changes[key].newValue !== false;
            }
        }
    });

    // 监听重载消息（例如 Smart Speeder 复杂配置更新）
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'reloadSettings') {
            initSmartSpeeder();
        }
    });
}

// === EZ Incognito ===
function initEZIncognito() {
    const keyNames = {
        'ctrlKey': 'Ctrl',
        'altKey': 'Alt',
        'shiftKey': 'Shift',
        'metaKey': 'Meta(Win)'
    };
    const currentKeyElement = document.getElementById('ez-current-key');
    chrome.storage.sync.get(['modifierKey'], (result) => {
        const key = result.modifierKey || 'ctrlKey';
        currentKeyElement.textContent = keyNames[key] || keyNames['ctrlKey'];
    });
}

// === AIO Tabs ===
function initAioTabs() {
    const toggle = document.getElementById('aio-tabs-toggle');
    chrome.storage.sync.get(['aioTabsEnabled'], (result) => {
        toggle.checked = result.aioTabsEnabled !== false;
    });

    toggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ aioTabsEnabled: e.target.checked });
    });
}

// === HA Monitor ===
async function initHAMonitor() {
    const listEl = document.getElementById('ha-entity-list');
    const data = await chrome.storage.local.get(['entityResults']);
    const results = data.entityResults || {};
    const keys = Object.keys(results);

    if (keys.length === 0) {
        listEl.innerHTML = '<div class="ha-empty">未配置监控实体或暂无数据</div>';
        return;
    }

    listEl.innerHTML = keys.map(key => {
        const item = results[key];
        // 根据错误状态变更颜色
        const colorStyle = item.error ? 'color: var(--danger-color);' : '';
        return `<div class="entity-row">
          <span class="entity-name">${escapeHtml(item.name)}</span>
          <span class="entity-value" style="${colorStyle}">${escapeHtml(item.value)}</span>
      </div>`;
    }).join('');
}

// === Smart Speeder ===
function initSmartSpeeder() {
    const globalToggle = document.getElementById('speeder-global-toggle');
    const speedDisplay = document.getElementById('speeder-display');
    const decreaseBtn = document.getElementById('speeder-decrease');
    const increaseBtn = document.getElementById('speeder-increase');
    const presetBtn = document.getElementById('speeder-preset');

    let currentSpeed = 1.0;
    let settings = { globalEnabled: true, presetSpeed: 2.0 };

    chrome.runtime.sendMessage({ action: 'getSpeederSettings' }, (response) => {
        if (response) {
            settings.globalEnabled = response.globalEnabled !== false;
            settings.presetSpeed = response.presetSpeed !== undefined ? String(response.presetSpeed) : "2.0";
            settings.defaultSpeed = response.defaultSpeed || 1.0; // 需要默认速度用于单速度切回
            globalToggle.checked = settings.globalEnabled;
        }
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'getSpeed' }, (response) => {
                if (chrome.runtime.lastError) {
                    // 容错处理
                }
                if (response && response.speed !== undefined) {
                    currentSpeed = response.speed;
                }
                speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;
            });
        }
    });

    globalToggle.addEventListener('change', (e) => {
        settings.globalEnabled = e.target.checked;
        chrome.runtime.sendMessage({ action: 'saveSpeederSettings', settings }, () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'reloadSettings' });
            });
        });
    });

    const updateSpeed = (actionStr) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]) {
                chrome.tabs.sendMessage(tabs[0].id, { action: actionStr }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (response) {
                        if (actionStr === 'decreaseSpeed') currentSpeed = Math.max(currentSpeed - 0.25, 0.25);
                        else if (actionStr === 'increaseSpeed') currentSpeed = Math.min(currentSpeed + 0.25, 16.0);
                        else if (actionStr === 'presetSpeed') {
                            const speedStr = String(settings.presetSpeed || "2.0");
                            const pSpeeds = speedStr.split(/[,，]/).map(s => parseFloat(s.trim())).filter(s => !isNaN(s));
                            
                            if (pSpeeds.length === 1) {
                                // 单个速度：在预设和默认之间切换
                                if (Math.abs(currentSpeed - pSpeeds[0]) < 0.01) currentSpeed = settings.defaultSpeed || 1.0;
                                else currentSpeed = pSpeeds[0];
                            } else if (pSpeeds.length > 1) {
                                // 多个速度：轮流循环
                                let idx = pSpeeds.findIndex(s => Math.abs(currentSpeed - s) < 0.01);
                                currentSpeed = pSpeeds[(idx + 1) % pSpeeds.length];
                            }
                        }
                        speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;
                    }
                });
            }
        });
    };

    decreaseBtn.addEventListener('click', () => updateSpeed('decreaseSpeed'));
    increaseBtn.addEventListener('click', () => updateSpeed('increaseSpeed'));
    presetBtn.addEventListener('click', () => updateSpeed('presetSpeed'));
}

// === Hotkey Changer ===
function initHotkeyChanger() {
    const currentSiteEl = document.getElementById('hotkey-current-site');
    const enableToggle = document.getElementById('hotkey-enable-toggle');
    const originalInput = document.getElementById('hotkey-original');
    const newInput = document.getElementById('hotkey-new');
    const addBtn = document.getElementById('hotkey-add');
    const clearAllBtn = document.getElementById('hotkey-clear-all');
    const mappingsListEl = document.getElementById('hotkey-mappings-list');

    let currentHostname = '';
    let currentMappings = {};

    chrome.runtime.sendMessage({ type: 'GET_CURRENT_HOSTNAME' }, async (response) => {
        if (chrome.runtime.lastError || !response || !response.hostname) return;
        currentHostname = response.hostname;
        currentSiteEl.textContent = currentHostname;

        const enabledRes = await chrome.runtime.sendMessage({ type: 'GET_SITE_ENABLED', hostname: currentHostname });
        enableToggle.checked = enabledRes ? enabledRes.enabled : true;

        loadMappings();
    });

    async function loadMappings() {
        const res = await chrome.runtime.sendMessage({ type: 'GET_MAPPINGS', hostname: currentHostname });
        currentMappings = res ? (res.mappings || {}) : {};
        renderMappings();
    }

    function renderMappings() {
        const keys = Object.keys(currentMappings);
        if (keys.length === 0) {
            mappingsListEl.innerHTML = '<div style="color:#999;font-size:12px;text-align:center;padding:10px;">暂无快捷键映射</div>';
            return;
        }
        mappingsListEl.innerHTML = keys.map(orig => {
            const nw = currentMappings[orig];
            return `
        <div class="mapping-item" data-key="${escapeHtml(orig)}">
          <div class="mapping-keys">
            <span class="key-badge">${escapeHtml(orig)}</span>
            <span style="color:#999;font-size:10px;">→</span>
            <span class="key-badge">${escapeHtml(nw)}</span>
          </div>
          <button class="delete-btn" title="删除">x</button>
        </div>
      `;
        }).join('');

        mappingsListEl.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const key = e.target.closest('.mapping-item').dataset.key;
                await chrome.runtime.sendMessage({ type: 'DELETE_MAPPING', hostname: currentHostname, key });
                delete currentMappings[key];
                renderMappings();
            });
        });
    }

    enableToggle.addEventListener('change', async (e) => {
        await chrome.runtime.sendMessage({
            type: 'SET_SITE_ENABLED',
            hostname: currentHostname,
            enabled: e.target.checked
        });
    });

    function setupInput(input, nextInput) {
        input.addEventListener('focus', () => {
            input.classList.add('recording');
            input.placeholder = '请按键...';
            input.value = '';
        });
        input.addEventListener('blur', () => {
            input.classList.remove('recording');
            input.placeholder = '点击后按键';
        });
        input.addEventListener('keydown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

            const parts = [];
            if (e.ctrlKey) parts.push('Ctrl');
            if (e.altKey) parts.push('Alt');
            if (e.shiftKey) parts.push('Shift');
            if (e.metaKey) parts.push('Meta');

            let key = e.key;
            if (key === ' ') key = 'Space';
            if (key.length === 1) key = key.toUpperCase();
            parts.push(key);

            input.value = parts.join('+');
            if (nextInput) nextInput.focus();
        });
    }

    setupInput(originalInput, newInput);
    setupInput(newInput, addBtn);

    addBtn.addEventListener('click', async () => {
        const orig = originalInput.value;
        const nw = newInput.value;
        if (!orig || !nw) return;
        if (orig === nw) return;

        currentMappings[orig] = nw;
        await chrome.runtime.sendMessage({
            type: 'SAVE_MAPPINGS',
            hostname: currentHostname,
            mappings: currentMappings
        });
        originalInput.value = '';
        newInput.value = '';
        renderMappings();
    });

    clearAllBtn.addEventListener('click', async () => {
        if (Object.keys(currentMappings).length === 0) return;
        await chrome.runtime.sendMessage({ type: 'CLEAR_ALL_MAPPINGS', hostname: currentHostname });
        currentMappings = {};
        renderMappings();
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
