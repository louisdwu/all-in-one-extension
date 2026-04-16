import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initHotkeyPanel() {
    const container = document.getElementById('hotkey-options-container');
    const enableToggle = document.getElementById('hotkey-enable');

    if (!container) return;

    ConfigBridge.get({ hotkeyEnabled: true }).then((res) => {
        if (enableToggle) enableToggle.checked = res.hotkeyEnabled;
    });

    enableToggle?.addEventListener('change', () => {
        ConfigBridge.set({ hotkeyEnabled: enableToggle.checked }).then(() => {
            showStatus('快捷键映射开关已更新！');
        });
    });

    function loadHotkeys() {
        ConfigBridge.get(['hotkeyMappings']).then((res) => {
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
                        ConfigBridge.set({ hotkeyMappings: allMappings }).then(() => {
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
                        ConfigBridge.set({ hotkeyMappings: allMappings }).then(() => {
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
