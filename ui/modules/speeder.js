import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus, escapeHtml } from '../../libs/utils.js';

export function initSmartSpeeder() {
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
        ConfigBridge.getSpeederSettings().then((res) => {
            if (res) {
                config = {
                    globalEnabled: res.globalEnabled !== false,
                    hideFloatingBall: res.hideFloatingBall || false,
                    excludeRules: Array.isArray(res.excludeRules) ? res.excludeRules : [],
                    includeRules: Array.isArray(res.includeRules) ? res.includeRules : [],
                    defaultSpeed: res.defaultSpeed || 1.0,
                    presetSpeed: res.presetSpeed !== undefined ? String(res.presetSpeed) : "2.0"
                };
            }
            render();
        });
    }

    function render() {
        if (elements.globalToggle) elements.globalToggle.checked = config.globalEnabled;
        if (elements.hideBallToggle) elements.hideBallToggle.checked = config.hideFloatingBall;
        if (elements.defaultSpeed) elements.defaultSpeed.value = config.defaultSpeed;
        if (elements.presetSpeed) elements.presetSpeed.value = config.presetSpeed;
        renderRules(elements.includeList, config.includeRules, 'include');
        renderRules(elements.excludeList, config.excludeRules, 'exclude');
    }

    function renderRules(container, rules, type) {
        if (!container) return;
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
                saveConfig(false);
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
        saveConfig();
    }

    document.getElementById('speed-addInclude')?.addEventListener('click', () => addRule('include'));
    document.getElementById('speed-addExclude')?.addEventListener('click', () => addRule('exclude'));

    elements.includeIn?.addEventListener('keypress', e => e.key === 'Enter' && addRule('include'));
    elements.excludeIn?.addEventListener('keypress', e => e.key === 'Enter' && addRule('exclude'));

    elements.globalToggle?.addEventListener('change', e => {
        config.globalEnabled = e.target.checked;
        saveConfig(false);
        const dbSpeed = document.getElementById('db-speed-enable');
        if (dbSpeed) dbSpeed.checked = e.target.checked;
    });

    elements.hideBallToggle?.addEventListener('change', e => {
        config.hideFloatingBall = e.target.checked;
        saveConfig(false);
    });

    elements.defaultSpeed?.addEventListener('change', () => saveConfig(false));
    elements.presetSpeed?.addEventListener('change', () => saveConfig(false));

    function saveConfig(showToast = true) {
        const dSpeed = parseFloat(elements.defaultSpeed.value);
        const pSpeedStr = elements.presetSpeed.value.trim();
        if (isNaN(dSpeed) || dSpeed < 0.25 || dSpeed > 16) return showStatus('默认速度须在 0.25 - 16 之间', 'error');
        
        const pSpeeds = pSpeedStr.split(/[,，]/).map(s => parseFloat(s.trim())).filter(s => !isNaN(s));
        if (pSpeeds.length === 0) return showStatus('请输入有效的预设速度', 'error');

        config.defaultSpeed = dSpeed;
        config.presetSpeed = pSpeedStr;

        ConfigBridge.saveSpeederSettings(config).then((res) => {
            if (res && res.success) {
                if (showToast) showStatus('倍速配置已保存');
            } else if (showToast) {
                showStatus('保存失败', 'error');
            }
        });
    }

    load();
    initSpeederShortcuts();
}

function initSpeederShortcuts() {
    const defaultShortcuts = { increaseSpeed: 'Ctrl+Shift+Right', decreaseSpeed: 'Ctrl+Shift+Left', presetSpeed: 'Ctrl+Shift+Space' };
    const descMap = { increaseSpeed: '提高视频速度 (+0.25x)', decreaseSpeed: '降低视频速度 (-0.25x)', presetSpeed: '预设速度切换' };
    let current = { ...defaultShortcuts };
    let rec = null;
    const con = document.getElementById('shortcutsContainer');

    function boot() {
        ConfigBridge.sendMessage({ action: 'getSpeederShortcuts' }).then((r) => {
            current = (r && Object.keys(r).length > 0) ? { ...r } : { ...defaultShortcuts };
            build(); showText();
        });
    }

    function showText() {
        const el = document.getElementById('currentShortcuts');
        if (!el) return;
        let t = '当前设定关联的快捷键组合：';
        for (const [id, sc] of Object.entries(current)) t += ` [${descMap[id]}: ${sc}]`;
        el.textContent = t;
    }

    function build() {
        if (!con) return;
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

    document.getElementById('shortcuts-saveBtn')?.addEventListener('click', () => {
        ConfigBridge.sendMessage({ action: 'updateSpeederShortcuts', shortcuts: current }).then(() => {
            showStatus('所有拦截快捷键已下发保存！');
        });
    });

    document.getElementById('shortcuts-resetBtn')?.addEventListener('click', () => {
        if (confirm('重置所有拦截配置为系统默认版本吗？')) {
            current = { ...defaultShortcuts };
            build(); showText();
        }
    });

    boot();
}
