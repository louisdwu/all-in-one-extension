import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initGlobalBackup() {
    const exportBtn = document.getElementById('backup-export-btn');
    const importBtn = document.getElementById('backup-import-btn');
    const importFile = document.getElementById('backup-import-file');
    const resetBtn = document.getElementById('backup-reset-btn');

    if (!exportBtn) return;

    // 导出逻辑
    exportBtn.addEventListener('click', () => {
        ConfigBridge.get(null).then((items) => {
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

    importBtn?.addEventListener('click', () => importFile.click());

    importFile?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const backup = JSON.parse(event.target.result);
                if (!backup.data || typeof backup.data !== 'object') throw new Error('找不到 data 节点');

                if (confirm('确定要导入此备份吗？这将覆盖所有现有的插件配置！')) {
                    chrome.storage.sync.clear(() => {
                        ConfigBridge.set(backup.data).then(() => {
                            showStatus('备份数据已导入，正在自动重载...', 'success');
                            ConfigBridge.sendMessage({ action: 'reloadSettings' });
                            ConfigBridge.sendMessage({ type: "UPDATE_CONFIG" });
                            setTimeout(() => window.location.reload(), 1000);
                        });
                    });
                }
            } catch (err) {
                showStatus('导入失败: ' + err.message, 'error');
            }
            e.target.value = '';
        };
        reader.readAsText(file);
    });

    resetBtn?.addEventListener('click', () => {
        if (confirm('🚨 确定要恢复出厂设置吗？这将清空所有配置！')) {
            chrome.storage.sync.clear(() => {
                chrome.storage.local.clear(() => {
                    showStatus('已成功恢复出厂默认设置', 'success');
                    ConfigBridge.sendMessage({ action: 'reloadSettings' });
                    ConfigBridge.sendMessage({ type: "UPDATE_CONFIG" });
                    setTimeout(() => window.location.reload(), 1500);
                });
            });
        }
    });
}
