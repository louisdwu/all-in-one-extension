import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initAioTabs() {
    const toggle = document.getElementById('aiotabs-enable');
    const delayInput = document.getElementById('aiotabs-delay');

    ConfigBridge.get(['aioTabsEnabled', 'aioTabsDelay']).then((res) => {
        toggle.checked = res.aioTabsEnabled !== false;
        delayInput.value = res.aioTabsDelay !== undefined ? res.aioTabsDelay : 1000;
    });

    toggle.addEventListener('change', (e) => {
        ConfigBridge.set({ aioTabsEnabled: e.target.checked }).then(() => {
            showStatus('右键切换功能状态已保存！');
        });
    });

    delayInput.addEventListener('change', (e) => {
        const val = parseInt(e.target.value);
        if (isNaN(val) || val < 0) {
            showStatus('延迟时间无效', 'error');
            return;
        }
        ConfigBridge.set({ aioTabsDelay: val }).then(() => {
            showStatus('切换延迟已保存！');
        });
    });
}
