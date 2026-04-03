// Background script for Bilibili 1080P settings
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
