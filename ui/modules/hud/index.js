/**
 * HUD panel (WAQI + Home Assistant).
 *
 * Saving is deliberately split from re-scheduling: editing a field only writes
 * storage (debounced). The background worker re-arms its timers when the
 * configuration fingerprint changes, so typing a URL can no longer trigger a
 * burst of WAQI/HA requests (the old panel refetched on every keystroke).
 */
import '../shared.js';
import { schema, core, toast, formatTime, formatMetric, uiLog } from '../shared.js';

const METRIC_KEYS = ['aqi', 'o3', 'pm25', 'pm10', 'no2', 'so2', 'co', 't', 'h', 'p', 'w'];
const METRIC_NAMES = {
    aqi: 'AQI', o3: '臭氧', pm25: 'PM2.5', pm10: 'PM10', no2: 'NO2', so2: 'SO2', co: 'CO',
    t: '温度', h: '湿度', p: '气压', w: '风速'
};

export async function initHud() {
    const container = document.getElementById('ha-entity-list');
    if (!container) return;

    const settings = await schema.load();
    hydrate(settings);
    renderEntities(settings.haEntities);
    await refreshHaPermissionState();

    const debouncedSave = core.debounce(() => saveAll({ reschedule: false }), 700);

    bind(debouncedSave);
    document.getElementById('ha-add-entity')?.addEventListener('click', () => {
        addEntityRow({ name: '', id: '', op: '>', warn: '', crit: '' });
        debouncedSave();
    });

    document.getElementById('hud-save')?.addEventListener('click', async () => {
        await requestHaPermission();
        await saveAll({ reschedule: true });
        await refreshHaPermissionState();
    });

    document.getElementById('hud-test')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        await requestHaPermission();
        await saveAll({ reschedule: false });
        const result = await core.sendMessage({ type: 'hud:refresh' }, 20000);
        button.disabled = false;
        if (result && result.ok) {
            toast('已抓取 ' + (result.items || 0) + ' 项数据');
            renderLiveValues(await core.storage.getLocal(['hudState']), settings);
        } else if (result && result.reason === 'needs_permission') {
            toast('Home Assistant 地址尚未授权，请点击「授权此地址」', 'error');
        } else {
            toast('抓取失败：请检查 Token / 地址 / 网络', 'error');
        }
        await refreshHaPermissionState();
    });

    document.getElementById('ha-grant')?.addEventListener('click', async () => {
        const granted = await requestHaPermission();
        await refreshHaPermissionState();
        toast(granted ? '已授权，正在抓取…' : '未授权，Home Assistant 数据将无法读取', granted ? 'success' : 'error');
        if (granted) await core.sendMessage({ type: 'hud:updateConfig' });
    });

    document.getElementById('ha-url')?.addEventListener('change', () => refreshHaPermissionState());

    renderLiveValues(await core.storage.getLocal(['hudState']), settings);
    renderTimestamps(await core.storage.getLocal(['hudLastSuccessWaqi', 'hudLastSuccessHa', 'hudLastWaqiPubS']));

    chrome.storage.onChanged.addListener(async (changes, area) => {
        if (area !== 'local') return;
        if (changes.hudState) renderLiveValues(changes.hudState.newValue || {}, settings);
        if (changes.hudLastSuccessWaqi || changes.hudLastSuccessHa || changes.hudLastWaqiPubS) {
            renderTimestamps(await core.storage.getLocal(['hudLastSuccessWaqi', 'hudLastSuccessHa', 'hudLastWaqiPubS']));
        }
    });

    uiLog.debug('hud panel ready');
}

/* ---------------------------- host permission ---------------------------- */

function haOriginPattern() {
    const value = (document.getElementById('ha-url')?.value || '').trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)) return null;
        return url.origin + '/*';
    } catch (err) {
        return null;
    }
}

/** Ask Chrome for the HA origin. Must run inside a user gesture (button click). */
async function requestHaPermission() {
    const pattern = haOriginPattern();
    if (!pattern) return false;
    try {
        if (await chrome.permissions.contains({ origins: [pattern] })) return true;
        return await chrome.permissions.request({ origins: [pattern] });
    } catch (err) {
        return false;
    }
}

/** Show or hide the "grant access" bar depending on the current state. */
async function refreshHaPermissionState() {
    const bar = document.getElementById('ha-permission-bar');
    if (!bar) return;
    const pattern = haOriginPattern();
    let granted = true;
    if (pattern) {
        try {
            granted = await chrome.permissions.contains({ origins: [pattern] });
        } catch (err) {
            granted = false;
        }
    }
    const shouldShow = !!pattern && !granted;
    bar.hidden = !shouldShow;
    const label = document.getElementById('ha-grant');
    if (label && pattern) label.title = pattern;
}

/* ------------------------------- hydrate ------------------------------- */
function hydrate(settings) {
    const set = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
    };
    set('hud-enable', settings.hudEnabled);
    set('hud-icon-round', settings.hudIconRound);
    set('hud-carousel-interval', String(settings.hudCarouselInterval));
    set('waqi-token', settings.waqiToken);
    set('waqi-city', settings.waqiCity);
    set('waqi-refresh-rate', String(settings.waqiRefreshRate));
    for (const key of METRIC_KEYS) set('waqi-metric-' + key, settings.waqiMetrics[key]);
    set('ha-url', settings.haUrl);
    set('ha-token', settings.haToken);
    set('ha-refresh-rate', String(settings.haRefreshRate));
}

/* ------------------------------- entities ------------------------------- */
function entityValues() {
    const rows = [];
    for (const row of document.querySelectorAll('#ha-entity-list .entity-item')) {
        const id = row.querySelector('.e-id').value.trim().replace(/[\s\r\n]/g, '');
        if (!id) continue;
        rows.push({
            name: row.querySelector('.e-name').value.trim() || id,
            id,
            op: row.querySelector('.e-op').value,
            warn: row.querySelector('.e-warn').value,
            crit: row.querySelector('.e-crit').value
        });
    }
    return rows;
}

function renderEntities(entities) {
    const container = document.getElementById('ha-entity-list');
    container.replaceChildren();
    if (!entities.length) {
        const hint = document.createElement('div');
        hint.className = 'help-text';
        hint.textContent = '还没有传感器。点击下方「+ 添加传感器」，填入 Home Assistant 的实体 ID（例如 sensor.power）。';
        container.appendChild(hint);
        return;
    }
    for (const entity of entities) addEntityRow(entity);
}

function addEntityRow(entity) {
    const container = document.getElementById('ha-entity-list');
    const hint = container.querySelector('.help-text');
    if (hint) hint.remove();

    const item = document.createElement('div');
    item.className = 'entity-item';

    const main = document.createElement('div');
    main.className = 'entity-row-main';

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'e-name';
    name.placeholder = '简称（如 功率）';
    name.value = entity.name || '';

    const id = document.createElement('input');
    id.type = 'text';
    id.className = 'e-id';
    id.placeholder = 'sensor.power';
    id.value = entity.id || '';

    const value = document.createElement('span');
    value.className = 'val-tag ha-val-tag';
    value.textContent = '--';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = '移除';
    remove.style.padding = '5px 10px';
    remove.addEventListener('click', () => {
        item.remove();
        if (!container.querySelector('.entity-item')) renderEntities([]);
    });

    main.append(name, id, value, remove);

    const opts = document.createElement('div');
    opts.className = 'entity-row-opts';
    opts.append(document.createTextNode('数值'));

    const op = document.createElement('select');
    op.className = 'e-op';
    op.innerHTML = '<option value=">">&gt;</option><option value="<">&lt;</option>';
    op.value = entity.op === '<' ? '<' : '>';

    const warn = document.createElement('input');
    warn.type = 'number';
    warn.className = 'e-warn';
    warn.placeholder = '预警';
    warn.value = entity.warn || '';

    const crit = document.createElement('input');
    crit.type = 'number';
    crit.className = 'e-crit';
    crit.placeholder = '告警';
    crit.value = entity.crit || '';

    opts.append(op, warn, document.createTextNode('变橙，'), crit, document.createTextNode('变红'));

    item.append(main, opts);
    for (const input of item.querySelectorAll('input, select')) {
        input.addEventListener('change', () => {
            const event = new Event('aio:hud-dirty');
            document.dispatchEvent(event);
        });
    }
    container.appendChild(item);
}

/* -------------------------------- saving -------------------------------- */
function bind(onChange) {
    const ids = ['hud-enable', 'hud-icon-round', 'hud-carousel-interval', 'waqi-token', 'waqi-city', 'waqi-refresh-rate',
        'ha-url', 'ha-token', 'ha-refresh-rate', ...METRIC_KEYS.map((key) => 'waqi-metric-' + key)];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.addEventListener('change', onChange);
        if (el.type === 'text' || el.type === 'url' || el.type === 'password') el.addEventListener('input', onChange);
    }
    document.addEventListener('aio:hud-dirty', onChange);
}

async function saveAll({ reschedule }) {
    const metrics = {};
    for (const key of METRIC_KEYS) {
        const el = document.getElementById('waqi-metric-' + key);
        metrics[key] = !!(el && el.checked);
    }
    const patch = {
        hudEnabled: document.getElementById('hud-enable').checked,
        hudIconRound: document.getElementById('hud-icon-round').checked,
        hudCarouselInterval: parseFloat(document.getElementById('hud-carousel-interval').value),
        waqiToken: document.getElementById('waqi-token').value.trim(),
        waqiCity: document.getElementById('waqi-city').value.trim(),
        waqiRefreshRate: parseFloat(document.getElementById('waqi-refresh-rate').value),
        waqiMetrics: metrics,
        haUrl: document.getElementById('ha-url').value.trim(),
        haToken: document.getElementById('ha-token').value.trim(),
        haRefreshRate: parseFloat(document.getElementById('ha-refresh-rate').value),
        haEntities: entityValues()
    };
    await schema.save(patch);
    if (reschedule) {
        await core.sendMessage({ type: 'hud:updateConfig' });
        toast('HUD 配置已保存并重新调度');
    }
}

/* -------------------------------- display -------------------------------- */
function renderLiveValues(data, settings) {
    const state = (data && data.hudState) || {};
    for (const key of METRIC_KEYS) {
        const el = document.getElementById('val-waqi-' + key);
        if (!el) continue;
        const item = state['waqi_' + key];
        el.textContent = item ? formatMetric(item.value, settings ? settings.hudIconRound : true) : '--';
        el.style.color = item && item.error ? 'var(--danger)' : '';
        el.title = item && item.error ? '采集失败' : (METRIC_NAMES[key] || key);
    }
    for (const row of document.querySelectorAll('#ha-entity-list .entity-item')) {
        const id = row.querySelector('.e-id').value.trim().replace(/[\s\r\n]/g, '');
        const valueEl = row.querySelector('.ha-val-tag');
        const item = state['ha_' + id];
        valueEl.textContent = item ? formatMetric(item.value, settings ? settings.hudIconRound : true) : '--';
        valueEl.style.color = item && item.error ? 'var(--danger)' : '';
    }
}

function renderTimestamps(data) {
    const waqi = document.getElementById('waqi-last-success-time');
    const pub = document.getElementById('waqi-last-pub-time');
    const ha = document.getElementById('ha-last-success-time');
    if (waqi) waqi.textContent = formatTime(data.hudLastSuccessWaqi);
    if (pub) pub.textContent = data.hudLastWaqiPubS || '从未';
    if (ha) ha.textContent = formatTime(data.hudLastSuccessHa);
}
