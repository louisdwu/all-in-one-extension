import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initHAMonitor() {
    const container = document.getElementById('ha-entity-list');
    const enableToggle = document.getElementById('ha-enable');
    const els = {
        url: document.getElementById('ha-url'),
        token: document.getElementById('ha-token'),
        rate: document.getElementById('ha-refresh-rate'),
        interval: document.getElementById('ha-carousel-interval')
    };

    if (!container) return;

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

    document.getElementById('ha-add-entity')?.addEventListener('click', () => {
        addRow();
        autoSaveHA();
    });

    function autoSaveHA() {
        const haUrl = els.url.value.trim().replace(/\/$/, "");
        const haToken = els.token.value.trim();
        const entities = getRows();

        ConfigBridge.set({
            haEnabled: enableToggle.checked,
            haUrl, haToken, entities,
            refreshRate: parseFloat(els.rate.value),
            carouselInterval: parseInt(els.interval.value)
        }).then(() => {
            ConfigBridge.sendMessage({ type: "UPDATE_CONFIG" });
            const dbHa = document.getElementById('db-ha-enable');
            if (dbHa) dbHa.checked = enableToggle.checked;
        });
    }

    enableToggle?.addEventListener('change', autoSaveHA);
    [els.url, els.token, els.rate, els.interval].forEach(el => {
        el?.addEventListener('change', autoSaveHA);
    });

    let haTimer;
    [els.url, els.token].forEach(el => {
        el?.addEventListener('input', () => {
            clearTimeout(haTimer);
            haTimer = setTimeout(autoSaveHA, 1000);
        });
    });

    ConfigBridge.get({
        haEnabled: true,
        haUrl: '', haToken: '', entities: [{ name: '功率', id: 'sensor.chuangmi_cn_406227573_212a01_electric_power_p_5_6' }],
        refreshRate: 1, carouselInterval: 3
    }).then((items) => {
        if (enableToggle) enableToggle.checked = items.haEnabled;
        if (els.url) els.url.value = items.haUrl;
        if (els.token) els.token.value = items.haToken;
        if (els.rate) els.rate.value = items.refreshRate;
        if (els.interval) els.interval.value = items.carouselInterval;
        container.innerHTML = '';
        items.entities.forEach(e => addRow(e.name, e.id));
    });

    document.getElementById('ha-test')?.addEventListener('click', async () => {
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
