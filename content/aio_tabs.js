/**
 * Right-mouse + wheel tab switcher (ISOLATED world).
 *
 * Behaviour is unchanged from the original, but the implementation now:
 *  - does nothing at all (no listeners) when the feature is disabled
 *  - lives entirely in a shadow root so page CSS cannot break it
 *  - cancels cleanly on Escape / blur / window switch
 */
(function () {
    'use strict';

    const AIO = window.AIO;
    if (!AIO || !AIO.content) return;
    const { log, settings, onChange } = AIO.content;
    const uiLog = log('tabs');

    const ICON_FALLBACK = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI+PHBhdGggZmlsbD0iI2NjYyIgZD0iTTggMTJhNCA0IDAgMSAwIDAtOCA0IDQgMCAwIDAgMCA4em0wIDFBNSA1IDAgMSAxIDggM2E1IDUgMCAwIDEgMCAxMHoiLz48L3N2Zz4=';

    const CSS = `
        :host { all: initial; }
        .backdrop {
            position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
            pointer-events: none; z-index: 2147483647;
        }
        .panel {
            width: 620px; max-width: 82vw; max-height: 70vh; overflow-y: auto; padding: 10px;
            border-radius: 16px; pointer-events: auto;
            background: rgba(28, 28, 30, .82); backdrop-filter: blur(18px) saturate(1.2);
            border: 1px solid rgba(255,255,255,.12); box-shadow: 0 24px 60px rgba(0,0,0,.45);
            font: 14px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            scrollbar-width: none;
        }
        .panel::-webkit-scrollbar { display: none; }
        .row {
            display: flex; align-items: center; gap: 12px; padding: 9px 12px; border-radius: 9px;
            color: #e5e5e7; cursor: pointer; transition: background .12s ease;
        }
        .row.active { background: rgba(255,255,255,.16); color: #fff; transform: scale(1.01); }
        .row .icon { width: 16px; height: 16px; border-radius: 3px; flex: none; }
        .row .title { flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
        .row .index { font-size: 11px; opacity: .5; font-variant-numeric: tabular-nums; }
        .row .badge { font-size: 11px; opacity: .7; }
        .hint { text-align: center; color: rgba(255,255,255,.45); font-size: 11px; padding: 6px 0 2px; }
    `;

    let enabled = false;
    let delay = 1000;
    let wrap = true;

    let host = null;
    let shadow = null;
    let panel = null;
    let tabs = [];
    let selected = 0;
    let visible = false;
    let rightDown = false;
    let timer = null;
    let requestSeq = 0;

    const cleanups = [];

    function close() {
        visible = false;
        rightDown = false;
        if (timer) clearTimeout(timer);
        timer = null;
        if (host) {
            host.remove();
            host = null;
            shadow = null;
            panel = null;
        }
        tabs = [];
        selected = 0;
    }

    function ensureUI() {
        if (host && host.isConnected) return true;
        host = document.createElement('div');
        host.id = 'aio-tab-switcher-host';
        shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = CSS;
        shadow.appendChild(style);
        const backdrop = document.createElement('div');
        backdrop.className = 'backdrop';
        panel = document.createElement('div');
        panel.className = 'panel';
        backdrop.appendChild(panel);
        shadow.appendChild(backdrop);
        (document.body || document.documentElement).appendChild(host);
        return true;
    }

    function render() {
        if (!panel) return;
        const fragment = document.createDocumentFragment();
        tabs.forEach((tab, index) => {
            const row = document.createElement('div');
            row.className = 'row' + (index === selected ? ' active' : '');
            const icon = document.createElement('img');
            icon.className = 'icon';
            icon.src = tab.favIconUrl || ICON_FALLBACK;
            icon.addEventListener('error', () => { icon.src = ICON_FALLBACK; }, { once: true });
            const title = document.createElement('div');
            title.className = 'title';
            title.textContent = tab.title || tab.url || '';
            row.append(icon, title);
            if (tab.audible) {
                const badge = document.createElement('span');
                badge.className = 'badge';
                badge.textContent = '🔊';
                row.appendChild(badge);
            }
            const index2 = document.createElement('span');
            index2.className = 'index';
            index2.textContent = String(index + 1);
            row.appendChild(index2);
            fragment.appendChild(row);
        });
        const hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = '滚轮切换 · 松开右键确认 · Esc 取消';
        fragment.appendChild(hint);
        panel.replaceChildren(fragment);
        scrollToSelected();
    }

    function scrollToSelected() {
        if (!panel) return;
        const active = panel.querySelector('.row.active');
        if (!active) return;
        const top = active.offsetTop - panel.clientHeight / 2 + active.clientHeight / 2;
        panel.scrollTo({ top, behavior: 'smooth' });
    }

    async function open() {
        if (visible) return;
        const seq = ++requestSeq;
        const response = await AIO.core.sendMessage({ type: 'tabs:list' });
        if (seq !== requestSeq || !response || !Array.isArray(response.tabs) || response.tabs.length < 2) return;
        tabs = response.tabs;
        const currentIndex = tabs.findIndex((tab) => tab.active);
        selected = currentIndex === -1 ? 0 : currentIndex;
        visible = true;
        ensureUI();
        render();
    }

    function move(delta) {
        if (!tabs.length) return;
        const next = selected + delta;
        selected = wrap
            ? (next + tabs.length) % tabs.length
            : Math.min(tabs.length - 1, Math.max(0, next));
        render();
    }

    async function commit() {
        const target = tabs[selected];
        if (!target) return;
        await AIO.core.sendMessage({ type: 'tabs:activate', tabId: target.id });
    }

    /* ---------------------------- listeners ---------------------------- */

    function attach() {
        const onMouseDown = (event) => {
            if (event.button !== 2 || !enabled) return;
            rightDown = true;
            if (timer) clearTimeout(timer);
            if (delay > 0) {
                timer = setTimeout(() => { if (rightDown) open(); }, delay);
            } else {
                open();
            }
        };

        const onWheel = (event) => {
            if (!rightDown || !enabled) return;
            if (!visible) {
                if (timer) clearTimeout(timer);
                open();
            }
            if (!tabs.length) return;
            event.preventDefault();
            event.stopPropagation();
            move(event.deltaY > 0 ? 1 : -1);
        };

        const onMouseUp = (event) => {
            if (event.button !== 2) return;
            if (!rightDown) return;
            rightDown = false;
            if (timer) clearTimeout(timer);
            timer = null;
            if (visible) {
                commit();
                // Swallow the context menu that would otherwise open on mouseup.
                setTimeout(close, 0);
            }
        };

        const onContextMenu = (event) => {
            if (!visible) return;
            event.preventDefault();
            event.stopPropagation();
        };

        const onKeyDown = (event) => {
            if (!visible) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };

        cleanups.push(AIO.core.dom.listen(window, 'mousedown', onMouseDown, true));
        cleanups.push(AIO.core.dom.listen(window, 'wheel', onWheel, { passive: false, capture: true }));
        cleanups.push(AIO.core.dom.listen(window, 'mouseup', onMouseUp, true));
        cleanups.push(AIO.core.dom.listen(window, 'contextmenu', onContextMenu, true));
        cleanups.push(AIO.core.dom.listen(window, 'keydown', onKeyDown, true));
        cleanups.push(AIO.core.dom.listen(window, 'blur', close, true));
    }

    function detach() {
        close();
        while (cleanups.length) {
            try { cleanups.pop()(); } catch (err) { /* ignore */ }
        }
    }

    function apply(settings) {
        enabled = settings.aioTabsEnabled === true;
        delay = settings.aioTabsDelay;
        wrap = settings.aioTabsWrap !== false;
        if (enabled && !cleanups.length) attach();
        if (!enabled && cleanups.length) detach();
    }

    settings().then(apply);
    onChange(apply);
    uiLog.debug('ready');
})();
