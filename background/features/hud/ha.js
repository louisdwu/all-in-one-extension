/**
 * Home Assistant data source.
 * One request per configured entity; failures are reported per row, never thrown.
 */
import '../../../libs/core.js';

const { log } = globalThis.AIO.core;
const haLog = log('hud:ha');

function cleanUrl(url) {
    return String(url || '').replace(/[\s\r\n]/g, '').replace(/\/+$/, '');
}

function cleanToken(token) {
    return String(token || '').replace(/[\s\r\n]/g, '').replace(/[^\x20-\x7E]/g, '');
}

export function haQueueKey(entityId) {
    return 'ha_' + String(entityId).replace(/[\s\r\n]/g, '');
}

/** Origin match pattern for a user-provided HA URL ("http://host:8123/*"). */
export function haOriginPattern(url) {
    try {
        const parsed = new URL(String(url || ''));
        if (!/^https?:$/.test(parsed.protocol)) return null;
        return parsed.origin + '/*';
    } catch (err) {
        return null;
    }
}

/**
 * Home Assistant lives on an arbitrary (usually private) origin, so it is
 * covered by optional_host_permissions and the user grants it from the options
 * page. Without the grant, a service-worker fetch would fail with an opaque
 * CORS error — we detect that up front and report it.
 */
export async function hasHaPermission(pattern) {
    if (!pattern) return false;
    try {
        return await chrome.permissions.contains({ origins: [pattern] });
    } catch (err) {
        return false;
    }
}

/**
 * @param {object} settings normalized settings
 * @returns {Promise<{metrics: object, ok: boolean}>}
 */
export async function fetchHa(settings) {
    const base = cleanUrl(settings.haUrl);
    const token = cleanToken(settings.haToken);
    const entities = Array.isArray(settings.haEntities) ? settings.haEntities : [];
    if (!base || !token || !entities.length) return { metrics: {}, ok: false, reason: 'unconfigured' };

    const originPattern = haOriginPattern(base);
    if (originPattern && !(await hasHaPermission(originPattern))) {
        haLog.debug('missing host permission for', originPattern);
        return { metrics: {}, ok: false, reason: 'needs_permission', origin: originPattern };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const metrics = {};
    let ok = false;

    await Promise.all(entities.map(async (entity) => {
        const key = haQueueKey(entity.id);
        try {
            const response = await fetch(base + '/api/states/' + encodeURIComponent(entity.id), {
                headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                signal: controller.signal
            });
            if (!response.ok) {
                metrics[key] = { name: entity.name, value: 'HTTP' + response.status, error: true };
                return;
            }
            const data = await response.json();
            const value = data && data.state != null ? String(data.state) : '?';
            metrics[key] = { name: entity.name, value, raw: data.state, error: false };
            ok = true;
        } catch (err) {
            haLog.debug('fetch failed for', entity.id, err.message);
            metrics[key] = { name: entity.name, value: 'X', error: true };
        }
    }));

    clearTimeout(timeout);
    return { metrics, ok };
}

/** Colour thresholds are configured per entity in the options page. */
export function colorForEntity(entity, rawValue) {
    const value = parseFloat(rawValue);
    if (!entity || Number.isNaN(value)) return null;
    const warn = parseFloat(entity.warn);
    const crit = parseFloat(entity.crit);
    if (entity.op === '<') {
        if (!Number.isNaN(crit) && value <= crit) return 'critical';
        if (!Number.isNaN(warn) && value <= warn) return 'warning';
    } else {
        if (!Number.isNaN(crit) && value >= crit) return 'critical';
        if (!Number.isNaN(warn) && value >= warn) return 'warning';
    }
    return null;
}
