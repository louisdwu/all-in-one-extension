import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initBilibiliSubtitles() {
    const autoToggle = document.getElementById('bili-autoSubtitle');
    const hotkeyInput = document.getElementById('bili-subtitleHotkey');
    const autoplayToggle = document.getElementById('bili-autoplay-enable');
    const bypassToggle = document.getElementById('bili-1080p-enable');
    const commentToggle = document.getElementById('bili-comments-enable');
    const aiSubToggle = document.getElementById('bili-ai-subtitle-enable');
    const sessdataInput = document.getElementById('bili-sessdata');
    const dedeUserIdInput = document.getElementById('bili-dede-userid');
    const saveBtn = document.getElementById('bili-saveBtn');

    if (!autoToggle) return;

    let config = { autoEnableSubtitle: true, subtitleHotkey: 's' };

    function load() {
        ConfigBridge.getBilibiliSettings().then((res) => {
            if (res && res.bilibiliSubtitles) {
                config = res.bilibiliSubtitles;
            }
            autoToggle.checked = config.autoEnableSubtitle;
            hotkeyInput.value = config.subtitleHotkey;
        });

        ConfigBridge.get(['biliAutoPlay', 'bilibili1080PEnabled', 'biliCommentsEnabled', 'biliAISubtitleEnabled', 'biliCookies']).then((res) => {
            if (autoplayToggle) autoplayToggle.checked = !!res.biliAutoPlay;
            if (bypassToggle) bypassToggle.checked = res.bilibili1080PEnabled !== false;
            if (commentToggle) commentToggle.checked = res.biliCommentsEnabled !== false;
            if (aiSubToggle) aiSubToggle.checked = res.biliAISubtitleEnabled !== false;
            if (res.biliCookies) {
                if (sessdataInput) sessdataInput.value = res.biliCookies.sessdata || '';
                if (dedeUserIdInput) dedeUserIdInput.value = res.biliCookies.dedeUserId || '';
            }
        });
    }

    // 统一保存逻辑（除了快捷键和字幕开关，因为它们有独立逻辑，或者也可以统一）
    function saveAll() {
        const cookies = {
            sessdata: sessdataInput.value.trim(),
            dedeUserId: dedeUserIdInput.value.trim()
        };

        const update = {
            biliAutoPlay: autoplayToggle.checked,
            bilibili1080PEnabled: bypassToggle.checked,
            biliCommentsEnabled: commentToggle.checked,
            biliAISubtitleEnabled: aiSubToggle.checked,
            biliCookies: cookies,
            biliAutoSubtitle: autoToggle.checked // 同步字幕开关到顶层
        };

        ConfigBridge.set(update).then(() => {
            // 同时保存字幕专用对象
            config.autoEnableSubtitle = autoToggle.checked;
            ConfigBridge.saveBilibiliSettings(config).then(() => {
                showStatus('B站所有设置已保存');
                ConfigBridge.sendMessage({ action: 'reloadSettings' });
            });
        });
    }

    saveBtn?.addEventListener('click', saveAll);

    // 快捷键录制逻辑
    hotkeyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') return;
        e.preventDefault();
        const key = e.key.toLowerCase();
        hotkeyInput.value = key;
        config.subtitleHotkey = key;
        // 快捷键录制后自动保存该子项
        ConfigBridge.saveBilibiliSettings(config).then(() => {
            showStatus('快捷键已更新');
            ConfigBridge.sendMessage({ action: 'reloadSettings' });
        });
    });

    load();
}
