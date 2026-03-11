// Hotkey Changer - Content Script
// 负责与 background 通信，并将配置传递给 inject.js

(function() {
  'use strict';

  // 当前域名
  const currentHostname = window.location.hostname;

  console.log('[Hotkey Changer] Content script loaded for:', currentHostname);

  // 发送配置更新到页面 (inject.js)
  function updatePageConfig(type, data) {
    window.dispatchEvent(new CustomEvent('__hotkeyChangerUpdate', {
      detail: { type, data }
    }));
  }

  // 从存储中加载配置
  function loadMappings() {
    console.log('[Hotkey Changer] Loading mappings for:', currentHostname);
    chrome.storage.sync.get(['hotkeyMappings', 'enabledSites', 'hotkeyEnabled'], (result) => {
      console.log('[Hotkey Changer] Storage result:', result);
      
      const isGlobalEnabled = result.hotkeyEnabled !== false;
      const isSiteEnabled = result.enabledSites ? result.enabledSites[currentHostname] !== false : true;
      
      updatePageConfig('enabled', isGlobalEnabled && isSiteEnabled);

      if (result.hotkeyMappings && result.hotkeyMappings[currentHostname]) {
        updatePageConfig('mappings', result.hotkeyMappings[currentHostname]);
      } else {
        updatePageConfig('mappings', {});
      }
    });
  }

  // 立即加载配置
  loadMappings();

  // 页面加载完成后再次加载（确保 inject.js 已经准备好）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(loadMappings, 100);
    });
  } else {
    setTimeout(loadMappings, 100);
  }

  // 监听来自popup或background的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[Hotkey Changer] Received message:', message);
    if (message.type === 'UPDATE_MAPPINGS') {
      updatePageConfig('mappings', message.mappings || {});
      sendResponse({ success: true });
    } else if (message.type === 'SET_ENABLED') {
      updatePageConfig('enabled', message.enabled);
      sendResponse({ success: true });
    } else if (message.type === 'GET_STATUS') {
      sendResponse({
        hostname: currentHostname,
        enabled: true
      });
    }
    return true;
  });

  // 监听存储变化
  chrome.storage.onChanged.addListener((changes, namespace) => {
    console.log('[Hotkey Changer] Storage changed:', changes);
    if (namespace === 'sync') {
      if (changes.hotkeyMappings) {
        const newMappings = changes.hotkeyMappings.newValue;
        if (newMappings && newMappings[currentHostname]) {
          updatePageConfig('mappings', newMappings[currentHostname]);
        } else {
          updatePageConfig('mappings', {});
        }
      }
      if (changes.enabledSites || changes.hotkeyEnabled) {
        loadMappings();
      }
    }
  });
})();