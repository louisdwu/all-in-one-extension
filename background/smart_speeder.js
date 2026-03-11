// Background script for handling keyboard shortcuts
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-speed') {
    chrome.tabs.sendMessage(tab.id, { action: 'increaseSpeed' });
  } else if (command === 'decrease-speed') {
    chrome.tabs.sendMessage(tab.id, { action: 'decreaseSpeed' });
  } else if (command === 'preset-speed') {
    chrome.tabs.sendMessage(tab.id, { action: 'presetSpeed' });
  }
});

// 快捷键配置
let shortcutConfig = {
  increaseSpeed: 'toggle-speed',
  decreaseSpeed: 'decrease-speed',
  presetSpeed: 'preset-speed'
};

// 加载自定义快捷键
function loadShortcuts() {
  chrome.storage.sync.get(['shortcuts'], (result) => {
    if (result.shortcuts) {
      shortcutConfig = result.shortcuts;
    }
  });
}

// Listen for messages from popup/options to update settings
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSettings') {
    chrome.storage.sync.get(['globalEnabled', 'hideFloatingBall', 'excludeRules', 'includeRules', 'defaultSpeed', 'presetSpeed'], (result) => {
      sendResponse({
        globalEnabled: result.globalEnabled !== false, // default true
        hideFloatingBall: result.hideFloatingBall || false,
        excludeRules: result.excludeRules || [],
        includeRules: result.includeRules || [],
        defaultSpeed: result.defaultSpeed || 1.0,
        presetSpeed: result.presetSpeed || 2.0
      });
    });
    return true; // Will respond asynchronously
  }
  
  if (request.action === 'saveSettings') {
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
      // Notify all tabs to reload settings
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'reloadSettings' }).catch(() => {});
        });
      });
    });
    return true;
  }
  
  if (request.action === 'importSettings') {
    // 处理导入设置的请求（兼容性支持）
    chrome.storage.sync.set(request.settings, () => {
      sendResponse({ success: true });
      // Notify all tabs to reload settings
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { action: 'reloadSettings' }).catch(() => {});
        });
      });
    });
    return true;
  }
  
  if (request.action === 'openOptions') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
  }
  
  if (request.action === 'openShortcutsPage') {
    chrome.tabs.create({ url: chrome.runtime.getURL('shortcuts.html') });
    sendResponse({ success: true });
  }
  
  // 自定义快捷键处理
  if (request.action === 'getShortcuts') {
    chrome.storage.sync.get(['shortcuts'], (result) => {
      const shortcuts = result.shortcuts || {};
      // 如果没有自定义设置，返回默认值
      if (Object.keys(shortcuts).length === 0) {
        // 检测平台并返回对应的默认快捷键
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || 
                      navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
        sendResponse({
          increaseSpeed: isMac ? 'Command+Shift+Right' : 'Ctrl+Shift+Right',
          decreaseSpeed: isMac ? 'Command+Shift+Left' : 'Ctrl+Shift+Left',
          presetSpeed: isMac ? 'Command+Shift+Space' : 'Ctrl+Shift+Space'
        });
      } else {
        sendResponse(shortcuts);
      }
    });
    return true;
  }
  
  if (request.action === 'updateShortcuts') {
    chrome.storage.sync.set({ shortcuts: request.shortcuts }, () => {
      // 通知所有标签页更新快捷键
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'updateShortcuts',
            shortcuts: request.shortcuts
          }).catch(() => {});
        });
      });
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (request.action === 'updateShortcutReference') {
    // 更新快捷键参考文档
    updateShortcutReferenceDocument(request.shortcuts);
    sendResponse({ success: true });
  }
});

// 更新快捷键参考文档
function updateShortcutReferenceDocument(shortcuts) {
  const content = generateShortcutReferenceContent(shortcuts);
  chrome.storage.sync.set({ shortcutReference: content });
}

// 生成快捷键参考内容
function generateShortcutReferenceContent(shortcuts) {
  let content = '# 🎮 自定义快捷键参考\n\n';
  content += '## 当前快捷键配置\n\n';
  
  const descriptions = {
    increaseSpeed: '提高视频速度 (+0.25x)',
    decreaseSpeed: '降低视频速度 (-0.25x)',
    presetSpeed: '预设速度切换'
  };
  
  for (const [id, shortcut] of Object.entries(shortcuts)) {
    content += `- **${descriptions[id]}**: \`${shortcut}\`\n`;
  }
  
  content += '\n## 使用说明\n\n';
  content += '- 修改快捷键后，刷新视频页面即可生效\n';
  content += '- 快捷键必须包含至少一个修饰键（Ctrl/Alt/Shift/Meta）\n';
  content += '- 避免与浏览器默认快捷键冲突\n';
  content += '- 可在设置页面的"快捷键配置"中修改\n';
  
  return content;
}

// 初始化
loadShortcuts();