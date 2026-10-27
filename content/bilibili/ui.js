/**
 * Bilibili — subtitle automation + subtitle hotkey (ISOLATED world).
 *
 * Behaviour preserved from bilibili_subtitles.js, with three fixes:
 *  - no inline <script> injection (CSP-safe)
 *  - the "subtitle menu is already open" check is explicit instead of inverted
 *  - Reacts to config changes instead of requiring a page reload
 */
(function () {
    'use strict';

    const AIO = window.AIO;
    if (!AIO || !AIO.content) return;
    const { log, settings, onChange, isTopFrame, isEditable } = AIO.content;
    const subLog = log('bili:subtitle');

    const SUBTITLE_BUTTON = '.bpx-player-ctrl-btn.bpx-player-ctrl-subtitle';
    const SUBTITLE_MENU = '.bpx-player-ctrl-subtitle-menu';
    const MENU_ITEM = '.bpx-player-ctrl-subtitle-language-item';
    const CLOSE_SWITCH = '.bpx-player-ctrl-subtitle-close-switch';

    let config = { enabled: true, autoSubtitle: true, subtitleHotkey: 's' };
    let autoRan = false;

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    function hover(element, type) {
        element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }

    /** Pick the best available Chinese track: official > any Chinese > AI. */
    function pickTrack(items) {
        return items.find((item) => item.getAttribute('data-lan') === 'zh-Hans') ||
            items.find((item) => item.textContent.includes('中文') && !/AI/i.test(item.textContent)) ||
            items.find((item) => item.getAttribute('data-lan') === 'ai-zh') ||
            items.find((item) => /AI/i.test(item.textContent)) ||
            null;
    }

    async function enableSubtitle() {
        const button = document.querySelector(SUBTITLE_BUTTON);
        if (!button) return false;
        hover(button, 'mouseenter');
        await sleep(400);
        const menu = document.querySelector(SUBTITLE_MENU);
        if (!menu) {
            hover(button, 'mouseleave');
            return false;
        }

        const closeSwitch = menu.querySelector(CLOSE_SWITCH);
        // `bpx-state-active` on the "close subtitle" row means subtitles are OFF.
        const currentlyOn = closeSwitch && !closeSwitch.classList.contains('bpx-state-active');
        if (currentlyOn) {
            hover(button, 'mouseleave');
            return true;
        }

        const track = pickTrack(Array.from(menu.querySelectorAll(MENU_ITEM)));
        if (track) {
            track.click();
            subLog.debug('subtitle enabled:', track.textContent.trim());
        }
        hover(button, 'mouseleave');
        return !!track;
    }

    async function toggleSubtitle() {
        const button = document.querySelector(SUBTITLE_BUTTON);
        if (!button) return;
        hover(button, 'mouseenter');
        await sleep(200);
        const menu = document.querySelector(SUBTITLE_MENU);
        if (menu) {
            const closeSwitch = menu.querySelector(CLOSE_SWITCH);
            const activeItem = menu.querySelector(MENU_ITEM + '.bpx-state-active');
            if (activeItem) {
                if (closeSwitch) closeSwitch.click();
            } else {
                const track = pickTrack(Array.from(menu.querySelectorAll(MENU_ITEM)));
                if (track) track.click();
            }
        }
        hover(button, 'mouseleave');
    }

    /** Wait for the player controls, then auto-enable once per navigation. */
    function scheduleAutoSubtitle() {
        if (!isTopFrame || autoRan || !config.autoSubtitle) return;
        autoRan = true;
        AIO.core.dom.waitFor(SUBTITLE_BUTTON, { timeout: 20000 }).then(async (button) => {
            if (!button) return;
            await sleep(800);
            const ok = await enableSubtitle();
            subLog.debug('auto subtitle', ok ? 'enabled' : 'unavailable');
        });
    }

    document.addEventListener('keydown', (event) => {
        if (!isTopFrame || !config.enabled || isEditable(event.target)) return;
        if (event.ctrlKey || event.altKey || event.metaKey) return;
        const hotkey = (config.subtitleHotkey || 's').toLowerCase();
        if (event.key.toLowerCase() !== hotkey) return;
        event.preventDefault();
        event.stopPropagation();
        toggleSubtitle();
    }, true);

    // Bilibili is a SPA: a new video may load without a document reload.
    let lastUrl = location.href;
    AIO.core.rafThrottle(() => {
        if (location.href === lastUrl) return;
        lastUrl = location.href;
        autoRan = false;
        scheduleAutoSubtitle();
    });

    function apply(settingsValue) {
        config = {
            enabled: settingsValue.biliEnabled !== false,
            autoSubtitle: settingsValue.biliAutoSubtitle !== false,
            subtitleHotkey: settingsValue.bilibiliSubtitles.subtitleHotkey || 's'
        };
        if (config.enabled && config.autoSubtitle) scheduleAutoSubtitle();
    }

    settings().then(apply);
    onChange(apply);

    AIO.core.onMessage((message) => {
        if (message && message.type === 'bili:toggleSubtitle') {
            toggleSubtitle();
            return { ok: true };
        }
        return undefined;
    });
})();
