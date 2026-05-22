import { ConfigBridge } from '../../libs/config_bridge.js';
import { showStatus } from '../../libs/utils.js';

export function initBilibiliSubtitles() {
    const autoToggle = document.getElementById('bili-autoSubtitle');
    const hotkeyInput = document.getElementById('bili-subtitleHotkey');
    const autoplayToggle = document.getElementById('bili-autoplay-enable');
    const bypassToggle = document.getElementById('bili-1080p-enable');
    const commentToggle = document.getElementById('bili-comments-enable');
    const aiSubToggle = document.getElementById('bili-ai-subtitle-enable');
    const playnextToggle = document.getElementById('bili-playnext-disable');
    const sessdataInput = document.getElementById('bili-sessdata');
    const dedeUserIdInput = document.getElementById('bili-dede-userid');
    const fetchCookiesBtn = document.getElementById('bili-fetch-cookies');
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

        ConfigBridge.get(['biliAutoPlay', 'bilibili1080PEnabled', 'biliCommentsEnabled', 'biliAISubtitleEnabled', 'biliCookies', 'biliPlayNextDisabled']).then((res) => {
            if (autoplayToggle) autoplayToggle.checked = !!res.biliAutoPlay;
            if (bypassToggle) bypassToggle.checked = res.bilibili1080PEnabled !== false;
            if (commentToggle) commentToggle.checked = res.biliCommentsEnabled !== false;
            if (aiSubToggle) aiSubToggle.checked = res.biliAISubtitleEnabled !== false;
            if (playnextToggle) playnextToggle.checked = !!res.biliPlayNextDisabled;
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
            biliPlayNextDisabled: playnextToggle.checked,
            biliCookies: cookies,
            biliAutoSubtitle: autoToggle.checked // 同步字幕开关到顶层
        };

        ConfigBridge.set(update).then(() => {
            // 同步种 cookie 到 bilibili.com，供 MAIN 世界脚本同步读取
            // 无痕窗口在创建时会继承普通模式的 cookie，因此此 cookie 在无痕中也可用
            if (chrome.cookies) {
                chrome.cookies.set({
                    url: 'https://www.bilibili.com',
                    name: 'aio_pnd',
                    value: playnextToggle.checked ? '1' : '0',
                    domain: '.bilibili.com',
                    path: '/',
                    expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400,
                    sameSite: 'lax'
                });
            }
            // 同时保存字幕专用对象
            config.autoEnableSubtitle = autoToggle.checked;
            ConfigBridge.saveBilibiliSettings(config).then(() => {
                showStatus('B站所有设置已保存');
                ConfigBridge.sendMessage({ action: 'reloadSettings' });
            });
        });
    }

    saveBtn?.addEventListener('click', saveAll);

    // 自动获取 Cookie 逻辑
    fetchCookiesBtn?.addEventListener('click', async () => {
        console.log('[AIO] 开始获取 B 站 Cookie...');
        const domains = ['.bilibili.com', 'www.bilibili.com'];
        let sessdata = '';
        let dedeUserId = '';
        let fromIncognito = false;

        try {
            // 获取所有 Cookie Stores
            const stores = await chrome.cookies.getAllCookieStores();
            console.log('[AIO] 发现 Cookie Stores:', stores);
            
            // 查找无痕 Store (incognito: true)
            const incognitoStore = stores.find(s => s.incognito);
            
            // 定义查找函数
            const findInStore = async (storeId) => {
                let s = '', d = '';
                // 优先使用 URL 查询，这在权限匹配上更可靠
                const url = 'https://www.bilibili.com';
                const params = { url };
                if (storeId) params.storeId = storeId;
                
                console.log(`[AIO] 正在查询 Store [${storeId || 'default'}]，目标 URL: ${url}`);
                const cookies = await chrome.cookies.getAll(params);
                console.log(`[AIO] Store [${storeId || 'default'}] 返回了 ${cookies.length} 个 Cookie`);
                
                cookies.forEach(c => {
                    if (c.name === 'SESSDATA') s = c.value;
                    if (c.name === 'DedeUserID') d = c.value;
                });

                // 如果按 URL 没找到，再按 Domain 兜底
                if (!s || !d) {
                    for (const domain of domains) {
                        const dParams = { domain };
                        if (storeId) dParams.storeId = storeId;
                        const dCookies = await chrome.cookies.getAll(dParams);
                        dCookies.forEach(c => {
                            if (c.name === 'SESSDATA' && !s) s = c.value;
                            if (c.name === 'DedeUserID' && !d) d = c.value;
                        });
                    }
                }
                return { sessdata: s, dedeUserId: d };
            };

            // 1. 优先尝试无痕模式（用户明确需求）
            if (incognitoStore) {
                console.log('[AIO] 检测到无痕 Store:', incognitoStore.id);
                const res = await findInStore(incognitoStore.id);
                if (res.sessdata || res.dedeUserId) {
                    sessdata = res.sessdata;
                    dedeUserId = res.dedeUserId;
                    fromIncognito = true;
                }
            } else {
                console.warn('[AIO] 未发现无痕 Store。请确认：1. 已开启“在无痕模式下启用” 2. 当前已打开至少一个无痕窗口');
            }

            // 2. 如果无痕没找到或不存在，再尝试常规模式
            if (!sessdata && !dedeUserId) {
                console.log('[AIO] 尝试从常规窗口获取...');
                const res = await findInStore(); 
                sessdata = res.sessdata;
                dedeUserId = res.dedeUserId;
            }

            if (sessdata || dedeUserId) {
                const isSame = sessdataInput.value === sessdata && dedeUserIdInput.value === dedeUserId;
                const sourceText = fromIncognito ? ' (来自无痕窗口)' : ' (来自常规窗口)';
                
                if (isSame) {
                    showStatus(`获取到的信息与当前一致，无需更新${sourceText}`);
                } else {
                    if (sessdataInput) sessdataInput.value = sessdata;
                    if (dedeUserIdInput) dedeUserIdInput.value = dedeUserId;
                    showStatus(`已成功获取最新信息${sourceText}，请记得点击保存`);
                }
            } else {
                let errorMsg = '未能获取到 B 站 Cookie。';
                if (!incognitoStore) {
                    errorMsg += '检测到无痕环境未就绪（请确保已在扩展管理中勾选“在无痕模式下启用”并打开了无痕窗口）。';
                } else {
                    errorMsg += '请确保已在浏览器中登录 B 站。';
                }
                showStatus(errorMsg, 'error');
            }
        } catch (e) {
            console.error('[AIO] Fetch cookies failed:', e);
            showStatus('获取失败: ' + e.message, 'error');
        }
    });

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
