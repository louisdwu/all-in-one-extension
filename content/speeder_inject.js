/**
 * All-in-One Extension: Smart Speeder MAIN World 注入脚本
 * 
 * WHY: 抖音等网站会通过 Object.defineProperty 劫持 playbackRate setter、
 *      监听 ratechange 事件、或使用定时器轮询来强制重置视频速度。
 *      Content Script 运行在 isolated world，无法直接对抗主页面的 JS 劫持。
 *      此脚本注入到 MAIN world，通过重新定义 playbackRate 的 getter/setter
 *      来"锁定"速度，使网站的重置逻辑失效。
 * 
 * 通信机制: 通过 CustomEvent 与 Content Script 双向通信。
 */

(function () {
    'use strict';

    // 防止重复注入
    if (window.__aioSpeedLockInstalled) return;
    window.__aioSpeedLockInstalled = true;

    /** @type {WeakMap<HTMLVideoElement, number>} 存储每个 video 的锁定速度 */
    const lockedSpeeds = new WeakMap();

    /** @type {boolean} 速度锁定是否激活 */
    let lockEnabled = false;

    /** @type {number} 全局目标速度 */
    let targetSpeed = 1.0;

    // 保存原始的 playbackRate descriptor
    const proto = HTMLVideoElement.prototype;
    const originalDescriptor = Object.getOwnPropertyDescriptor(proto, 'playbackRate');

    if (!originalDescriptor) return;

    /**
     * 重新定义 playbackRate 的 getter/setter
     * 当锁定启用时，setter 会忽略非扩展的写入
     */
    Object.defineProperty(proto, 'playbackRate', {
        configurable: true,
        enumerable: true,
        get() {
            return originalDescriptor.get.call(this);
        },
        set(val) {
            if (lockEnabled && lockedSpeeds.has(this)) {
                // 锁定状态下，仅允许设置为锁定速度
                const locked = lockedSpeeds.get(this);
                if (Math.abs(val - locked) > 0.001) {
                    // 外部尝试修改 → 拒绝，强制回写锁定速度
                    originalDescriptor.set.call(this, locked);
                    return;
                }
            }
            originalDescriptor.set.call(this, val);
        }
    });

    /**
     * 拦截 ratechange 事件，阻止网站在事件回调中重置速度
     */
    const origAddEventListener = EventTarget.prototype.addEventListener;
    const rateChangeHandlers = new WeakMap();

    EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (type === 'ratechange' && this instanceof HTMLVideoElement && lockEnabled) {
            // 包装 listener，在锁定状态下不触发原始回调
            const wrappedListener = function (e) {
                if (lockEnabled && lockedSpeeds.has(e.target)) {
                    return; // 吞掉事件
                }
                return listener.call(this, e);
            };
            // 保存映射以便 removeEventListener 正常工作
            if (!rateChangeHandlers.has(this)) {
                rateChangeHandlers.set(this, new Map());
            }
            rateChangeHandlers.get(this).set(listener, wrappedListener);
            return origAddEventListener.call(this, type, wrappedListener, options);
        }
        return origAddEventListener.call(this, type, listener, options);
    };

    const origRemoveEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
        if (type === 'ratechange' && rateChangeHandlers.has(this)) {
            const map = rateChangeHandlers.get(this);
            if (map.has(listener)) {
                origRemoveEventListener.call(this, type, map.get(listener), options);
                map.delete(listener);
                return;
            }
        }
        return origRemoveEventListener.call(this, type, listener, options);
    };

    /**
     * 应用速度到所有 video 元素
     */
    function applyLockedSpeed(speed) {
        targetSpeed = speed;
        document.querySelectorAll('video').forEach(v => {
            lockedSpeeds.set(v, speed);
            originalDescriptor.set.call(v, speed);
        });
    }

    /**
     * 解除所有 video 的速度锁定
     */
    function unlockAll() {
        document.querySelectorAll('video').forEach(v => {
            lockedSpeeds.delete(v);
        });
    }

    /**
     * 监听新出现的 video 元素，自动应用锁定速度
     */
    const videoObserver = new MutationObserver(() => {
        if (!lockEnabled) return;
        document.querySelectorAll('video').forEach(v => {
            if (!lockedSpeeds.has(v)) {
                lockedSpeeds.set(v, targetSpeed);
                if (v.readyState >= 2) {
                    originalDescriptor.set.call(v, targetSpeed);
                } else {
                    v.addEventListener('loadeddata', function onLoaded() {
                        if (lockEnabled && lockedSpeeds.has(v)) {
                            originalDescriptor.set.call(v, lockedSpeeds.get(v));
                        }
                        v.removeEventListener('loadeddata', onLoaded);
                    });
                }
            }
        });
    });

    if (document.body) {
        videoObserver.observe(document.body, { childList: true, subtree: true });
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            videoObserver.observe(document.body, { childList: true, subtree: true });
        });
    }

    /**
     * 与 Content Script 通信（通过 CustomEvent）
     */
    window.addEventListener('aio-speed-lock', (e) => {
        const { action, speed } = e.detail || {};
        switch (action) {
            case 'lock':
                lockEnabled = true;
                applyLockedSpeed(speed || targetSpeed);
                break;
            case 'unlock':
                lockEnabled = false;
                unlockAll();
                break;
            case 'update':
                if (lockEnabled) {
                    applyLockedSpeed(speed || targetSpeed);
                }
                break;
            case 'query':
                window.dispatchEvent(new CustomEvent('aio-speed-lock-response', {
                    detail: { lockEnabled, targetSpeed }
                }));
                break;
        }
    });
})();
