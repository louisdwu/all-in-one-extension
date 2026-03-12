document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    initDashboard(); // 新增 Dashboard 初始化
    initAioTabs();
    initEZIncognito();
    initSmartSpeeder();
    initHAMonitor();
    initHotkeyPanel();
    initGlobalBackup();
    initBilibiliSubtitles();
    setupSync();     // 新增全量同步逻辑
});

// ==== Toast Notification ====
function showStatus(message, type = 'success') {
    const el = document.getElementById('statusMessage');
    el.textContent = message;
    el.className = `status-msg show ${type}`;
    setTimeout(() => el.classList.remove('show'), 3000);
}

// ==== Sidebar Navigation ====
function setupTabs() {
    const navItems = document.querySelectorAll('.nav li');
    const panes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            const targetId = item.dataset.target;
            document.getElementById(targetId).classList.add('active');
        });
    });
}

// ==== Dashboard & Sync ====
function initDashboard() {
    // 卡片点击跳转逻辑
    document.querySelectorAll('.dash-card[data-nav-target]').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            // 如果点击的是开关区域，则不触发跳转
            if (e.target.closest('.toggle')) return;
            const targetId = card.dataset.navTarget;
            const navItem = document.querySelector(`.nav li[data-target="${targetId}"]`);
            if (navItem) navItem.click();
        });
    });

    const keys = {
        'db-aiotabs-enable': 'aioTabsEnabled',
        'db-ez-enable': 'ezEnabled',
        'db-hotkey-enable': 'hotkeyEnabled',
        'db-ha-enable': 'haEnabled'
    };

    // 初始化状态
    chrome.storage.sync.get(Object.values(keys), (res) => {
        for (const [id, key] of Object.entries(keys)) {
            const el = document.getElementById(id);
            if (el) el.checked = res[key] !== false;
        }
    });

    // 绑定事件
    for (const [id, key] of Object.entries(keys)) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const update = {};
                update[key] = e.target.checked;
                chrome.storage.sync.set(update);
                if (key === 'haEnabled') chrome.runtime.sendMessage({ type: "UPDATE_CONFIG" });
            });
        }
    }

    // Smart Speeder 专用 (因为它涉及复杂的 config 对象)
    const dbSpeed = document.getElementById('db-speed-enable');
    chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
        if (dbSpeed && res) dbSpeed.checked = res.globalEnabled !== false;
    });

    dbSpeed.addEventListener('change', (e) => {
        chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
            if (res) {
                res.globalEnabled = e.target.checked;
                chrome.runtime.sendMessage({ action: 'saveSettings', settings: res });
            }
        });
    });

    // Bilibili Subtitles Dashboard Toggle
    const dbBili = document.getElementById('db-bili-enable');
    chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
        if (dbBili && res && res.bilibiliSubtitles) {
            dbBili.checked = res.bilibiliSubtitles.autoEnableSubtitle !== false;
        }
    });

    dbBili.addEventListener('change', (e) => {
        chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
            if (res && res.bilibiliSubtitles) {
                res.bilibiliSubtitles.autoEnableSubtitle = e.target.checked;
                chrome.runtime.sendMessage({ action: 'saveBilibiliSettings', settings: res.bilibiliSubtitles });
                // 同时触发全量同步用的 storage key
                chrome.storage.sync.set({ biliAutoSubtitle: e.target.checked });
            }
        });
    });
}

function setupSync() {
    // 监听 storage 变化，自动同步所有相关 checkbox
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;

        const syncMap = {
            aioTabsEnabled: ['aiotabs-enable', 'db-aiotabs-enable'],
            ezEnabled: ['ez-enable', 'db-ez-enable'],
            hotkeyEnabled: ['hotkey-enable', 'db-hotkey-enable'],
            haEnabled: ['ha-enable', 'db-ha-enable'],
            biliAutoSubtitle: ['bili-autoSubtitle', 'db-bili-enable']
        };

        for (const [key, ids] of Object.entries(syncMap)) {
            if (changes[key]) {
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.checked = changes[key].newValue !== false;
                });
            }
        }

        // Smart Speeder sync (通过监听全局 config 会比较复杂，故监听 reloadSettings)
    });

    // 专门针对 Smart Speeder 的同步
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'reloadSettings') {
            chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
                const dbSpeed = document.getElementById('db-speed-enable');
                const pageSpeed = document.getElementById('speed-globalToggle');
                if (dbSpeed && res) dbSpeed.checked = res.globalEnabled !== false;
                if (pageSpeed && res) pageSpeed.checked = res.globalEnabled !== false;
            });
        }
    });
}

// ==== AIO Tabs ====
function initAioTabs() {
    const toggle = document.getElementById('aiotabs-enable');

    chrome.storage.sync.get(['aioTabsEnabled'], (res) => {
        // 默认为 true
        toggle.checked = res.aioTabsEnabled !== false;
    });

    toggle.addEventListener('change', (e) => {
        chrome.storage.sync.set({ aioTabsEnabled: e.target.checked }, () => {
            showStatus('右键切换功能状态已保存！');
        });
    });
}

// ==== EZ Incognito ====
function initEZIncognito() {
    const enableToggle = document.getElementById('ez-enable');
    const select = document.getElementById('ez-modifier-key');

    chrome.storage.sync.get({ ezEnabled: true, modifierKey: 'ctrlKey' }, (res) => {
        enableToggle.checked = res.ezEnabled;
        select.value = res.modifierKey;
    });

    enableToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ ezEnabled: enableToggle.checked }, () => {
            showStatus('无痕按键主开关已更新！');
        });
    });

    select.addEventListener('change', () => {
        chrome.storage.sync.set({ modifierKey: select.value }, () => {
            showStatus('无痕按键修饰键已保存！');
        });
    });
}

// ==== Smart Speeder ====
function initSmartSpeeder() {
    const elements = {
        globalToggle: document.getElementById('speed-globalToggle'),
        hideBallToggle: document.getElementById('speed-hideBallToggle'),
        defaultSpeed: document.getElementById('speed-defaultSpeed'),
        presetSpeed: document.getElementById('speed-presetSpeed'),
        includeIn: document.getElementById('speed-includeRuleInput'),
        excludeIn: document.getElementById('speed-excludeRuleInput'),
        includeList: document.getElementById('speed-includeList'),
        excludeList: document.getElementById('speed-excludeList'),
    };

    let config = {
        globalEnabled: true, hideFloatingBall: false,
        excludeRules: [], includeRules: [],
        defaultSpeed: 1.0, presetSpeed: 2.0
    };

    function load() {
        chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
            if (res) {
                config = {
                    globalEnabled: res.globalEnabled !== false,
                    hideFloatingBall: res.hideFloatingBall || false,
                    excludeRules: Array.isArray(res.excludeRules) ? res.excludeRules : [],
                    includeRules: Array.isArray(res.includeRules) ? res.includeRules : [],
                    defaultSpeed: res.defaultSpeed || 1.0,
                    presetSpeed: res.presetSpeed || 2.0
                };
            }
            render();
        });
    }

    function render() {
        elements.globalToggle.checked = config.globalEnabled;
        elements.hideBallToggle.checked = config.hideFloatingBall;
        elements.defaultSpeed.value = config.defaultSpeed;
        elements.presetSpeed.value = config.presetSpeed;
        renderRules(elements.includeList, config.includeRules, 'include');
        renderRules(elements.excludeList, config.excludeRules, 'exclude');
    }

    function renderRules(container, rules, type) {
        if (!rules || rules.length === 0) {
            container.innerHTML = '<div style="padding:10px;text-align:center;color:#999;font-size:12px;">暂无该类型规则</div>';
            return;
        }
        container.innerHTML = rules.map((r, i) => `
      <div class="rule-item">
        <span>${escapeHtml(r)}</span>
        <button class="rule-btn" data-type="${type}" data-index="${i}">删除</button>
      </div>
    `).join('');

        container.querySelectorAll('.rule-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index);
                const t = e.target.dataset.type;
                if (t === 'include') config.includeRules.splice(idx, 1);
                else config.excludeRules.splice(idx, 1);
                render();
            });
        });
    }

    function addRule(type) {
        const input = type === 'include' ? elements.includeIn : elements.excludeIn;
        const rule = input.value.trim();
        if (!rule) return showStatus('请输入规则', 'error');
        try { new RegExp(rule); } catch (e) { return showStatus('无效正则表达式', 'error'); }

        if (type === 'include' && !config.includeRules.includes(rule)) config.includeRules.push(rule);
        if (type === 'exclude' && !config.excludeRules.includes(rule)) config.excludeRules.push(rule);
        input.value = '';
        render();
    }

    document.getElementById('speed-addInclude').addEventListener('click', () => addRule('include'));
    document.getElementById('speed-addExclude').addEventListener('click', () => addRule('exclude'));

    elements.includeIn.addEventListener('keypress', e => e.key === 'Enter' && addRule('include'));
    elements.excludeIn.addEventListener('keypress', e => e.key === 'Enter' && addRule('exclude'));

    elements.globalToggle.addEventListener('change', e => {
        config.globalEnabled = e.target.checked;
        saveConfig(false);
        // 同步到 Dashboard
        const dbSpeed = document.getElementById('db-speed-enable');
        if (dbSpeed) dbSpeed.checked = e.target.checked;
    });
    elements.hideBallToggle.addEventListener('change', e => {
        config.hideFloatingBall = e.target.checked;
        saveConfig(false);
    });
    elements.defaultSpeed.addEventListener('change', () => saveConfig(false));
    elements.presetSpeed.addEventListener('change', () => saveConfig(false));

    function saveConfig(showToast = true) {
        const dSpeed = parseFloat(elements.defaultSpeed.value);
        const pSpeed = parseFloat(elements.presetSpeed.value);
        if (isNaN(dSpeed) || dSpeed < 0.25 || dSpeed > 16) return showStatus('速度须在 0.25 - 16 之间', 'error');
        if (isNaN(pSpeed) || pSpeed < 0.25 || pSpeed > 16) return showStatus('速度须在 0.25 - 16 之间', 'error');

        config.defaultSpeed = dSpeed;
        config.presetSpeed = pSpeed;

        chrome.runtime.sendMessage({ action: 'saveSettings', settings: config }, (res) => {
            if (res && res.success) {
                if (showToast) showStatus('倍速配置已保存');
            } else if (showToast) {
                showStatus('保存失败', 'error');
            }
        });
    }

    // 移除旧的保存按钮监听，改为内部自动调用

    function saveConfig() {
        const dSpeed = parseFloat(elements.defaultSpeed.value);
        const pSpeed = parseFloat(elements.presetSpeed.value);
        if (isNaN(dSpeed) || dSpeed < 0.25 || dSpeed > 16) return showStatus('速度须在 0.25 - 16 之间', 'error');
        if (isNaN(pSpeed) || pSpeed < 0.25 || pSpeed > 16) return showStatus('速度须在 0.25 - 16 之间', 'error');

        config.defaultSpeed = dSpeed;
        config.presetSpeed = pSpeed;

        chrome.runtime.sendMessage({ action: 'saveSettings', settings: config }, (res) => {
            if (res && res.success) showStatus('倍速配置已保存');
            else showStatus('保存失败', 'error');
        });
    }

    // 移除冗余的 reset 监听（已移至全局备份页）

    // 移除冗余的导出导入监听（已由全局备份中心统一管理）

    load();
    initSpeederShortcuts();
}

// ==== Speeder Shortcuts Config ====
function initSpeederShortcuts() {
    const defaultShortcuts = { increaseSpeed: 'Ctrl+Shift+Right', decreaseSpeed: 'Ctrl+Shift+Left', presetSpeed: 'Ctrl+Shift+Space' };
    const descMap = { increaseSpeed: '提高视频速度 (+0.25x)', decreaseSpeed: '降低视频速度 (-0.25x)', presetSpeed: '预设速度切换' };
    let current = { ...defaultShortcuts };
    let rec = null;
    const con = document.getElementById('shortcutsContainer');

    function boot() {
        chrome.runtime.sendMessage({ action: 'getShortcuts' }, (r) => {
            current = (r && Object.keys(r).length > 0) ? { ...r } : { ...defaultShortcuts };
            build(); showText();
        });
    }

    function showText() {
        let t = '当前设定关联的快捷键组合：';
        for (const [id, sc] of Object.entries(current)) t += ` [${descMap[id]}: ${sc}]`;
        document.getElementById('currentShortcuts').textContent = t;
    }

    function build() {
        con.innerHTML = '';
        for (const [id, d] of Object.entries(descMap)) {
            const el = document.createElement('div');
            el.className = 'shortcut-item';
            el.innerHTML = `
                <div class="shortcut-label"><span>${d}</span><span class="key-badge">${current[id]}</span></div>
                <div class="shortcut-input-group">
                    <input type="text" class="shortcut-input" id="in-${id}" placeholder="点击以录制.." readonly value="${current[id]}">
                    <button class="secondary" id="rec-${id}">录制</button>
                </div>
            `;
            con.appendChild(el);

            const btn = el.querySelector(`#rec-${id}`), inp = el.querySelector(`#in-${id}`);
            inp.addEventListener('click', () => startLog(id, inp, btn));
            btn.addEventListener('click', () => startLog(id, inp, btn));
        }
    }

    function startLog(id, inp, btn) {
        if (rec) stopLog();
        rec = { id, inp, btn };
        inp.value = '正在倾听按键...'; inp.classList.add('recording');
        btn.textContent = '停止';
        document.addEventListener('keydown', handleKey, true);
    }

    function stopLog() {
        if (!rec) return;
        rec.inp.classList.remove('recording'); rec.btn.textContent = '录制';
        rec.inp.value = current[rec.id];
        document.removeEventListener('keydown', handleKey, true);
        rec = null;
    }

    function handleKey(e) {
        if (!rec) return;
        e.preventDefault(); e.stopPropagation();
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

        let p = [];
        if (e.ctrlKey) p.push('Ctrl');
        if (e.altKey) p.push('Alt');
        if (e.shiftKey) p.push('Shift');
        if (e.metaKey) p.push('Meta');

        let k = e.key;
        if (k === ' ') k = 'Space';
        else if (k.length === 1) k = k.toUpperCase();
        p.push(k);
        const code = p.join('+');

        if (p.length < 2) { showStatus('必须由至少一个修饰键与字母组成', 'error'); return; }

        current[rec.id] = code;
        rec.inp.value = code;
        showStatus('快捷配置录入成功: ' + code);
        stopLog(); showText();
    }

    document.getElementById('shortcuts-saveBtn').addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: 'updateShortcuts', shortcuts: current }, () => {
            showStatus('所有拦截快捷键已下发保存！');
        });
    });

    document.getElementById('shortcuts-resetBtn').addEventListener('click', () => {
        if (confirm('重置所有拦截配置为系统默认版本吗？')) {
            current = { ...defaultShortcuts };
            build(); showText();
        }
    });

    boot();
}

// ==== HA Monitor ====
function initHAMonitor() {
    const container = document.getElementById('ha-entity-list');
    const enableToggle = document.getElementById('ha-enable');
    const els = {
        url: document.getElementById('ha-url'),
        token: document.getElementById('ha-token'),
        rate: document.getElementById('ha-refresh-rate'),
        interval: document.getElementById('ha-carousel-interval')
    };

    function addRow(name = '', id = '') {
        const item = document.createElement('div');
        item.className = 'entity-item';
        item.innerHTML = `
            <input type="text" class="e-name" placeholder="显示简称 (例: 功率)" value="${name}" style="flex:1;">
            <input type="text" class="e-id" placeholder="Entity ID (例: sensor.power)" value="${id}" style="flex:2;">
            <button class="danger btn-remove">移除</button>
        `;
        item.querySelector('.btn-remove').addEventListener('click', () => {
            item.remove();
            autoSaveHA();
        });

        // 绑定输入框的变化实时保存
        item.querySelectorAll('input').forEach(input => {
            input.addEventListener('change', autoSaveHA);
        });

        container.appendChild(item);
    }

    function getRows() {
        const entities = [];
        container.querySelectorAll('.entity-item').forEach(el => {
            const name = el.querySelector('.e-name').value.trim();
            const id = el.querySelector('.e-id').value.trim().replace(/[\s\r\n]/g, '');
            if (id) entities.push({ name: name || id, id });
        });
        return entities;
    }

    document.getElementById('ha-add-entity').addEventListener('click', () => {
        addRow();
        autoSaveHA();
    });

    function autoSaveHA() {
        const haUrl = els.url.value.trim().replace(/\/$/, "");
        const haToken = els.token.value.trim();
        const entities = getRows();

        chrome.storage.sync.set({
            haEnabled: enableToggle.checked,
            haUrl, haToken, entities,
            refreshRate: parseFloat(els.rate.value),
            carouselInterval: parseInt(els.interval.value)
        }, () => {
            chrome.runtime.sendMessage({ type: "UPDATE_CONFIG" });
            // 同步到 Dashboard
            const dbHa = document.getElementById('db-ha-enable');
            if (dbHa) dbHa.checked = enableToggle.checked;
        });
    }

    enableToggle.addEventListener('change', autoSaveHA);
    [els.url, els.token, els.rate, els.interval].forEach(el => {
        el.addEventListener('change', autoSaveHA);
    });

    // 延迟保存逻辑
    let haTimer;
    [els.url, els.token].forEach(el => {
        el.addEventListener('input', () => {
            clearTimeout(haTimer);
            haTimer = setTimeout(autoSaveHA, 1000);
        });
    });

    // Load
    chrome.storage.sync.get({
        haEnabled: true,
        haUrl: '', haToken: '', entities: [{ name: '功率', id: 'sensor.chuangmi_cn_406227573_212a01_electric_power_p_5_6' }],
        refreshRate: 1, carouselInterval: 3
    }, (items) => {
        enableToggle.checked = items.haEnabled;
        els.url.value = items.haUrl;
        els.token.value = items.haToken;
        els.rate.value = items.refreshRate;
        els.interval.value = items.carouselInterval;
        container.innerHTML = '';
        items.entities.forEach(e => addRow(e.name, e.id));
    });

    document.getElementById('ha-test').addEventListener('click', async () => {
        const haUrl = els.url.value.trim().replace(/\/$/, "");
        const haToken = els.token.value.trim().replace(/[\s\r\n]/g, '');
        const entities = getRows();

        if (!haUrl || !haToken || entities.length === 0) return showStatus('信息不全，无法测试', 'error');

        showStatus('正在连接 HA 测试...', 'success');
        let results = [];
        for (const e of entities) {
            try {
                const res = await fetch(`${haUrl}/api/states/${e.id}`, { 
                    headers: { 'Authorization': `Bearer ${haToken}`, 'Content-Type': 'application/json' } 
                });
                if (!res.ok) results.push(`${e.name}: HTTP ${res.status}`);
                else {
                    const data = await res.json();
                    results.push(`${e.name}: OK (${data.state})`);
                }
            } catch (err) {
                results.push(`${e.name}: 失败`);
            }
        }
        const hasErr = results.some(r => r.includes('HTTP') || r.includes('失败'));
        showStatus(results.join(' | '), hasErr ? 'error' : 'success');
    });
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function initHotkeyPanel() {
    const container = document.getElementById('hotkey-options-container');
    const enableToggle = document.getElementById('hotkey-enable');

    chrome.storage.sync.get({ hotkeyEnabled: true }, (res) => {
        enableToggle.checked = res.hotkeyEnabled;
    });

    enableToggle.addEventListener('change', () => {
        chrome.storage.sync.set({ hotkeyEnabled: enableToggle.checked }, () => {
            showStatus('快捷键映射开关已更新！');
        });
    });

    function loadHotkeys() {
        chrome.storage.sync.get(['hotkeyMappings'], (res) => {
            const allMappings = res.hotkeyMappings || {};
            const domains = Object.keys(allMappings);

            if (domains.length === 0) {
                container.innerHTML = '<div style="padding: 20px; text-align: center; color: #94a3b8;">暂无任何网页映射数据。您可以点击网页右上角的插件图标，在需要替换快捷键的网站上进行直接添加。</div>';
                return;
            }

            container.innerHTML = '';

            domains.forEach(domain => {
                const mapData = allMappings[domain];
                if (!mapData || Object.keys(mapData).length === 0) return;

                const block = document.createElement('div');
                block.className = 'hk-site-block';
                block.innerHTML = `
                    <div class="hk-site-header">
                        <div class="hk-site-domain">${domain}</div>
                        <button class="hk-del-site">清空此网站</button>
                    </div>
                `;

                block.querySelector('.hk-del-site').addEventListener('click', () => {
                    if (confirm(`确定要清空 ${domain} 的所有映射吗？`)) {
                        delete allMappings[domain];
                        chrome.storage.sync.set({ hotkeyMappings: allMappings }, () => {
                            showStatus(`已清空 ${domain} 映射记录`);
                            loadHotkeys();
                        });
                    }
                });

                for (const [origKey, newKey] of Object.entries(mapData)) {
                    const row = document.createElement('div');
                    row.className = 'hk-map-row';
                    row.innerHTML = `
                        <div class="hk-key-group">
                            <span class="hk-key-badge">${origKey}</span>
                            <span class="hk-arrow">→</span>
                            <span class="hk-key-badge">${newKey}</span>
                        </div>
                        <button class="hk-del-btn">删除</button>
                    `;

                    row.querySelector('.hk-del-btn').addEventListener('click', () => {
                        delete mapData[origKey];
                        chrome.storage.sync.set({ hotkeyMappings: allMappings }, () => {
                            showStatus('键位映射已删除');
                            loadHotkeys();
                        });
                    });

                    block.appendChild(row);
                }
                container.appendChild(block);
            });
        });
    }

    loadHotkeys();
}

// ==== Global Backup ====
function initGlobalBackup() {
    const exportBtn = document.getElementById('backup-export-btn');
    const importBtn = document.getElementById('backup-import-btn'); // 修复：补充声明
    const importFile = document.getElementById('backup-import-file');
    const resetBtn = document.getElementById('backup-reset-btn');

    // 导出逻辑
    exportBtn.addEventListener('click', () => {
        chrome.storage.sync.get(null, (items) => {
            const backupData = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                client: 'AIO All-in-One Settings',
                data: items
            };

            const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `aio-full-backup-${new Date().toISOString().split('T')[0]}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showStatus('全量配置文件已导出！');
        });
    });

    // 导入按钮点击
    importBtn.addEventListener('click', () => importFile.click());

    // 导入逻辑执行
    importFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const backup = JSON.parse(event.target.result);
                
                // 基本合规性检查
                if (!backup.data || typeof backup.data !== 'object') {
                    throw new Error('备份文件格式不正确 (找不到 data 节点)');
                }

                if (confirm('确定要导入此备份吗？这将覆盖所有现有的插件配置！导入完成后页面将自动刷新。')) {
                    // 清空并写入所有 sync 数据
                    chrome.storage.sync.clear(() => {
                        chrome.storage.sync.set(backup.data, () => {
                            showStatus('备份数据已导入，正在同步中...', 'success');
                            
                            // 通知各模块重载 (如果需要通过 runtime 广播)
                            chrome.runtime.sendMessage({ action: 'reloadSettings' }); // 通知 Smart Speeder
                            chrome.runtime.sendMessage({ type: "UPDATE_CONFIG" });     // 通知 HA Monitor
                            
                            // 延时刷新页面，确保 storage 写入完成
                            setTimeout(() => {
                                window.location.reload();
                            }, 1000);
                        });
                    });
                }
            } catch (err) {
                console.error('Import error:', err);
                showStatus('导入失败: ' + err.message, 'error');
            }
            // 清空 input 方便下次选择同名文件
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    // 恢复出厂设置逻辑
    resetBtn.addEventListener('click', () => {
        if (confirm('🚨 确定要恢复出厂设置吗？这将清空所有模块的配置、规则和快捷键映射！此操作不可恢复。')) {
            chrome.storage.sync.clear(() => {
                chrome.storage.local.clear(() => {
                    showStatus('已成功恢复出厂默认设置', 'success');
                    chrome.runtime.sendMessage({ action: 'reloadSettings' });
                    chrome.runtime.sendMessage({ type: "UPDATE_CONFIG" });
                    setTimeout(() => window.location.reload(), 1500);
                });
            });
        }
    });
}

// ==== Bilibili Subtitles ====
function initBilibiliSubtitles() {
    const autoToggle = document.getElementById('bili-autoSubtitle');
    const hotkeyInput = document.getElementById('bili-subtitleHotkey');
    const saveBtn = document.getElementById('bili-saveBtn');

    let config = {
        autoEnableSubtitle: true,
        subtitleHotkey: 's'
    };

    function load() {
        chrome.runtime.sendMessage({ action: 'getSettings' }, (res) => {
            if (res && res.bilibiliSubtitles) {
                config = res.bilibiliSubtitles;
            }
            autoToggle.checked = config.autoEnableSubtitle;
            hotkeyInput.value = config.subtitleHotkey;
        });
    }

    // 处理单按键录入
    function setupHotkeyRecording() {
        let isRecording = false;

        hotkeyInput.addEventListener('click', () => {
            if (isRecording) return;
            isRecording = true;
            hotkeyInput.value = '正在倾听按键... (按 Esc 取消)';
            hotkeyInput.style.background = '#fff3cd';

            const handleKey = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (e.key === 'Escape') {
                    stopRecording();
                    return;
                }

                // 允许控制键，但不单独作为快捷键（除非是单按键逻辑）
                // 用户要求单按键 s，所以我们支持任何非修饰键作为主键
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

                let p = [];
                if (e.ctrlKey) p.push('Ctrl');
                if (e.altKey) p.push('Alt');
                if (e.shiftKey) p.push('Shift');
                if (e.metaKey) p.push('Meta');

                let k = e.key;
                if (k === ' ') k = 'Space';
                else if (k.length === 1) k = k.toUpperCase();
                p.push(k);

                const code = p.join('+');
                hotkeyInput.value = code;
                config.subtitleHotkey = code;
                stopRecording();
            };

            const stopRecording = () => {
                isRecording = false;
                hotkeyInput.style.background = '#f8f9fa';
                document.removeEventListener('keydown', handleKey, true);
                if (hotkeyInput.value === '正在倾听按键... (按 Esc 取消)') {
                    hotkeyInput.value = config.subtitleHotkey;
                }
            };

            document.addEventListener('keydown', handleKey, true);
        });
    }

    saveBtn.addEventListener('click', () => {
        config.autoEnableSubtitle = autoToggle.checked;
        config.subtitleHotkey = hotkeyInput.value;

        chrome.runtime.sendMessage({
            action: 'saveBilibiliSettings',
            settings: config
        }, (res) => {
            if (res && res.success) {
                showStatus('B站字幕配置已保存！');
                // 同步到 Dashboard
                const dbToggle = document.getElementById('db-bili-enable');
                if (dbToggle) dbToggle.checked = config.autoEnableSubtitle;
            } else {
                showStatus('保存失败', 'error');
            }
        });
    });

    // 监听开关变化实时保存（类似其他模块）
    autoToggle.addEventListener('change', () => {
        config.autoEnableSubtitle = autoToggle.checked;
        chrome.runtime.sendMessage({
            action: 'saveBilibiliSettings',
            settings: config
        }, () => {
            const dbToggle = document.getElementById('db-bili-enable');
            if (dbToggle) dbToggle.checked = config.autoEnableSubtitle;
            // 通知 storage 以触发 setupSync 里的变化监听
            chrome.storage.sync.set({ biliAutoSubtitle: config.autoEnableSubtitle });
        });
    });

    load();
    setupHotkeyRecording();
}
