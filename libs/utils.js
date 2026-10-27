/**
 * Page-level UI helpers (ES module — extension pages only).
 * Content scripts use `AIO.dom` / `AIO.log` from libs/core.js instead.
 */
import './core.js';

const { escapeHtml, log } = globalThis.AIO.core;
const uiLog = log('ui');

/**
 * Show a toast in the shared #statusMessage element.
 * @param {string} message
 * @param {'success'|'error'|'info'} [type]
 */
export function showStatus(message, type = 'success') {
    const el = document.getElementById('statusMessage');
    if (!el) {
        uiLog.info(message);
        return;
    }
    el.textContent = message;
    el.className = 'status-msg show ' + type;
    clearTimeout(showStatus._timer);
    showStatus._timer = setTimeout(() => el.classList.remove('show'), 3200);
}

export { escapeHtml };

export const debounce = globalThis.AIO.core.debounce;
export const throttle = globalThis.AIO.core.throttle;
