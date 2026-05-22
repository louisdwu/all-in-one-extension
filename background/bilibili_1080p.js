// Background script for Bilibili 1080P settings
let cachedPND = false;

// 初始加载播完暂停设置
chrome.storage.sync.get(['biliPlayNextDisabled'], (res) => {
    cachedPND = !!res.biliPlayNextDisabled;
    syncPNDCookieToAllStores(cachedPND);
});

// 监听设置变化，实时同步 cookie 到所有 cookie store（含无痕）
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.biliPlayNextDisabled) {
        cachedPND = !!changes.biliPlayNextDisabled.newValue;
        syncPNDCookieToAllStores(cachedPND);
    }
});

// 将 aio_pnd cookie 同步到所有 cookie store（普通 + 无痕）
async function syncPNDCookieToAllStores(enabled) {
    try {
        const stores = await chrome.cookies.getAllCookieStores();
        for (const store of stores) {
            await chrome.cookies.set({
                url: 'https://www.bilibili.com',
                name: 'aio_pnd',
                value: enabled ? '1' : '0',
                domain: '.bilibili.com',
                path: '/',
                expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400,
                storeId: store.id
            }).catch(() => {});
        }
    } catch(e) {
        console.warn('[AIO Bili BG] Cookie sync failed', e);
    }
}

// B 站页面导航时确保 cookie 在当前 store 中存在
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return;
    try {
        const tab = await chrome.tabs.get(details.tabId);
        await chrome.cookies.set({
            url: details.url,
            name: 'aio_pnd',
            value: cachedPND ? '1' : '0',
            domain: '.bilibili.com',
            path: '/',
            expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400,
            storeId: tab.cookieStoreId
        }).catch(() => {});
    } catch(e) {}
}, { url: [{ hostSuffix: '.bilibili.com' }] });

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getBilibili1080PSettings') {
        chrome.storage.sync.get(['bilibili1080PEnabled'], (result) => {
            // 默认自动开启，无需提醒
            sendResponse({
                enabled: result.bilibili1080PEnabled !== false
            });
        });
        return true;
    }

    if (request.action === 'saveBilibili1080PSettings') {
        chrome.storage.sync.set({ bilibili1080PEnabled: request.enabled }, () => {
            sendResponse({ success: true });
            // Notify tabs
            chrome.tabs.query({ url: "*://*.bilibili.com/*" }, (tabs) => {
                tabs.forEach(tab => {
                    chrome.tabs.sendMessage(tab.id, { action: 'reloadBilibili1080PSettings' }).catch(() => { });
                });
            });
        });
        return true;
    }
});
