import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initEZIncognito() {
    const enableToggle = document.getElementById('ez-enable');
    const select = document.getElementById('ez-modifier-key');

    ConfigBridge.get({ ezEnabled: true, modifierKey: 'ctrlKey' }).then((res) => {
        enableToggle.checked = res.ezEnabled;
        select.value = res.modifierKey;
    });

    enableToggle.addEventListener('change', () => {
        ConfigBridge.set({ ezEnabled: enableToggle.checked }).then(() => {
            showStatus('无痕按键主开关已更新！');
        });
    });

    select.addEventListener('change', () => {
        ConfigBridge.set({ modifierKey: select.value }).then(() => {
            showStatus('无痕按键修饰键已保存！');
        });
    });
}
