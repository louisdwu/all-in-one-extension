// Content script for video speed control
let settings = {
  globalEnabled: true,
  hideFloatingBall: false,
  excludeRules: [],
  includeRules: [],
  defaultSpeed: 1.0,
  presetSpeed: 2.0  // 新增预设速度
};

let currentSpeed = 1.0;
let observer = null;
let originalSpeed = 1.0; // 用于记录切换前的速度

// Load settings from storage
function loadSettings() {
  chrome.runtime.sendMessage({ action: 'getSettings' }, (response) => {
    if (response) {
      // Ensure all required properties exist
      settings = {
        globalEnabled: response.globalEnabled !== false,
        hideFloatingBall: response.hideFloatingBall || false,
        excludeRules: Array.isArray(response.excludeRules) ? response.excludeRules : [],
        includeRules: Array.isArray(response.includeRules) ? response.includeRules : [],
        defaultSpeed: response.defaultSpeed || 1.0,
        presetSpeed: response.presetSpeed || 2.0
      };
      currentSpeed = settings.defaultSpeed;
      checkAndApplySpeed();
    } else {
      // If no response, use default settings
      settings = {
        globalEnabled: true,
        hideFloatingBall: false,
        excludeRules: [],
        includeRules: [],
        defaultSpeed: 1.0,
        presetSpeed: 2.0
      };
      currentSpeed = 1.0;
      checkAndApplySpeed();
    }
  });
}

// Check if current URL matches rules
function shouldApplySpeed() {
  const url = window.location.href;
  
  // If global is disabled, don't apply
  if (!settings.globalEnabled) {
    return false;
  }
  
  // Ensure arrays are defined
  const includeRules = Array.isArray(settings.includeRules) ? settings.includeRules : [];
  const excludeRules = Array.isArray(settings.excludeRules) ? settings.excludeRules : [];
  
  // Check include rules first (if any exist, only these apply)
  if (includeRules.length > 0) {
    return includeRules.some(rule => {
      try {
        const regex = new RegExp(rule);
        return regex.test(url);
      } catch (e) {
        console.warn('Invalid include rule:', rule);
        return false;
      }
    });
  }
  
  // Check exclude rules
  if (excludeRules.length > 0) {
    const isExcluded = excludeRules.some(rule => {
      try {
        const regex = new RegExp(rule);
        return regex.test(url);
      } catch (e) {
        console.warn('Invalid exclude rule:', rule);
        return false;
      }
    });
    if (isExcluded) return false;
  }
  
  return true;
}

// Apply speed to all videos
function applySpeedToVideos() {
  if (!shouldApplySpeed()) {
    resetAllVideos();
    return;
  }
  
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    if (video.readyState >= 2) { // HAVE_CURRENT_DATA
      video.playbackRate = currentSpeed;
    }
  });
}

// Reset all videos to normal speed
function resetAllVideos() {
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    video.playbackRate = 1.0;
  });
}

// Check and apply speed with delay for dynamic content
function checkAndApplySpeed() {
  setTimeout(() => {
    applySpeedToVideos();
    setupVideoObserver();
  }, 100);
}

// Observe for new videos added to DOM
function setupVideoObserver() {
  if (observer) {
    observer.disconnect();
  }
  
  observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeName === 'VIDEO' || (node.querySelectorAll && node.querySelectorAll('video').length > 0)) {
          shouldUpdate = true;
        }
      });
    });
    
    if (shouldUpdate) {
      applySpeedToVideos();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Increase speed
function increaseSpeed() {
  if (!shouldApplySpeed()) return;
  
  currentSpeed = Math.min(currentSpeed + 0.25, 16.0); // Max 16x
  applySpeedToVideos();
  showSpeedIndicator();
}

// Decrease speed
function decreaseSpeed() {
  if (!shouldApplySpeed()) return;
  
  currentSpeed = Math.max(currentSpeed - 0.25, 0.25); // Min 0.25x
  applySpeedToVideos();
  showSpeedIndicator();
}

// Preset speed toggle
function presetSpeed() {
  if (!shouldApplySpeed()) return;
  
  const preset = settings.presetSpeed || 2.0;
  
  // 如果当前速度接近预设速度，则切换回正常速度
  if (Math.abs(currentSpeed - preset) < 0.01) {
    currentSpeed = 1.0; // 正常速度
    showSpeedIndicator('切换回正常速度');
  } else {
    // 否则切换到预设速度
    currentSpeed = preset;
    showSpeedIndicator(`切换到 ${preset}x`);
  }
  
  applySpeedToVideos();
}

// Show speed indicator
function showSpeedIndicator(customMessage) {
  // Remove existing indicator
  const existing = document.getElementById('video-speed-indicator');
  if (existing) existing.remove();
  
  if (!shouldApplySpeed()) return;
  
  const indicator = document.createElement('div');
  indicator.id = 'video-speed-indicator';
  indicator.textContent = customMessage || `${currentSpeed.toFixed(2)}x`;
  indicator.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 10px 15px;
    border-radius: 5px;
    font-size: 16px;
    font-weight: bold;
    z-index: 10000;
    font-family: Arial, sans-serif;
    transition: opacity 0.3s;
  `;
  
  document.body.appendChild(indicator);
  
  // Fade out after 1.5 seconds
  setTimeout(() => {
    indicator.style.opacity = '0';
    setTimeout(() => indicator.remove(), 300);
  }, 1500);
}

// 自定义快捷键配置
let customShortcuts = {};

// 加载自定义快捷键
function loadCustomShortcuts() {
  chrome.runtime.sendMessage({ action: 'getShortcuts' }, (response) => {
    if (response) {
      customShortcuts = response;
      updateShortcutListeners();
    }
  });
}

// 更新快捷键监听器
function updateShortcutListeners() {
  // 移除旧的监听器
  document.removeEventListener('keydown', handleCustomShortcut);
  
  // 添加新的监听器
  document.addEventListener('keydown', handleCustomShortcut);
}

// 处理自定义快捷键
function handleCustomShortcut(e) {
  if (!shouldApplySpeed()) return;
  
  const shortcut = buildShortcutStringFromEvent(e);
  
  // 检查是否匹配任何自定义快捷键
  for (const [action, expectedShortcut] of Object.entries(customShortcuts)) {
    if (shortcut === expectedShortcut) {
      e.preventDefault();
      e.stopPropagation();
      
      // 执行对应的操作
      if (action === 'increaseSpeed') {
        increaseSpeed();
      } else if (action === 'decreaseSpeed') {
        decreaseSpeed();
      } else if (action === 'presetSpeed') {
        presetSpeed();
      }
      
      break;
    }
  }
}

// 从键盘事件构建快捷键字符串
function buildShortcutStringFromEvent(e) {
  const parts = [];
  
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push(navigator.platform.toUpperCase().indexOf('MAC') >= 0 ? 'Command' : 'Win');
  
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
    let mainKey = e.key;
    if (mainKey === ' ') mainKey = 'Space';
    if (mainKey === 'ArrowUp') mainKey = 'Up';
    if (mainKey === 'ArrowDown') mainKey = 'Down';
    if (mainKey === 'ArrowLeft') mainKey = 'Left';
    if (mainKey === 'ArrowRight') mainKey = 'Right';
    if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
    
    parts.push(mainKey);
  }
  
  return parts.join('+');
}

// Listen for messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'increaseSpeed') {
    increaseSpeed();
    sendResponse({ success: true });
  } else if (request.action === 'decreaseSpeed') {
    decreaseSpeed();
    sendResponse({ success: true });
  } else if (request.action === 'presetSpeed') {
    presetSpeed();
    sendResponse({ success: true });
  } else if (request.action === 'reloadSettings') {
    loadSettings();
    loadCustomShortcuts(); // 重新加载快捷键
    // Ensure floating ball exists after reload
    setTimeout(() => {
      const ball = document.getElementById('video-speed-float-ball');
      if (!ball && shouldApplySpeed() && !settings.hideFloatingBall) {
        createFloatingBall();
      }
      // Remove ball if it should be hidden
      if (settings.hideFloatingBall && ball) {
        ball.remove();
      }
      updateFloatingBall();
    }, 500);
    sendResponse({ success: true });
  } else if (request.action === 'getSpeed') {
    sendResponse({ speed: currentSpeed });
  } else if (request.action === 'updateShortcuts') {
    customShortcuts = request.shortcuts;
    updateShortcutListeners();
    sendResponse({ success: true });
  }
});

// Create floating speed indicator ball
function createFloatingBall() {
  // Don't create ball if it should be hidden
  if (settings.hideFloatingBall) {
    return null;
  }
  
  // Remove existing ball if any
  const existingBall = document.getElementById('video-speed-float-ball');
  if (existingBall) existingBall.remove();
  
  const ball = document.createElement('div');
  ball.id = 'video-speed-float-ball';
  ball.innerHTML = `
    <div class="speed-display">${currentSpeed.toFixed(2)}x</div>
    <div class="speed-label">速度</div>
  `;
  
  ball.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 60px;
    height: 60px;
    background: linear-gradient(135deg, #4CAF50, #45a049);
    border-radius: 50%;
    color: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 9999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    font-family: Arial, sans-serif;
    transition: transform 0.2s, box-shadow 0.2s;
    user-select: none;
  `;
  
  // Add hover effects
  ball.addEventListener('mouseenter', () => {
    ball.style.transform = 'scale(1.1)';
    ball.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
  });
  
  ball.addEventListener('mouseleave', () => {
    ball.style.transform = 'scale(1)';
    ball.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
  });
  
  // Click to show floating menu (like extension popup)
  ball.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showFloatingMenu();
  });
  
  // Prevent dragging issues
  ball.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  
  // Add inner styling for text
  const style = document.createElement('style');
  style.textContent = `
    #video-speed-float-ball .speed-display {
      font-size: 14px;
      font-weight: bold;
      line-height: 1;
    }
    #video-speed-float-ball .speed-label {
      font-size: 9px;
      opacity: 0.9;
      margin-top: 2px;
    }
    #video-speed-float-ball:hover {
      transform: scale(1.1);
    }
  `;
  
  document.head.appendChild(style);
  document.body.appendChild(ball);
  
  return ball;
}

// Show floating menu (mimics extension popup)
function showFloatingMenu() {
  // Remove existing menu if any
  const existingMenu = document.getElementById('video-speed-floating-menu');
  if (existingMenu) {
    existingMenu.remove();
    return; // Toggle off
  }
  
  const menu = document.createElement('div');
  menu.id = 'video-speed-floating-menu';
  
  // Get current URL for display
  const currentUrl = window.location.hostname;
  
  menu.innerHTML = `
    <div class="menu-header">🎬 视频速度控制器</div>
    <div class="menu-status" id="menuStatus"></div>
    
    <div class="menu-section">
      <div class="menu-toggle-container">
        <span><strong>全局开关</strong></span>
        <div class="menu-toggle-switch" id="menuGlobalToggle">
          <div class="menu-toggle-slider"></div>
        </div>
      </div>
    </div>
    
    <div class="menu-section">
      <div class="menu-section-title">当前速度</div>
      <div class="menu-speed-display" id="menuSpeedDisplay">${currentSpeed.toFixed(2)}x</div>
      <div class="menu-button-group">
        <button class="menu-btn" id="menuDecreaseBtn">- 降低</button>
        <button class="menu-btn" id="menuIncreaseBtn">+ 提高</button>
      </div>
    </div>
    
    <div class="menu-section">
      <div class="menu-section-title">预设速度切换</div>
      <div class="menu-speed-display" id="menuPresetDisplay">${settings.presetSpeed.toFixed(2)}x</div>
      <div class="menu-button-group">
        <button class="menu-btn" id="menuPresetBtn">切换预设</button>
      </div>
    </div>
    
    <div class="menu-section">
      <div class="menu-button-group">
        <button class="menu-secondary-btn" id="menuResetBtn">重置速度</button>
        <button class="menu-secondary-btn" id="menuOptionsBtn">规则设置</button>
        <button class="menu-secondary-btn" id="menuShortcutsBtn">快捷键</button>
      </div>
    </div>
    
    <div class="menu-section">
      <div class="menu-section-title">设置管理</div>
      <div class="menu-button-group">
        <button class="menu-export-btn" id="menuExportBtn">📤 导出</button>
        <button class="menu-import-btn" id="menuImportBtn">📥 导入</button>
      </div>
    </div>
    
    <div class="menu-keyboard-hint">
      ⌨️ 快捷键：<br>
      Ctrl+Shift+→ 提高速度<br>
      Ctrl+Shift+← 降低速度
    </div>
    
    <div class="menu-info">
      当前页面: <span id="menuCurrentUrl">${currentUrl}</span>
    </div>
    
    <div class="menu-close-hint">点击空白处或再次点击悬浮球关闭</div>
  `;
  
  menu.style.cssText = `
    position: fixed;
    bottom: 90px;
    right: 20px;
    width: 320px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 10000;
    font-family: Arial, sans-serif;
    font-size: 14px;
    color: #333;
    max-height: 80vh;
    overflow-y: auto;
  `;
  
  // Add menu styles
  const menuStyle = document.createElement('style');
  menuStyle.textContent = `
    #video-speed-floating-menu .menu-header {
      font-size: 16px;
      font-weight: bold;
      margin-bottom: 12px;
      color: #333;
      border-bottom: 2px solid #4CAF50;
      padding: 12px 15px;
      background: #f5f5f5;
      border-radius: 8px 8px 0 0;
    }
    
    #video-speed-floating-menu .menu-section {
      margin-bottom: 12px;
      padding: 0 15px;
    }
    
    #video-speed-floating-menu .menu-section-title {
      font-weight: bold;
      margin-bottom: 6px;
      color: #555;
    }
    
    #video-speed-floating-menu .menu-toggle-container {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    
    #video-speed-floating-menu .menu-toggle-switch {
      position: relative;
      width: 50px;
      height: 24px;
      background: #ccc;
      border-radius: 12px;
      cursor: pointer;
      transition: background 0.3s;
    }
    
    #video-speed-floating-menu .menu-toggle-switch.active {
      background: #4CAF50;
    }
    
    #video-speed-floating-menu .menu-toggle-slider {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 20px;
      height: 20px;
      background: white;
      border-radius: 50%;
      transition: transform 0.3s;
    }
    
    #video-speed-floating-menu .menu-toggle-switch.active .menu-toggle-slider {
      transform: translateX(26px);
    }
    
    #video-speed-floating-menu .menu-speed-display {
      text-align: center;
      font-size: 24px;
      font-weight: bold;
      color: #4CAF50;
      margin: 8px 0;
    }
    
    #video-speed-floating-menu .menu-button-group {
      display: flex;
      gap: 8px;
      margin-top: 8px;
    }
    
    #video-speed-floating-menu .menu-btn {
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 4px;
      background: #4CAF50;
      color: white;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    
    #video-speed-floating-menu .menu-btn:hover {
      background: #45a049;
    }
    
    #video-speed-floating-menu .menu-btn:active {
      transform: scale(0.98);
    }
    
    #video-speed-floating-menu .menu-secondary-btn {
      background: #2196F3;
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 4px;
      color: white;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    
    #video-speed-floating-menu .menu-secondary-btn:hover {
      background: #0b7dda;
    }
    
    #video-speed-floating-menu .menu-export-btn {
      background: #FF9800;
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 4px;
      color: white;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    
    #video-speed-floating-menu .menu-export-btn:hover {
      background: #e68900;
    }
    
    #video-speed-floating-menu .menu-import-btn {
      background: #9C27B0;
      flex: 1;
      padding: 8px;
      border: none;
      border-radius: 4px;
      color: white;
      cursor: pointer;
      font-size: 13px;
      transition: background 0.2s;
    }
    
    #video-speed-floating-menu .menu-import-btn:hover {
      background: #7b1fa2;
    }
    
    #video-speed-floating-menu .menu-keyboard-hint {
      background: #f0f0f0;
      padding: 8px;
      border-radius: 4px;
      font-size: 11px;
      color: #555;
      margin-top: 8px;
      line-height: 1.4;
    }
    
    #video-speed-floating-menu .menu-info {
      font-size: 12px;
      color: #666;
      margin-top: 10px;
      text-align: center;
      padding: 8px 15px;
      border-top: 1px solid #eee;
    }
    
    #video-speed-floating-menu .menu-status {
      padding: 6px;
      border-radius: 4px;
      text-align: center;
      font-size: 12px;
      margin: 0 15px 10px;
    }
    
    #video-speed-floating-menu .menu-status.enabled {
      background: #d4edda;
      color: #155724;
      border: 1px solid #c3e6cb;
    }
    
    #video-speed-floating-menu .menu-status.disabled {
      background: #f8d7da;
      color: #721c24;
      border: 1px solid #f5c6cb;
    }
    
    #video-speed-floating-menu .menu-close-hint {
      font-size: 10px;
      color: #999;
      text-align: center;
      padding: 8px 15px;
      background: #fafafa;
      border-radius: 0 0 8px 8px;
    }
  `;
  
  document.head.appendChild(menuStyle);
  document.body.appendChild(menu);
  
  // Initialize menu state
  updateMenuUI();
  
  // Add event listeners for menu controls
  setupMenuEventListeners();
  
  // Close menu when clicking outside
  setTimeout(() => {
    const closeHandler = (e) => {
      if (!menu.contains(e.target) && !e.target.closest('#video-speed-float-ball')) {
        menu.remove();
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 100);
}

// Update menu UI based on current state
function updateMenuUI() {
  const menu = document.getElementById('video-speed-floating-menu');
  if (!menu) return;
  
  // Update toggle
  const toggle = menu.querySelector('#menuGlobalToggle');
  const status = menu.querySelector('#menuStatus');
  if (settings.globalEnabled) {
    toggle.classList.add('active');
    status.className = 'menu-status enabled';
    status.textContent = '✓ 全局功能已开启';
  } else {
    toggle.classList.remove('active');
    status.className = 'menu-status disabled';
    status.textContent = '✗ 全局功能已关闭';
  }
  
  // Update speed displays
  const speedDisplay = menu.querySelector('#menuSpeedDisplay');
  if (speedDisplay) {
    speedDisplay.textContent = `${currentSpeed.toFixed(2)}x`;
  }
  
  const presetDisplay = menu.querySelector('#menuPresetDisplay');
  if (presetDisplay) {
    presetDisplay.textContent = `${settings.presetSpeed.toFixed(2)}x`;
  }
  
  // Update current URL
  const urlSpan = menu.querySelector('#menuCurrentUrl');
  if (urlSpan) {
    urlSpan.textContent = window.location.hostname;
  }
}

// Set up event listeners for menu controls
function setupMenuEventListeners() {
  const menu = document.getElementById('video-speed-floating-menu');
  if (!menu) return;
  
  // Global toggle
  const toggle = menu.querySelector('#menuGlobalToggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      settings.globalEnabled = !settings.globalEnabled;
      chrome.runtime.sendMessage({
        action: 'saveSettings',
        settings: settings
      }, () => {
        updateMenuUI();
        // Notify current tab
        chrome.runtime.sendMessage({ action: 'reloadSettings' });
      });
    });
  }
  
  // Decrease speed
  const decreaseBtn = menu.querySelector('#menuDecreaseBtn');
  if (decreaseBtn) {
    decreaseBtn.addEventListener('click', () => {
      decreaseSpeed();
      updateMenuUI();
    });
  }
  
  // Increase speed
  const increaseBtn = menu.querySelector('#menuIncreaseBtn');
  if (increaseBtn) {
    increaseBtn.addEventListener('click', () => {
      increaseSpeed();
      updateMenuUI();
    });
  }
  
  // Preset speed
  const presetBtn = menu.querySelector('#menuPresetBtn');
  if (presetBtn) {
    presetBtn.addEventListener('click', () => {
      presetSpeed();
      updateMenuUI();
    });
  }
  
  // Reset speed
  const resetBtn = menu.querySelector('#menuResetBtn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      currentSpeed = settings.defaultSpeed || 1.0;
      applySpeedToVideos();
      showSpeedIndicator('重置速度');
      updateMenuUI();
    });
  }
  
  // Options button
  const optionsBtn = menu.querySelector('#menuOptionsBtn');
  if (optionsBtn) {
    optionsBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openOptions' });
    });
  }
  
  // Shortcuts button
  const shortcutsBtn = menu.querySelector('#menuShortcutsBtn');
  if (shortcutsBtn) {
    shortcutsBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'openShortcutsPage' });
    });
  }
  
  // Export button
  const exportBtn = menu.querySelector('#menuExportBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      // Ensure arrays are initialized before export
      if (!Array.isArray(settings.includeRules)) {
        settings.includeRules = [];
      }
      if (!Array.isArray(settings.excludeRules)) {
        settings.excludeRules = [];
      }
      
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        settings: settings
      };
      
      const dataStr = JSON.stringify(exportData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `video-speed-controller-settings-${Date.now()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      // Show temporary feedback
      const originalText = exportBtn.textContent;
      exportBtn.textContent = '✓ 已导出';
      exportBtn.style.background = '#4CAF50';
      setTimeout(() => {
        exportBtn.textContent = originalText;
        exportBtn.style.background = '#FF9800';
      }, 1500);
    });
  }
  
  // Import button
  const importBtn = menu.querySelector('#menuImportBtn');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      // Create hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = '.json';
      fileInput.style.display = 'none';
      
      fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = function(e) {
          try {
            const importData = JSON.parse(e.target.result);
            
            // Validate import data
            if (!importData.settings) {
              throw new Error('无效的导入文件格式');
            }
            
            const importedSettings = importData.settings;
            
            // Validate required fields - allow undefined for arrays and convert to empty arrays
            if (typeof importedSettings.globalEnabled !== 'boolean' ||
                (importedSettings.excludeRules !== undefined && !Array.isArray(importedSettings.excludeRules)) ||
                (importedSettings.includeRules !== undefined && !Array.isArray(importedSettings.includeRules)) ||
                typeof importedSettings.defaultSpeed !== 'number' ||
                typeof importedSettings.presetSpeed !== 'number') {
              throw new Error('导入的设置数据格式不正确');
            }
            
            // Normalize arrays
            if (!Array.isArray(importedSettings.excludeRules)) {
              importedSettings.excludeRules = [];
            }
            if (!Array.isArray(importedSettings.includeRules)) {
              importedSettings.includeRules = [];
            }
            
            // Validate speed values
            if (importedSettings.defaultSpeed < 0.25 || importedSettings.defaultSpeed > 16.0 ||
                importedSettings.presetSpeed < 0.25 || importedSettings.presetSpeed > 16.0) {
              throw new Error('速度值必须在 0.25 到 16.0 之间');
            }
            
            // Validate regex patterns
            for (const rule of importedSettings.excludeRules) {
              try {
                new RegExp(rule);
              } catch (e) {
                throw new Error(`无效的排除规则正则表达式: ${rule}`);
              }
            }
            
            for (const rule of importedSettings.includeRules) {
              try {
                new RegExp(rule);
              } catch (e) {
                throw new Error(`无效的生效规则正则表达式: ${rule}`);
              }
            }
            
            // Confirm import - ensure arrays are defined for length check
            const includeRulesLength = Array.isArray(importedSettings.includeRules) ? importedSettings.includeRules.length : 0;
            const excludeRulesLength = Array.isArray(importedSettings.excludeRules) ? importedSettings.excludeRules.length : 0;
            
            if (confirm(`确定导入设置吗？\n\n导入的设置将覆盖当前设置：\n- 全局功能: ${importedSettings.globalEnabled ? '启用' : '禁用'}\n- 默认速度: ${importedSettings.defaultSpeed}x\n- 预设速度: ${importedSettings.presetSpeed}x\n- 生效规则: ${includeRulesLength} 条\n- 排除规则: ${excludeRulesLength} 条`)) {
              
              // 应用导入的设置 - 确保数据完整性
              settings = {
                globalEnabled: importedSettings.globalEnabled !== false,
                excludeRules: Array.isArray(importedSettings.excludeRules) ? importedSettings.excludeRules : [],
                includeRules: Array.isArray(importedSettings.includeRules) ? importedSettings.includeRules : [],
                defaultSpeed: importedSettings.defaultSpeed || 1.0,
                presetSpeed: importedSettings.presetSpeed || 2.0
              };
              
              chrome.runtime.sendMessage({
                action: 'saveSettings',
                settings: settings
              }, (response) => {
                if (response && response.success) {
                  updateMenuUI();
                  // Show feedback
                  const originalText = importBtn.textContent;
                  importBtn.textContent = '✓ 导入成功';
                  importBtn.style.background = '#4CAF50';
                  setTimeout(() => {
                    importBtn.textContent = originalText;
                    importBtn.style.background = '#9C27B0';
                  }, 1500);
                   
                  // Notify current tab
                  chrome.runtime.sendMessage({ action: 'reloadSettings' });
                } else {
                  alert('导入失败');
                }
              });
            }
            
          } catch (error) {
            alert('导入失败: ' + error.message);
          }
          
          // 清空文件输入
          event.target.value = '';
        };
        
        reader.onerror = function() {
          alert('文件读取失败');
          event.target.value = '';
        };
        
        reader.readAsText(file);
      });
      
      document.body.appendChild(fileInput);
      fileInput.click();
      document.body.removeChild(fileInput);
    });
  }
}

// Check if any element is in fullscreen mode
function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

// Update floating ball display
function updateFloatingBall() {
  const ball = document.getElementById('video-speed-float-ball');
  if (ball) {
    const display = ball.querySelector('.speed-display');
    if (display) {
      display.textContent = `${currentSpeed.toFixed(2)}x`;
    }
    
    // Check if should hide floating ball
    if (settings.hideFloatingBall) {
      ball.style.display = 'none';
      return;
    }
    
    // Hide ball if in fullscreen mode
    if (isFullscreen()) {
      ball.style.display = 'none';
      return;
    }
    
    // Show/hide based on whether speed should be applied
    if (shouldApplySpeed()) {
      ball.style.display = 'flex';
      ball.style.opacity = '1';
    } else {
      ball.style.opacity = '0.3';
    }
  }
}

// Initialize
loadSettings();
loadCustomShortcuts(); // 加载自定义快捷键

// Create floating ball after a short delay
setTimeout(() => {
  if (shouldApplySpeed() && !settings.hideFloatingBall) {
    createFloatingBall();
  }
}, 1000);

// Re-apply when page visibility changes (for SPA navigation)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    setTimeout(() => {
      checkAndApplySpeed();
      updateFloatingBall();
    }, 500);
  }
});

// Handle fullscreen change - hide/show floating ball
document.addEventListener('fullscreenchange', updateFloatingBall);
document.addEventListener('webkitfullscreenchange', updateFloatingBall);
document.addEventListener('mozfullscreenchange', updateFloatingBall);
document.addEventListener('MSFullscreenChange', updateFloatingBall);

// Handle dynamic video elements (for sites like YouTube)
setInterval(() => {
  if (shouldApplySpeed()) {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (Math.abs(video.playbackRate - currentSpeed) > 0.01) {
        video.playbackRate = currentSpeed;
      }
    });
    updateFloatingBall();
  }
}, 1000);