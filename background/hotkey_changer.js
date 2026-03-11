// Hotkey Changer - Background Service Worker
// 处理存储和消息传递

// 初始化存储结构
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(['hotkeyMappings', 'enabledSites'], (result) => {
    if (!result.hotkeyMappings) {
      chrome.storage.sync.set({ hotkeyMappings: {} });
    }
    if (!result.enabledSites) {
      chrome.storage.sync.set({ enabledSites: {} });
    }
  });
  console.log('[Hotkey Changer] Extension installed/updated');
});

// 获取当前标签页的域名
async function getCurrentTabHostname() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      return url.hostname;
    } catch (e) {
      return null;
    }
  }
  return null;
}

// 处理来自popup的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CURRENT_HOSTNAME') {
    getCurrentTabHostname().then(hostname => {
      sendResponse({ hostname });
    });
    return true; // 表示异步响应
  }
  
  if (message.type === 'SAVE_MAPPINGS') {
    const { hostname, mappings } = message;
    chrome.storage.sync.get(['hotkeyMappings'], (result) => {
      const allMappings = result.hotkeyMappings || {};
      allMappings[hostname] = mappings;
      chrome.storage.sync.set({ hotkeyMappings: allMappings }, () => {
        // 通知content script更新
        notifyContentScript(hostname, 'UPDATE_MAPPINGS', { mappings });
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  if (message.type === 'GET_MAPPINGS') {
    const { hostname } = message;
    chrome.storage.sync.get(['hotkeyMappings'], (result) => {
      const allMappings = result.hotkeyMappings || {};
      sendResponse({ mappings: allMappings[hostname] || {} });
    });
    return true;
  }
  
  if (message.type === 'SET_SITE_ENABLED') {
    const { hostname, enabled } = message;
    chrome.storage.sync.get(['enabledSites'], (result) => {
      const enabledSites = result.enabledSites || {};
      enabledSites[hostname] = enabled;
      chrome.storage.sync.set({ enabledSites }, () => {
        // 通知content script更新
        notifyContentScript(hostname, 'SET_ENABLED', { enabled });
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  if (message.type === 'GET_SITE_ENABLED') {
    const { hostname } = message;
    chrome.storage.sync.get(['enabledSites'], (result) => {
      const enabledSites = result.enabledSites || {};
      sendResponse({ enabled: enabledSites[hostname] !== false });
    });
    return true;
  }
  
  if (message.type === 'DELETE_MAPPING') {
    const { hostname, key } = message;
    chrome.storage.sync.get(['hotkeyMappings'], (result) => {
      const allMappings = result.hotkeyMappings || {};
      if (allMappings[hostname]) {
        delete allMappings[hostname][key];
        chrome.storage.sync.set({ hotkeyMappings: allMappings }, () => {
          notifyContentScript(hostname, 'UPDATE_MAPPINGS', { mappings: allMappings[hostname] });
          sendResponse({ success: true });
        });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }
  
  if (message.type === 'CLEAR_ALL_MAPPINGS') {
    const { hostname } = message;
    chrome.storage.sync.get(['hotkeyMappings'], (result) => {
      const allMappings = result.hotkeyMappings || {};
      allMappings[hostname] = {};
      chrome.storage.sync.set({ hotkeyMappings: allMappings }, () => {
        notifyContentScript(hostname, 'UPDATE_MAPPINGS', { mappings: {} });
        sendResponse({ success: true });
      });
    });
    return true;
  }
});

// 通知content script
async function notifyContentScript(hostname, type, data) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) {
      try {
        const url = new URL(tab.url);
        if (url.hostname === hostname) {
          chrome.tabs.sendMessage(tab.id, { type, ...data }).catch(() => {
            // 忽略错误，可能页面还没加载content script
          });
        }
      } catch (e) {
        // 忽略无效URL
      }
    }
  }
}

console.log('[Hotkey Changer] Background service worker started');