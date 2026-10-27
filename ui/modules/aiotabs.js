/**
 * Tab switcher panel.
 */
import './shared.js';
import { schema, bindToggle, bindInput } from './shared.js';

export async function initAioTabs() {
    const settings = await schema.load();

    const enable = document.getElementById('aiotabs-enable');
    const wrap = document.getElementById('aiotabs-wrap');
    const delay = document.getElementById('aiotabs-delay');
    if (enable) enable.checked = settings.aioTabsEnabled !== false;
    if (wrap) wrap.checked = settings.aioTabsWrap !== false;
    if (delay) delay.value = settings.aioTabsDelay;

    bindToggle('aiotabs-enable', 'aioTabsEnabled');
    bindToggle('aiotabs-wrap', 'aioTabsWrap');
    bindInput('aiotabs-delay', 'aioTabsDelay', { numeric: true, debounceMs: 500 });
}
