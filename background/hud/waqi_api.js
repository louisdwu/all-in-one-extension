async function fetchWAQIData(settings) {
    if (!settings.waqiToken) return {};
    
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
        const common = { error: false, raw: data };

        const metricsMap = {
            'aqi': { name: 'AQI', value: data.data.aqi },
            'o3': { name: '臭氧', value: iaqi.o3?.v },
            'pm25': { name: 'PM2.5', value: iaqi.pm25?.v },
            'pm10': { name: 'PM10', value: iaqi.pm10?.v },
            'no2': { name: 'NO2', value: iaqi.no2?.v },
            'so2': { name: 'SO2', value: iaqi.so2?.v },
            'co': { name: 'CO', value: iaqi.co?.v },
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
        aqi: 'AQI', o3: '臭氧', pm25: 'PM2.5', pm10: 'PM10',
        no2: 'NO2', so2: 'SO2', co: 'CO', 
        t: 'T(站)', h: 'H(站)', p: 'P(站)', w: 'W(站)'
    };
    
    keys.forEach(key => {
        results[`waqi_${key}`] = { ...errorObj, name: names[key] };
    });
    return results;
}

