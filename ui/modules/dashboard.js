import { ConfigBridge } from '../../libs/config_bridge.js';

export function initDashboard() {
    // 卡片点击跳转逻辑
    document.querySelectorAll('.dash-card[data-nav-target]').forEach(card => {
        card.style.cursor = 'pointer';
        card.addEventListener('click', (e) => {
            if (e.target.closest('.toggle')) return;
            const targetId = card.dataset.navTarget;
            const navItem = document.querySelector(`.nav li[data-target="${targetId}"]`);
            if (navItem) navItem.click();
        });
    });

    const keysMap = {
        'db-aiotabs-enable': 'aioTabsEnabled',
        'db-ez-enable': 'ezEnabled',
        'db-hotkey-enable': 'hotkeyEnabled',
        'db-hud-enable': 'hudEnabled'
    };

    // 初始化状态
    ConfigBridge.get(Object.values(keysMap)).then((res) => {
        for (const [id, key] of Object.entries(keysMap)) {
            const el = document.getElementById(id);
            if (el) el.checked = res[key] !== false;
        }
    });

    // 绑定事件
    for (const [id, key] of Object.entries(keysMap)) {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const update = {};
                update[key] = e.target.checked;
                ConfigBridge.set(update);
                if (key === 'hudEnabled') ConfigBridge.sendMessage({ type: "UPDATE_HUD_CONFIG" });
            });
        }
    }

    // Smart Speeder 专用
    const dbSpeed = document.getElementById('db-speed-enable');
    ConfigBridge.getSpeederSettings().then((res) => {
        if (dbSpeed && res) dbSpeed.checked = res.globalEnabled !== false;
    });

    dbSpeed?.addEventListener('change', (e) => {
        ConfigBridge.getSpeederSettings().then((res) => {
            if (res) {
                res.globalEnabled = e.target.checked;
                ConfigBridge.saveSpeederSettings(res);
            }
        });
    });

    // Bilibili Subtitles Dashboard Toggle
    const dbBili = document.getElementById('db-bili-enable');
    ConfigBridge.getBilibiliSettings().then((res) => {
        if (dbBili && res && res.bilibiliSubtitles) {
            dbBili.checked = res.bilibiliSubtitles.autoEnableSubtitle !== false;
        }
    });

    dbBili?.addEventListener('change', (e) => {
        ConfigBridge.getBilibiliSettings().then((res) => {
            if (res && res.bilibiliSubtitles) {
                res.bilibiliSubtitles.autoEnableSubtitle = e.target.checked;
                ConfigBridge.saveBilibiliSettings(res.bilibiliSubtitles);
                ConfigBridge.set({ biliAutoSubtitle: e.target.checked });
            }
        });
    });
}

export function setupSync() {
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace !== 'sync') return;

        const syncMap = {
            aioTabsEnabled: ['aiotabs-enable', 'db-aiotabs-enable'],
            ezEnabled: ['ez-enable', 'db-ez-enable'],
            hotkeyEnabled: ['hotkey-enable', 'db-hotkey-enable'],
            hudEnabled: ['hud-enable', 'db-hud-enable'],
            biliAutoSubtitle: ['bili-autoSubtitle', 'db-bili-enable'],
            globalEnabled: ['speed-globalToggle', 'db-speed-enable'],
            bilibili1080PEnabled: ['bili-1080p-enable'],
            biliCommentsEnabled: ['bili-comments-enable'],
            biliAISubtitleEnabled: ['bili-ai-subtitle-enable']
        };

        for (const [key, ids] of Object.entries(syncMap)) {
            if (changes[key]) {
                ids.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.checked = changes[key].newValue !== false;
                });
            }
        }
    });

    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'reloadSettings') {
            ConfigBridge.getSpeederSettings().then((res) => {
                const dbSpeed = document.getElementById('db-speed-enable');
                const pageSpeed = document.getElementById('speed-globalToggle');
                if (dbSpeed && res) dbSpeed.checked = res.globalEnabled !== false;
                if (pageSpeed && res) pageSpeed.checked = res.globalEnabled !== false;
            });
        }
    });
}
