/**
 * AQI → mass concentration converter (HJ 633-2012).
 * Converts the per-pollutant IAQI reported by WAQI back into μg/m³ (CO: μg/m³ too).
 * Pure math, unit-tested against the standard's breakpoint table.
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.aqi) return;

    const IAQI_BREAKS = [0, 50, 100, 150, 200, 300, 400, 500];

    const CONCENTRATION_BREAKS = {
        o3: [0, 160, 200, 300, 400, 800, 1000, 1200],      // 1h mean, μg/m³
        no2: [0, 100, 200, 700, 1200, 2340, 3090, 3840],    // 1h mean, μg/m³
        so2: [0, 150, 500, 800, 1600, 2100, 2620, 3140],    // 1h mean, μg/m³
        co: [0, 5, 10, 35, 60, 90, 120, 150],               // 1h mean, mg/m³
        pm25: [0, 35, 75, 115, 150, 250, 350, 500],         // 24h mean
        pm10: [0, 50, 150, 250, 350, 420, 500, 600]         // 24h mean
    };

    /**
     * @param {number} iaqi individual AQI value
     * @param {string} pollutant o3|no2|so2|co|pm25|pm10
     * @returns {number|null} concentration (μg/m³), rounded to 0.1
     */
    function toConcentration(iaqi, pollutant) {
        const value = typeof iaqi === 'number' ? iaqi : parseFloat(iaqi);
        if (!isFinite(value) || value < 0) return null;
        const key = String(pollutant || '').toLowerCase();
        const breaks = CONCENTRATION_BREAKS[key];
        if (!breaks) return value; // unknown pollutant: pass the IAQI through

        const clamped = Math.min(value, 500);
        let index = IAQI_BREAKS.length - 2;
        for (let i = 0; i < IAQI_BREAKS.length - 1; i++) {
            if (clamped <= IAQI_BREAKS[i + 1]) { index = i; break; }
        }

        const iaqiLow = IAQI_BREAKS[index];
        const iaqiHigh = IAQI_BREAKS[index + 1];
        const bpLow = breaks[index];
        const bpHigh = breaks[index + 1];
        if (iaqiHigh === iaqiLow) return bpLow;

        let concentration = ((clamped - iaqiLow) / (iaqiHigh - iaqiLow)) * (bpHigh - bpLow) + bpLow;
        if (key === 'co') concentration *= 1000; // mg/m³ → μg/m³
        return Math.round(concentration * 10) / 10;
    }

    AIO.aqi = { IAQI_BREAKS, CONCENTRATION_BREAKS, toConcentration };

    // Backward-compatibility alias for the legacy classic background loader.
    // Removed once background/ is fully module-based (see docs/IMPROVEMENT_PLAN.md).
    if (!root.AQI_CONVERTER) root.AQI_CONVERTER = AIO.aqi;
})(typeof globalThis !== 'undefined' ? globalThis : self);
