import { initDashboard, setupSync } from './modules/dashboard.js';
import { initAioTabs } from './modules/aiotabs.js';
import { initEZIncognito } from './modules/incognito.js';
import { initSmartSpeeder } from './modules/speeder.js';
import { initHUDPanel } from './modules/hud/index.js';
import { initHotkeyPanel } from './modules/hotkeys.js';
import { initGlobalBackup } from './modules/backup.js';
import { initBilibiliSubtitles } from './modules/bilibili.js';

document.addEventListener('DOMContentLoaded', () => {
    // 侧边栏导航初始化
    setupTabs();
    
    // 各模块初始化
    initDashboard();
    setupSync();
    initAioTabs();
    initEZIncognito();
    initSmartSpeeder();
    initHUDPanel();
    initHotkeyPanel();
    initGlobalBackup();
    initBilibiliSubtitles();
});

/**
 * Sidebar Navigation Logic
 */
function setupTabs() {
    const navItems = document.querySelectorAll('.nav li');
    const panes = document.querySelectorAll('.tab-pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(n => n.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            const targetId = item.dataset.target;
            const targetPane = document.getElementById(targetId);
            if (targetPane) {
                targetPane.classList.add('active');
            }
        });
    });
}
