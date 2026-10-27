/**
 * Shared helpers for the options page modules.
 *
 * Every module used to re-implement "read storage, coerce types, write back,
 * show toast"; that is where the duplicated defaults and the doubled subtitle
 * toggle came from. All of it now funnels through the schema.
 */
import '../../libs/core.js';
import '../../libs/schema.js';

const AIO = globalThis.AIO;
export const { schema, core } = AIO;
export const uiLog = core.log('options');

/** Visual feedback in the shared toast element. */
export function toast(message, level = 'success') {
    const element = document.getElementById('statusMessage');
    if (!element) return;
    element.textContent = message;
    element.className = 'status-msg show ' + level;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove('show'), 3000);
}

export function on(el, type, handler, options) {
    if (el) el.addEventListener(type, handler, options);
    return el;
}

/** Wire a checkbox to a boolean settings key. */
export function bindToggle(id, key, { save = true } = {}) {
    const input = document.getElementById(id);
    if (!input) return null;
    input.addEventListener('change', async () => {
        if (!save) return;
        await schema.save({ [key]: input.checked });
        uiLog.debug('saved', key, input.checked);
    });
    return input;
}

/** Wire a select to a settings key, coercing numbers when the value is numeric. */
export function bindSelect(id, key, { numeric = true } = {}) {
    const select = document.getElementById(id);
    if (!select) return null;
    select.addEventListener('change', async () => {
        const value = numeric ? parseFloat(select.value) : select.value;
        await schema.save({ [key]: value });
    });
    return select;
}

/** Wire a text/number input; debounced so typing does not hammer storage. */
export function bindInput(id, key, { numeric = false, debounceMs = 400, transform } = {}) {
    const input = document.getElementById(id);
    if (!input) return null;
    const commit = core.debounce(async () => {
        let value = input.value;
        if (numeric) {
            value = parseFloat(value);
            if (!isFinite(value)) return;
        }
        if (transform) value = transform(value);
        await schema.save({ [key]: value });
    }, debounceMs);
    input.addEventListener('input', commit);
    return input;
}

/** Show the incognito-access status text below the modifier selector. */
export async function renderIncognitoState(targetId = 'ez-incognito-state') {
    const el = document.getElementById(targetId);
    if (!el) return;
    const allowed = await new Promise((resolve) => {
        try {
            chrome.extension.isAllowedIncognitoAccess((value) => resolve(!!value));
        } catch (err) {
            resolve(false);
        }
    });
    el.textContent = allowed
        ? '✅ 已允许在无痕窗口运行'
        : '⚠️ 未允许无痕模式：请在 chrome://extensions 的扩展详情中开启「在无痕模式下启用」。';
    el.style.color = allowed ? '' : 'var(--warning)';
}

/** Format a timestamp for the HUD status bars. */
export function formatTime(timestamp) {
    if (!timestamp) return '从未';
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
        ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}

/** Same K-suffix formatting the HUD uses on the icon, for previewing values. */
export function formatMetric(value, round) {
    if (value === undefined || value === null || value === '') return '--';
    const num = parseFloat(value);
    if (!isFinite(num) || !round) return String(value);
    if (Math.abs(num) >= 1000) {
        let text = (num / 1000).toFixed(1);
        if (text.endsWith('.0')) text = text.slice(0, -2);
        return text + 'K';
    }
    return String(Math.round(num));
}
