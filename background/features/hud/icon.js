/**
 * Extension-icon renderer for the HUD.
 *
 * Rendering four PNG-sized canvases on every carousel tick is wasteful, so the
 * imageData objects are memoised per (text, colour) pair.
 */
import '../../../libs/core.js';

const { log } = globalThis.AIO.core;
const iconLog = log('hud:icon');

const SIZES = [16, 32, 48, 128];
const DEFAULT_ICONS = {
    16: '/icons/icon16.png',
    32: '/icons/icon32.png',
    48: '/icons/icon48.png',
    128: '/icons/icon128.png'
};

const imageCache = new Map();
let lastKey = '';
let lastTitle = '';

function roundRect(ctx, size) {
    const radius = Math.round(size * 0.15);
    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();
}

function render(text, color, size) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');
    roundRect(ctx, size);
    ctx.fillStyle = color;
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const length = String(text).length;
    const fontRatio = length <= 2 ? 0.7 : length === 3 ? 0.6 : length === 4 ? 0.5 : 0.4;
    ctx.font = 'bold ' + Math.round(size * fontRatio) + 'px Arial, sans-serif';
    ctx.fillText(String(text), size / 2, size / 2 + 1);
    return ctx.getImageData(0, 0, size, size);
}

function imageDataFor(text, color) {
    const key = text + '|' + color;
    let entry = imageCache.get(key);
    if (!entry) {
        entry = {};
        for (const size of SIZES) entry[size] = render(text, color, size);
        if (imageCache.size > 64) imageCache.clear();
        imageCache.set(key, entry);
    }
    return entry;
}

/** Draw `text` on `color` and push it to the toolbar icon. */
export function setIcon(name, text, color) {
    const label = String(text == null ? '--' : text);
    const key = label + '|' + color;
    if (key === lastKey) return; // nothing changed: skip the PNG encoding
    lastKey = key;
    try {
        chrome.action.setIcon({ imageData: imageDataFor(label, color) });
        const title = 'HUD: ' + (name || 'monitor') + ' = ' + label;
        if (title !== lastTitle) {
            chrome.action.setTitle({ title });
            lastTitle = title;
        }
        chrome.action.setBadgeText({ text: '' });
    } catch (err) {
        iconLog.warn('setIcon failed', err.message);
    }
}

/** Restore the packaged icon (HUD disabled or nothing configured). */
export function resetIcon(title) {
    lastKey = 'default';
    try {
        chrome.action.setIcon({ path: DEFAULT_ICONS });
        chrome.action.setBadgeText({ text: '' });
        chrome.action.setTitle({ title: title || 'All in One Extension' });
        lastTitle = title || '';
    } catch (err) {
        iconLog.warn('resetIcon failed', err.message);
    }
}

export function invalidateIconCache() {
    imageCache.clear();
    lastKey = '';
}
