chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getTabs') {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      sendResponse(tabs);
    });
    return true; // 保持消息通道开启以发送异步响应
  } else if (request.action === 'switchToTab') {
    chrome.tabs.update(request.tabId, { active: true });
  }
});
