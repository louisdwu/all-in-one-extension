/**
 * Bilibili Subtitle Controller
 * 负责自动开启字幕（优先中文字幕，次选 AI 生成）
 */

(function() {
  let bilibiliSettings = {
    autoEnableSubtitle: true,
    subtitleHotkey: 's'
  };

  // 从存储加载设置
  function loadSettings() {
    // 聚合所有 B 站相关的配置
    chrome.storage.sync.get([
      'bilibiliSubtitles', 
      'bilibili1080PEnabled', 
      'biliCommentsEnabled', 
      'biliAISubtitleEnabled',
      'biliCookies',
      'biliAutoPlay'
    ], (res) => {
      // 1. 本地逻辑配置
      if (res.bilibiliSubtitles) {
        bilibiliSettings = {
          autoEnableSubtitle: res.bilibiliSubtitles.autoEnableSubtitle !== false,
          subtitleHotkey: res.bilibiliSubtitles.subtitleHotkey || 's'
        };
      }

      // 2. 桥接配置：将 Cookies 写入到 Bilibili 原生 localStorage，以便 MAIN script 能同步读取
      const oldBridge = localStorage.getItem('aio_bili_cookies');
      const inIncognito = chrome.extension.inIncognitoContext;

      // 仅在无痕模式下同步 Cookies
      if (inIncognito && res.biliCookies && res.biliCookies.sessdata) {
          const newBridge = JSON.stringify(res.biliCookies);
          if (oldBridge !== newBridge) {
              localStorage.setItem('aio_bili_cookies', newBridge);
              document.cookie = `SESSDATA=${res.biliCookies.sessdata}; path=/; domain=.bilibili.com`;
              if (res.biliCookies.dedeUserId) {
                  document.cookie = `DedeUserID=${res.biliCookies.dedeUserId}; path=/; domain=.bilibili.com`;
              }
              console.log('[AIO Bili] Detected new cookies in Incognito. Syncing and reloading...');
              location.reload();
              return;
          }
      } else if (!inIncognito && oldBridge) {
          // 如果切回普通模式且残留了无痕专用桥接，清除它
          localStorage.removeItem('aio_bili_cookies');
      }

      // 3. 注入给 MAIN World 的常规配置
      const mainConfig = {
        bili1080PEnabled: res.bilibili1080PEnabled !== false,
        biliCommentsEnabled: res.biliCommentsEnabled !== false,
        biliAISubtitleEnabled: res.biliAISubtitleEnabled !== false,
        biliAutoPlay: !!res.biliAutoPlay,
        inIncognito: inIncognito
      };
      document.documentElement.setAttribute('data-aio-bili-config', JSON.stringify(mainConfig));

      if (bilibiliSettings.autoEnableSubtitle) {
        initAutoSubtitle();
      }
    });
  }

  // 自动开启字幕逻辑
  function initAutoSubtitle() {
    const observer = new MutationObserver((mutations, obs) => {
      const subtitleBtn = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle');
      if (subtitleBtn) {
        // 找到了字幕按钮，尝试开启
        setTimeout(() => enableSubtitle(subtitleBtn), 1000); // 等待播放器初始化稳定
        obs.disconnect();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function enableSubtitle(btn) {
    // 1. 检查是否已经开启（如果已经开启，就不重复操作）
    // 通常通过观察 .bpx-player-ctrl-subtitle-close-switch 是否 active 来判断
    
    // 模拟点击打开菜单（如果需要）
    const event = new MouseEvent('mouseenter', { bubbles: true });
    btn.dispatchEvent(event);
    
    // 等待菜单显示
    await new Promise(r => setTimeout(r, 500));
    
    const menu = document.querySelector('.bpx-player-ctrl-subtitle-menu');
    if (!menu) return;

    // 检查是否已经是开启状态（关闭开关不带 active 类则视为开启，或者某项语言带 active）
    const closeSwitch = menu.querySelector('.bpx-player-ctrl-subtitle-close-switch');
    if (closeSwitch && !closeSwitch.classList.contains('bpx-state-active')) {
      console.log('[BiliSub] 字幕似乎已经开启');
      return;
    }

    // 2. 寻找目标字幕项
    const items = Array.from(menu.querySelectorAll('.bpx-player-ctrl-subtitle-language-item'));
    
    // 优先级 1: 官方中文字幕 (data-lan="zh-Hans")
    let target = items.find(item => item.getAttribute('data-lan') === 'zh-Hans');
    
    // 优先级 2: 文案包含“中文”但不是“AI”的
    if (!target) {
      target = items.find(item => item.innerText.includes('中文') && !item.innerText.includes('AI'));
    }
    
    // 优先级 3: AI 生成字幕 (data-lan="ai-zh")
    if (!target) {
      target = items.find(item => item.getAttribute('data-lan') === 'ai-zh');
    }
    
    // 优先级 4: 文案包含“AI”的
    if (!target) {
      target = items.find(item => item.innerText.includes('AI'));
    }

    if (target) {
      console.log('[BiliSub] 正在自动开启字幕:', target.innerText);
      target.click();
    } else {
      console.log('[BiliSub] 未找到可用中文字幕');
    }

    // 移开鼠标隐藏菜单
    const leaveEvent = new MouseEvent('mouseleave', { bubbles: true });
    btn.dispatchEvent(leaveEvent);
  }

  // 快捷键切换字幕
  function toggleSubtitle() {
    const btn = document.querySelector('.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle');
    if (!btn) return;

    // 模拟打开菜单获取状态
    btn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    
    setTimeout(() => {
      const menu = document.querySelector('.bpx-player-ctrl-subtitle-menu');
      if (!menu) return;

      const closeSwitch = menu.querySelector('.bpx-player-ctrl-subtitle-close-switch');
      const activeItem = menu.querySelector('.bpx-player-ctrl-subtitle-language-item.bpx-state-active');

      if (activeItem) {
        // 当前有字幕，点击“关闭”
        if (closeSwitch) closeSwitch.click();
      } else {
        // 当前无字幕，尝试开启第一个中文字幕
        const items = Array.from(menu.querySelectorAll('.bpx-player-ctrl-subtitle-language-item'));
        const target = items.find(i => i.innerText.includes('中文')) || items[0];
        if (target) target.click();
      }

      btn.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    }, 200);
  }

  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggleSubtitle') {
      toggleSubtitle();
      sendResponse({ success: true });
    } else if (request.action === 'reloadSettings') {
      loadSettings();
    }
  });

  // 监听本地键盘事件（支持单按键 s）
  document.addEventListener('keydown', (e) => {
    // 如果在输入框中，不触发
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }

    if (e.key.toLowerCase() === bilibiliSettings.subtitleHotkey.toLowerCase()) {
      // 检查是否有修饰键需求（如果用户配置了 Ctrl+s 等，这里可以扩展逻辑）
      // 目前简单处理单按键
      toggleSubtitle();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // 初始化加载
  loadSettings();
})();
