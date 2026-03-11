chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openIncognito') {
    chrome.windows.create({
      url: request.url,
      incognito: true,
      state: 'maximized'
    });
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({
    modifierKey: 'ctrlKey'
  });
});
