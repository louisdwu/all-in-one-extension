/**
 * WAQI (aqicn.org) data source.
 * Returns { metrics: { waqi_* }, meta: {...} } — never throws.
 */
import '../../../libs/core.js';
import '../../../libs/aqi.js';

const { log } = globalThis.AIO.core;
const waqiLog = log('hud:waqi');

const METRIC_META = {
    aqi: { name: 'AQI指数' },
    o3: { name: '臭氧(μg/m³)', convert: 'o3' },
    pm25: { name: 'PM2.5(μg/m³)', convert: 'pm25' },
    pm10: { name: 'PM10(μg/m³)', convert: 'pm10' },
    no2: { name: 'NO2(μg/m³)', convert: 'no2' },
    so2: { name: 'SO2(μg/m³)', convert: 'so2' },
    co: { name: 'CO(μg/m³)', convert: 'co' },
    t: { name: 'T(站)' },
    h: { name: 'H(站)', suffix: '%' },
    p: { name: 'P(站)' },
    w: { name: 'W(站)' }
};

export const WAQI_METRIC_KEYS = Object.keys(METRIC_META);

function errorMetrics(code) {
    const metrics = {};
    for (const key of WAQI_METRIC_KEYS) metrics['waqi_' + key] = { name: METRIC_META[key].name, value: code, error: true };
    return metrics;
}

export function enabledWaqiMetrics(settings) {
    const metrics = settings.waqiMetrics || {};
    return WAQI_METRIC_KEYS.filter((key) => metrics[key] === true);
}

/**
 * @param {object} settings normalized settings
 * @returns {Promise<{metrics: object, meta: object}>}
 */
export async function fetchWaqi(settings) {
    const enabled = enabledWaqiMetrics(settings);
    if (!settings.waqiToken || !enabled.length) return { metrics: {}, meta: null };

    const token = settings.waqiToken.trim();
    const city = (settings.waqiCity || 'here').trim() || 'here';
    const url = 'https://api.waqi.info/feed/' + encodeURIComponent(city) + '/?token=' + encodeURIComponent(token) + '&t=' + Date.now();

    let response;
    try {
        response = await fetch(url, { cache: 'no-store' });
    } catch (err) {
        waqiLog.warn('network error', err.message);
        return { metrics: errorMetrics('CONN'), meta: null };
    }
    if (!response.ok) return { metrics: errorMetrics('HTTP' + response.status), meta: null };

    let payload;
    try {
        payload = await response.json();
    } catch (err) {
        return { metrics: errorMetrics('JSON'), meta: null };
    }
    if (payload.status !== 'ok' || !payload.data) return { metrics: errorMetrics(String(payload.data || 'ERR')), meta: null };

    const iaqi = payload.data.iaqi || {};
    const fetchTs = Date.now();
    let pubTs = (payload.data.time && payload.data.time.v ? payload.data.time.v * 1000 : fetchTs);
    const pubStr = (payload.data.time && payload.data.time.s) || '未知';
    if (pubTs > fetchTs + 3600000) pubTs = fetchTs; // guard against station clock skew

    const metrics = {};
    const push = (key, value) => {
        if (value === undefined || value === null || Number.isNaN(value)) return;
        metrics['waqi_' + key] = {
            name: METRIC_META[key].name,
            value: METRIC_META[key].suffix ? value + METRIC_META[key].suffix : value,
            raw: value,
            error: false
        };
    };

    push('aqi', payload.data.aqi);
    for (const [key, meta] of Object.entries(METRIC_META)) {
        if (!meta.convert) continue;
        const source = iaqi[meta.convert];
        if (!source || source.v === undefined) continue;
        push(key, globalThis.AIO.aqi.toConcentration(source.v, meta.convert));
    }
    if (iaqi.t) push('t', iaqi.t.v);
    if (iaqi.h) push('h', iaqi.h.v);
    if (iaqi.p) push('p', iaqi.p.v);
    if (iaqi.w) push('w', iaqi.w.v);

    return {
        metrics,
        meta: { fetchTs, pubTs, pubStr, lagMinutes: Math.max(0, Math.round((fetchTs - pubTs) / 60000)) }
    };
}
