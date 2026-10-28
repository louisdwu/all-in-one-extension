/**
 * Video speeder panel: base behaviour, page hotkeys, URL rules.
 */
import './shared.js';
import { schema, toast, uiLog } from './shared.js';

const RULE_FIELDS = {
    include: { list: 'speed-includeList', input: 'speed-includeRuleInput', key: 'includeRules' },
    exclude: { list: 'speed-excludeList', input: 'speed-excludeRuleInput', key: 'excludeRules' }
};

export async function initSpeeder() {
    let settings = await schema.load();
    hydrate(settings);
    bindBaseFields();
    initShortcutEditor(settings);
    bindRules();
    uiLog.debug('speeder panel ready');
}

function hydrate(settings) {
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
    };
    set('speed-globalToggle', settings.globalEnabled);
    set('speed-hideBallToggle', settings.hideFloatingBall);
    set('speed-memory', settings.speederSpeedMemory);
    set('speed-defaultSpeed', settings.defaultSpeed);
    set('speed-presetSpeed', settings.presetSpeed);
    set('speed-step', settings.speederStep);
    set('speed-minRate', settings.speederMinRate);
    set('speed-maxRate', settings.speederMaxRate);

    renderRules('include', settings.includeRules);
    renderRules('exclude', settings.excludeRules);
}

function bindBaseFields() {
    const save = document.getElementById('speed-saveBtn');
    save?.addEventListener('click', async () => {
        const defaultSpeed = parseFloat(document.getElementById('speed-defaultSpeed').value);
        const minRate = parseFloat(document.getElementById('speed-minRate').value);
        const maxRate = parseFloat(document.getElementById('speed-maxRate').value);
        if (!isFinite(defaultSpeed) || defaultSpeed < 0.25 || defaultSpeed > 16) {
            return toast('默认速度需在 0.25 – 16 之间', 'error');
        }
        if (!isFinite(minRate) || !isFinite(maxRate) || minRate >= maxRate) {
            return toast('最低速度必须小于最高速度', 'error');
        }
        await schema.save({
            globalEnabled: document.getElementById('speed-globalToggle').checked,
            hideFloatingBall: document.getElementById('speed-hideBallToggle').checked,
            speederSpeedMemory: document.getElementById('speed-memory').value,
            defaultSpeed,
            presetSpeed: document.getElementById('speed-presetSpeed').value,
            speederStep: parseFloat(document.getElementById('speed-step').value) || 0.25,
            speederMinRate: minRate,
            speederMaxRate: maxRate
        });
        toast('倍速设置已保存');
    });
}

/* ------------------------------ rules ------------------------------ */
function renderRules(type, rules) {
    const field = RULE_FIELDS[type];
    const container = document.getElementById(field.list);
    if (!container) return;
    if (!rules || !rules.length) {
        container.innerHTML = '<div class="rule-item" style="justify-content:center;color:var(--text-muted)">暂无规则</div>';
        return;
    }
    container.replaceChildren(...rules.map((rule, index) => {
        const row = document.createElement('div');
        row.className = 'rule-item';
        const text = document.createElement('span');
        text.textContent = rule;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'rule-btn';
        remove.textContent = '删除';
        remove.addEventListener('click', () => removeRule(type, index));
        row.append(text, remove);
        return row;
    }));
}

async function removeRule(type, index) {
    const field = RULE_FIELDS[type];
    const settings = await schema.load();
    const next = settings[field.key].slice();
    next.splice(index, 1);
    await schema.save({ [field.key]: next });
    renderRules(type, next);
    toast('规则已删除');
}

async function addRule(type) {
    const field = RULE_FIELDS[type];
    const input = document.getElementById(field.input);
    const value = (input?.value || '').trim();
    if (!value) return toast('请输入规则', 'error');
    try {
        new RegExp(value);
    } catch (err) {
        return toast('无效的正则表达式：' + err.message, 'error');
    }
    const settings = await schema.load();
    const next = settings[field.key].slice();
    if (next.includes(value)) return toast('该规则已存在', 'error');
    next.push(value);
    await schema.save({ [field.key]: next });
    if (input) input.value = '';
    renderRules(type, next);
    toast('规则已添加');
}

function bindRules() {
    // The memory mode applies immediately (no need to press save).
    document.getElementById('speed-memory')?.addEventListener('change', async (event) => {
        await schema.save({ speederSpeedMemory: event.target.value });
        toast({ site: '已改为按网站记住速度', global: '已改为全局记住速度', off: '已关闭速度记忆' }[event.target.value] || '已保存');
    });

    document.getElementById('speed-addInclude')?.addEventListener('click', () => addRule('include'));
    document.getElementById('speed-addExclude')?.addEventListener('click', () => addRule('exclude'));
    for (const [type, field] of Object.entries(RULE_FIELDS)) {
        document.getElementById(field.input)?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                addRule(type);
            }
        });
    }
}

/* ---------------------------- shortcuts ---------------------------- */
const SHORTCUT_LABELS = {
    increaseSpeed: '加速（+步长）',
    decreaseSpeed: '减速（−步长）',
    presetSpeed: '切换预设速度'
};

function initShortcutEditor(initial) {
    let current = Object.assign({}, initial.shortcuts);
    const container = document.getElementById('shortcutsContainer');
    const summary = document.getElementById('currentShortcuts');

    function renderSummary() {
        if (!summary) return;
        summary.textContent = Object.entries(SHORTCUT_LABELS)
            .map(([action, label]) => label + '：' + (current[action] || '未设置'))
            .join('   |   ');
    }

    function render() {
        if (!container) return;
        container.replaceChildren(...Object.entries(SHORTCUT_LABELS).map(([action, label]) => {
            const item = document.createElement('div');
            item.className = 'shortcut-item';

            const head = document.createElement('div');
            head.className = 'shortcut-label';
            const name = document.createElement('span');
            name.textContent = label;
            const badge = document.createElement('span');
            badge.className = 'key-badge';
            badge.textContent = current[action] || '未设置';
            head.append(name, badge);

            const group = document.createElement('div');
            group.className = 'shortcut-input-group';
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'shortcut-input';
            input.readOnly = true;
            input.value = current[action] || '';
            input.setAttribute('aria-label', label + ' 快捷键');
            input.addEventListener('focus', () => startRecording(action, input, badge));
            input.addEventListener('blur', () => stopRecording(input));
            group.appendChild(input);

            item.append(head, group);
            return item;
        }));
        renderSummary();
    }

    let recording = null;
    function startRecording(action, input, badge) {
        stopRecording();
        recording = { action, input, badge };
        input.value = '请按下组合键…';
        input.classList.add('recording');
        document.addEventListener('keydown', captureKey, true);
    }

    function stopRecording(input) {
        if (!recording) return;
        recording.input.classList.remove('recording');
        recording.input.value = current[recording.action] || '';
        document.removeEventListener('keydown', captureKey, true);
        recording = null;
    }

    function captureKey(event) {
        if (!recording) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
            stopRecording();
            return;
        }
        const combo = globalThis.AIO.keys.serialize(event);
        if (!globalThis.AIO.keys.isValid(combo)) {
            toast('必须包含至少一个修饰键（Ctrl / Alt / Shift / Meta）', 'error');
            return;
        }
        current[recording.action] = combo;
        recording.badge.textContent = combo;
        stopRecording();
        renderSummary();
    }

    document.getElementById('shortcuts-saveBtn')?.addEventListener('click', async () => {
        await schema.save({ shortcuts: current });
        toast('页面内快捷键已保存');
    });

    document.getElementById('shortcuts-resetBtn')?.addEventListener('click', async () => {
        current = Object.assign({}, schema.DEFAULT_SHORTCUTS);
        await schema.save({ shortcuts: current });
        render();
        toast('已恢复默认快捷键');
    });

    render();
}
