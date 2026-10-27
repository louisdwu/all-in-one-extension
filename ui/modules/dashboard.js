/**
 * Dashboard: the six module master switches.
 */
import '../../libs/core.js';
import '../../libs/schema.js';
import { schema, core, toast, uiLog } from './shared.js';

const TOGGLES = {
    'db-aiotabs-enable': 'aioTabsEnabled',
    'db-ez-enable': 'ezEnabled',
    'db-speed-enable': 'globalEnabled',
    'db-hotkey-enable': 'hotkeyEnabled',
    'db-bili-enable': 'biliEnabled',
    'db-hud-enable': 'hudEnabled'
};

export async function initDashboard() {
    const settings = await schema.load();

    for (const [id, key] of Object.entries(TOGGLES)) {
        const input = document.getElementById(id);
        if (!input) continue;
        input.checked = settings[key] !== false;
        input.addEventListener('change', async () => {
            await schema.save({ [key]: input.checked });
            toast((input.checked ? '已开启：' : '已关闭：') + (input.closest('.dash-card')?.querySelector('h3')?.textContent || key));
        });
    }

    // Keep the dashboard in sync when another surface (popup) changes a switch.
    core.onMessage((message) => {
        if (message && message.type === 'aio:settingsChanged') syncFromStorage();
        return undefined;
    });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync') syncFromStorage();
    });

    // Cards navigate to their detail panel.
    for (const card of document.querySelectorAll('.dash-card[data-nav-target]')) {
        const go = (event) => {
            if (event.target.closest('.toggle')) return;
            document.querySelector('.nav button[data-target="' + card.dataset.navTarget + '"]')?.click();
        };
        card.addEventListener('click', go);
        card.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                go(event);
            }
        });
    }

    uiLog.debug('dashboard ready');
}

async function syncFromStorage() {
    const settings = await schema.load();
    for (const [id, key] of Object.entries(TOGGLES)) {
        const input = document.getElementById(id);
        if (input && input.checked !== (settings[key] !== false)) input.checked = settings[key] !== false;
    }
}
