/**
 * Hotkey remapping panel — lists every per-site mapping.
 */
import './shared.js';
import { schema, toast } from './shared.js';

export async function initHotkeys() {
    const toggle = document.getElementById('hotkey-enable');
    const container = document.getElementById('hotkey-options-container');
    if (!container) return;

    const settings = await schema.load();
    if (toggle) toggle.checked = settings.hotkeyEnabled !== false;
    toggle?.addEventListener('change', async () => {
        await schema.save({ hotkeyEnabled: toggle.checked });
        toast(toggle.checked ? '快捷键映射已启用' : '快捷键映射已关闭');
    });

    await render();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && (changes.hotkeyMappings || changes.enabledSites || changes.hotkeyEnabled)) render();
    });
}

async function render() {
    const container = document.getElementById('hotkey-options-container');
    const settings = await schema.load();
    const mappings = settings.hotkeyMappings || {};
    const sites = Object.keys(mappings).filter((site) => Object.keys(mappings[site]).length);

    if (!sites.length) {
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">' +
            '还没有任何映射。点击浏览器工具栏中的扩展图标，在弹窗里为当前网站添加按键映射。</div>';
        return;
    }

    container.replaceChildren(...sites.map((site) => {
        const block = document.createElement('div');
        block.className = 'hk-site-block';

        const header = document.createElement('div');
        header.className = 'hk-site-header';
        const domain = document.createElement('div');
        domain.className = 'hk-site-domain';
        domain.textContent = site;
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'hk-del-site';
        clear.textContent = '清空此网站';
        clear.addEventListener('click', async () => {
            if (!confirm('确定清空 ' + site + ' 的全部映射？')) return;
            const all = (await schema.load()).hotkeyMappings;
            delete all[site];
            await schema.save({ hotkeyMappings: all });
            toast('已清空 ' + site);
            render();
        });
        header.append(domain, clear);
        block.appendChild(header);

        for (const [from, to] of Object.entries(mappings[site])) {
            const row = document.createElement('div');
            row.className = 'hk-map-row';

            const keys = document.createElement('div');
            keys.className = 'hk-key-group';
            const fromBadge = document.createElement('span');
            fromBadge.className = 'hk-key-badge';
            fromBadge.textContent = from;
            const arrow = document.createElement('span');
            arrow.className = 'hk-arrow';
            arrow.textContent = '→';
            const toBadge = document.createElement('span');
            toBadge.className = 'hk-key-badge';
            toBadge.textContent = to;
            keys.append(fromBadge, arrow, toBadge);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'hk-del-btn';
            remove.textContent = '删除';
            remove.addEventListener('click', async () => {
                const all = (await schema.load()).hotkeyMappings;
                if (all[site]) delete all[site][from];
                if (all[site] && !Object.keys(all[site]).length) delete all[site];
                await schema.save({ hotkeyMappings: all });
                toast('映射已删除');
                render();
            });

            row.append(keys, remove);
            block.appendChild(row);
        }
        return block;
    }));
}
