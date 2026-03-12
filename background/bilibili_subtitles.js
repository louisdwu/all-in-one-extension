// Background script for Bilibili Subtitle settings
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.sync.get(['bilibiliSubtitles'], (result) => {
      sendResponse({
        bilibiliSubtitles: result.bilibiliSubtitles || {
          autoEnableSubtitle: true,
          subtitleHotkey: 's'
        }
      });
    });
    return true;
  }

  if (request.action === 'saveBilibiliSettings') {
    chrome.storage.sync.set({ bilibiliSubtitles: request.settings }, () => {
      sendResponse({ success: true });
      // Notify tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'reloadSettings' }).catch(() => {});
        });
      });
    });
    return true;
  }
});
