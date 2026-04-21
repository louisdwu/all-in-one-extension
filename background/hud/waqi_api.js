async function fetchWAQIData(settings) {
    if (!settings.waqiToken) return {};
    
    // Check if any metrics are enabled before fetching (Robust check)
    const metrics = settings.waqiMetrics || {};
    const hasEnabledMetrics = Object.values(metrics).some(v => v === true || v === 'true');
    if (!hasEnabledMetrics) return {};

    const token = settings.waqiToken.trim();
    const city = (settings.waqiCity || 'here').trim() || 'here';
    
    const url = `https://api.waqi.info/feed/${city}/?token=${token}&t=${Date.now()}`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return generateWAQIError(`HTTP${response.status}`, settings.waqiMetrics);
        }
        
        const data = await response.json();
        if (data.status !== 'ok') {
            return generateWAQIError(data.data || 'ERR', settings.waqiMetrics);
        }
        
        const results = {};
        const iaqi = data.data.iaqi || {};
        const fetchTs = Date.now();
        
        let pubTs = data.data.time?.v * 1000; // API usually returns Unix seconds
        const pubStr = data.data.time?.s || '未知';
        
        // Defensive check: if pubTs is in the future (due to timezone mismatch), 
        // or abnormally small, try to re-anchor it using ISO string if available.
        // WAQI 'v' is local station time as unix seconds, which can be tricky.
        if (pubTs > fetchTs + 3600000) {
            // If it's more than 1 hour in the future, it might be a weird timezone issue from API
            console.warn('[HUD] WAQI published time is in the future, ignoring lag.');
            pubTs = fetchTs;
        }

        const lagMinutes = Math.max(0, Math.round((fetchTs - pubTs) / 60000));
        
        const common = { 
            error: false, 
            raw: data,
            fetchTs: fetchTs,
            pubTs: pubTs,
            pubStr: pubStr,
            lagMinutes: lagMinutes
        };

        const metricsMap = {
            'aqi': { name: 'AQI指数', value: data.data.aqi },
            'o3': { name: '臭氧(μg/m³)', value: AQI_CONVERTER.toConcentration(iaqi.o3?.v, 'o3') },
            'pm25': { name: 'PM2.5(μg/m³)', value: AQI_CONVERTER.toConcentration(iaqi.pm25?.v, 'pm25') },
            'pm10': { name: 'PM10(μg/m³)', value: AQI_CONVERTER.toConcentration(iaqi.pm10?.v, 'pm10') },
            'no2': { name: 'NO2(μg/m³)', value: AQI_CONVERTER.toConcentration(iaqi.no2?.v, 'no2') },
            'so2': { name: 'SO2(μg/m³)', value: AQI_CONVERTER.toConcentration(iaqi.so2?.v, 'so2') },
            'co': { name: 'CO(μg/m³)', value: AQI_CONVERTER.toConcentration(iaqi.co?.v, 'co') },
            't': { name: 'T(站)', value: iaqi.t?.v },
            'h': { name: 'H(站)', value: iaqi.h ? `${iaqi.h.v}%` : undefined },
            'p': { name: 'P(站)', value: iaqi.p?.v },
            'w': { name: 'W(站)', value: iaqi.w?.v }
        };

        for (const [key, config] of Object.entries(metricsMap)) {
            if (config.value !== undefined) {
                results[`waqi_${key}`] = { ...common, ...config };
            }
        }
        
        // Add metadata for indexing
        results._waqi_meta = { fetchTs, pubTs, pubStr, lagMinutes };
        
        return results;
    } catch (err) {
        console.error('WAQI Fetch failed:', err);
        return generateWAQIError('CONN');
    }
}

function generateWAQIError(code) {
    const errorObj = { value: code, error: true };
    const results = {};
    const keys = ['aqi', 'o3', 'pm25', 'pm10', 'no2', 'so2', 'co', 't', 'h', 'p', 'w'];
    const names = { 
        aqi: 'AQI指数', o3: '臭氧(μg/m³)', pm25: 'PM2.5(μg/m³)', pm10: 'PM10(μg/m³)',
        no2: 'NO2(μg/m³)', so2: 'SO2(μg/m³)', co: 'CO(μg/m³)', 
        t: 'T(站)', h: 'H(站)', p: 'P(站)', w: 'W(站)'
    };
    
    keys.forEach(key => {
        results[`waqi_${key}`] = { ...errorObj, name: names[key] };
    });
    return results;
}

