/**
 * Options page entry point.
 *
 * - hash routing (`#tab-speeder`) so a bookmark can deep-link a panel
 * - one broken panel can no longer take down the whole page
 * - keyboard navigation for the sidebar (arrow keys / Home / End)
 */
import '../libs/core.js';
import '../libs/schema.js';
import { uiLog } from './modules/shared.js';

import { initDashboard } from './modules/dashboard.js';
import { initAioTabs } from './modules/aiotabs.js';
import { initIncognito } from './modules/incognito.js';
import { initSpeeder } from './modules/speeder.js';
import { initBilibili } from './modules/bilibili.js';
import { initHotkeys } from './modules/hotkeys.js';
import { initHud } from './modules/hud/index.js';
import { initBackup } from './modules/backup.js';
import { initAbout } from './modules/about.js';

const NAV = Array.from(document.querySelectorAll('.nav button[data-target]'));
const PANES = Array.from(document.querySelectorAll('.tab-pane'));

function activate(targetId, { updateHash = true } = {}) {
    const pane = document.getElementById(targetId);
    if (!pane) return;
    for (const button of NAV) {
        const isActive = button.dataset.target === targetId;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-selected', String(isActive));
        button.tabIndex = isActive ? 0 : -1;
    }
    for (const other of PANES) other.classList.toggle('active', other === pane);
    if (updateHash) {
        const next = '#' + targetId.replace(/^tab-/, '');
        if (location.hash !== next) history.replaceState(null, '', next);
    }
    // Panels that render live values need to know they became visible.
    document.dispatchEvent(new CustomEvent('aio:pane-shown', { detail: { targetId } }));
}

function setupNav() {
    NAV.forEach((button, index) => {
        button.addEventListener('click', () => activate(button.dataset.target));
        button.addEventListener('keydown', (event) => {
            let next = null;
            if (event.key === 'ArrowDown') next = NAV[(index + 1) % NAV.length];
            else if (event.key === 'ArrowUp') next = NAV[(index - 1 + NAV.length) % NAV.length];
            else if (event.key === 'Home') next = NAV[0];
            else if (event.key === 'End') next = NAV[NAV.length - 1];
            if (!next) return;
            event.preventDefault();
            next.focus();
            activate(next.dataset.target);
        });
    });

    const hash = location.hash.replace('#', '');
    if (hash && document.getElementById('tab-' + hash)) activate('tab-' + hash, { updateHash: false });

    window.addEventListener('hashchange', () => {
        const target = location.hash.replace('#', '');
        if (target && document.getElementById('tab-' + target)) {
            activate('tab-' + target, { updateHash: false });
        }
    });
}

function guard(name, fn) {
    try {
        fn();
    } catch (err) {
        uiLog.error('panel "' + name + '" failed to initialize', err);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const versionEl = document.getElementById('sidebar-version');
    if (versionEl) versionEl.textContent = 'v' + chrome.runtime.getManifest().version;

    setupNav();

    guard('dashboard', initDashboard);
    guard('aiotabs', initAioTabs);
    guard('incognito', initIncognito);
    guard('speeder', initSpeeder);
    guard('bilibili', initBilibili);
    guard('hotkeys', initHotkeys);
    guard('hud', initHud);
    guard('backup', initBackup);
    guard('about', initAbout);
});
