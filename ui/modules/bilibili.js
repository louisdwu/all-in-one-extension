import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initBilibiliSubtitles() {
    const autoToggle = document.getElementById('bili-autoSubtitle');
    const hotkeyInput = document.getElementById('bili-subtitleHotkey');
    const bypassToggle = document.getElementById('bili-1080p-enable');
    const commentToggle = document.getElementById('bili-comments-enable');
    const aiSubToggle = document.getElementById('bili-ai-subtitle-enable');
    const sessdataInput = document.getElementById('bili-sessdata');
    const dedeUserIdInput = document.getElementById('bili-dede-userid');

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

        ConfigBridge.get(['bilibili1080PEnabled', 'biliCommentsEnabled', 'biliAISubtitleEnabled', 'biliCookies']).then((res) => {
            if (bypassToggle) bypassToggle.checked = res.bilibili1080PEnabled !== false;
            if (commentToggle) commentToggle.checked = res.biliCommentsEnabled !== false;
            if (aiSubToggle) aiSubToggle.checked = res.biliAISubtitleEnabled !== false;
            if (res.biliCookies) {
                if (sessdataInput) sessdataInput.value = res.biliCookies.sessdata || '';
                if (dedeUserIdInput) dedeUserIdInput.value = res.biliCookies.dedeUserId || '';
            }
        });
    }

    [
        { el: bypassToggle, key: 'bilibili1080PEnabled', msg: 'B站1080P 畅享状态已保存！' },
        { el: commentToggle, key: 'biliCommentsEnabled', msg: '免登录看评论状态已保存！' },
        { el: aiSubToggle, key: 'biliAISubtitleEnabled', msg: 'AI 字幕注入状态已保存！' }
    ].forEach(item => {
        item.el?.addEventListener('change', () => {
            const update = {};
            update[item.key] = item.el.checked;
            ConfigBridge.set(update).then(() => {
                showStatus(item.msg);
                ConfigBridge.sendMessage({ action: 'reloadBilibiliSettings' });
            });
        });
    });

    // 快捷键录制逻辑 (简化版)
    hotkeyInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') return;
        e.preventDefault();
        const key = e.key.toLowerCase();
        hotkeyInput.value = key;
        config.subtitleHotkey = key;
        save();
    });

    autoToggle?.addEventListener('change', () => {
        config.autoEnableSubtitle = autoToggle.checked;
        save();
        ConfigBridge.set({ biliAutoSubtitle: autoToggle.checked });
    });

    function save() {
        ConfigBridge.saveBilibiliSettings(config).then(() => {
            showStatus('B站字幕偏好已保存');
        });
    }

    // Cookie 保存逻辑
    [sessdataInput, dedeUserIdInput].forEach(el => {
        el?.addEventListener('change', () => {
            const cookies = {
                sessdata: sessdataInput.value.trim(),
                dedeUserId: dedeUserIdInput.value.trim()
            };
            ConfigBridge.set({ biliCookies: cookies }).then(() => {
                showStatus('B站身份凭证已更新');
            });
        });
    });

    load();
}
