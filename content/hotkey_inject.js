// Hotkey Changer - Inject Script (运行在页面上下文 MAIN world)
// 这个脚本直接在页面上下文中执行，可以拦截和修改事件监听器

(function() {
  'use strict';
  
  console.log('[Hotkey Changer] Inject script starting...');
  
  // 存储快捷键映射 - 格式: { "F": "H" } 表示把F的功能转移到H键
  window.__hotkeyChangerMappings = {};
  window.__hotkeyChangerEnabled = true;
  
  // 反向映射缓存 - 格式: { "H": "F" } 表示按H时模拟F
  window.__hotkeyChangerReverseMappings = {};
  
  // 更新反向映射
  function updateReverseMappings() {
    window.__hotkeyChangerReverseMappings = {};
    for (const [original, newKey] of Object.entries(window.__hotkeyChangerMappings)) {
      window.__hotkeyChangerReverseMappings[newKey] = original;
    }
  }
  
  // 监听来自content script的配置更新
  window.addEventListener('__hotkeyChangerUpdate', (e) => {
    if (e.detail.type === 'mappings') {
      window.__hotkeyChangerMappings = e.detail.data || {};
      updateReverseMappings();
      console.log('[Hotkey Changer] Mappings updated:', window.__hotkeyChangerMappings);
      console.log('[Hotkey Changer] Reverse mappings:', window.__hotkeyChangerReverseMappings);
    } else if (e.detail.type === 'enabled') {
      window.__hotkeyChangerEnabled = e.detail.data;
      console.log('[Hotkey Changer] Enabled:', window.__hotkeyChangerEnabled);
    }
  });
  
  // 生成按键标识符
  function getKeyIdentifier(event) {
    const parts = [];
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    parts.push(event.key.toUpperCase());
    return parts.join('+');
  }
  
  // 解析按键标识符
  function parseKeyIdentifier(identifier) {
    const parts = identifier.split('+');
    const key = parts.pop();
    return {
      ctrlKey: parts.includes('Ctrl'),
      altKey: parts.includes('Alt'),
      shiftKey: parts.includes('Shift'),
      metaKey: parts.includes('Meta'),
      key: key
    };
  }
  
  // 获取按键的 keyCode
  function getKeyCodeNumber(key) {
    const upperKey = key.toUpperCase();
    if (upperKey.length === 1) {
      return upperKey.charCodeAt(0);
    }
    const specialKeyCodes = {
      'ENTER': 13, 'ESCAPE': 27, 'SPACE': 32, 'TAB': 9,
      'BACKSPACE': 8, 'DELETE': 46,
      'ARROWUP': 38, 'ARROWDOWN': 40, 'ARROWLEFT': 37, 'ARROWRIGHT': 39,
      'F1': 112, 'F2': 113, 'F3': 114, 'F4': 115,
      'F5': 116, 'F6': 117, 'F7': 118, 'F8': 119,
      'F9': 120, 'F10': 121, 'F11': 122, 'F12': 123
    };
    return specialKeyCodes[upperKey] || 0;
  }
  
  // 获取按键的 code
  function getKeyCode(key) {
    const upperKey = key.toUpperCase();
    if (upperKey.length === 1) {
      if (upperKey >= 'A' && upperKey <= 'Z') {
        return 'Key' + upperKey;
      }
      if (upperKey >= '0' && upperKey <= '9') {
        return 'Digit' + upperKey;
      }
    }
    const specialKeys = {
      'ENTER': 'Enter', 'ESCAPE': 'Escape', 'SPACE': 'Space',
      'TAB': 'Tab', 'BACKSPACE': 'Backspace', 'DELETE': 'Delete',
      'ARROWUP': 'ArrowUp', 'ARROWDOWN': 'ArrowDown',
      'ARROWLEFT': 'ArrowLeft', 'ARROWRIGHT': 'ArrowRight',
      'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
      'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
      'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12'
    };
    return specialKeys[upperKey] || upperKey;
  }
  
  // 创建修改后的事件代理
  function createModifiedEventProxy(event, newKeyInfo) {
    return new Proxy(event, {
      get(target, prop) {
        switch(prop) {
          case 'key':
            return newKeyInfo.key.length === 1 ? newKeyInfo.key.toLowerCase() : newKeyInfo.key;
          case 'code':
            return getKeyCode(newKeyInfo.key);
          case 'keyCode':
          case 'which':
            return getKeyCodeNumber(newKeyInfo.key);
          case 'ctrlKey':
            return newKeyInfo.ctrlKey;
          case 'altKey':
            return newKeyInfo.altKey;
          case 'shiftKey':
            return newKeyInfo.shiftKey;
          case 'metaKey':
            return newKeyInfo.metaKey;
          default:
            const value = target[prop];
            if (typeof value === 'function') {
              return value.bind(target);
            }
            return value;
        }
      }
    });
  }
  
  // 处理键盘事件，返回可能被修改的事件
  function processKeyEvent(event) {
    if (!window.__hotkeyChangerEnabled) {
      return { event, blocked: false };
    }
    
    // 检查是否在输入框中
    const tagName = event.target.tagName ? event.target.tagName.toLowerCase() : '';
    const isEditable = event.target.isContentEditable;
    if (tagName === 'input' || tagName === 'textarea' || isEditable) {
      return { event, blocked: false };
    }
    
    // 获取当前按键标识符
    const keyIdentifier = getKeyIdentifier(event);
    
    // 使用反向映射查找：当按下新按键时，模拟原始按键
    // 例如映射 F→H，反向映射 H→F，按H时模拟F
    const targetKey = window.__hotkeyChangerReverseMappings[keyIdentifier];
    
    if (targetKey) {
      console.log('[Hotkey Changer] Transforming', keyIdentifier, 'to', targetKey);
      const newKeyInfo = parseKeyIdentifier(targetKey);
      return { event: createModifiedEventProxy(event, newKeyInfo), blocked: false };
    }
    
    // 检查是否按下了原始按键，如果是则阻止（因为功能已转移）
    if (window.__hotkeyChangerMappings[keyIdentifier]) {
      console.log('[Hotkey Changer] Blocking original key:', keyIdentifier);
      return { event, blocked: true };
    }
    
    return { event, blocked: false };
  }
  
  // 核心：重写 addEventListener 来拦截键盘事件
  const originalAddEventListener = EventTarget.prototype.addEventListener;
  const originalRemoveEventListener = EventTarget.prototype.removeEventListener;
  
  // 存储包装后的监听器映射
  const listenerMap = new WeakMap();
  
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (['keydown', 'keyup', 'keypress'].includes(type) && typeof listener === 'function') {
      // 创建包装函数
      const wrappedListener = function(event) {
        const { event: processedEvent, blocked } = processKeyEvent(event);
        
        // 如果事件被阻止，不调用原始监听器
        if (blocked) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        
        return listener.call(this, processedEvent);
      };
      
      // 保存映射关系以便后续移除
      if (!listenerMap.has(listener)) {
        listenerMap.set(listener, new Map());
      }
      const key = type + '_' + (options?.capture ? 'capture' : 'bubble');
      listenerMap.get(listener).set(key, wrappedListener);
      
      return originalAddEventListener.call(this, type, wrappedListener, options);
    }
    
    return originalAddEventListener.call(this, type, listener, options);
  };
  
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    if (['keydown', 'keyup', 'keypress'].includes(type) && typeof listener === 'function') {
      const listenerMappings = listenerMap.get(listener);
      if (listenerMappings) {
        const key = type + '_' + (options?.capture ? 'capture' : 'bubble');
        const wrappedListener = listenerMappings.get(key);
        if (wrappedListener) {
          listenerMappings.delete(key);
          return originalRemoveEventListener.call(this, type, wrappedListener, options);
        }
      }
    }
    return originalRemoveEventListener.call(this, type, listener, options);
  };
  
  // 处理 document 上的 onkeydown/onkeyup/onkeypress
  const docHandlerStorage = {};
  
  ['keydown', 'keyup', 'keypress'].forEach(eventType => {
    const propertyName = 'on' + eventType;
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, propertyName);
    
    if (originalDescriptor) {
      Object.defineProperty(document, propertyName, {
        get() {
          return docHandlerStorage[propertyName] || null;
        },
        set(handler) {
          // 移除旧的处理程序
          if (docHandlerStorage[propertyName + '_wrapped']) {
            originalRemoveEventListener.call(document, eventType, docHandlerStorage[propertyName + '_wrapped']);
          }
          
          docHandlerStorage[propertyName] = handler;
          
          if (handler) {
            const wrappedHandler = function(event) {
              const { event: processedEvent, blocked } = processKeyEvent(event);
              if (blocked) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              return handler.call(this, processedEvent);
            };
            docHandlerStorage[propertyName + '_wrapped'] = wrappedHandler;
            originalAddEventListener.call(document, eventType, wrappedHandler);
          } else {
            delete docHandlerStorage[propertyName + '_wrapped'];
          }
        },
        configurable: true
      });
    }
  });
  
  console.log('[Hotkey Changer] Inject script loaded successfully!');
})();