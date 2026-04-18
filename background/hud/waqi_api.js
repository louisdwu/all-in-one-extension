// === WAQI API logic (Classic Script) ===

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
        
        if (settings.waqiMetrics?.aqi) {
            results['waqi_aqi'] = { name: 'AQI', value: data.data.aqi, error: false, raw: data };
        }
        if (settings.waqiMetrics?.o3) {
            results['waqi_o3'] = { name: '臭氧', value: iaqi.o3?.v || 'N/A', error: false, raw: data };
        }
        if (settings.waqiMetrics?.pm25) {
            results['waqi_pm25'] = { name: 'PM2.5', value: iaqi.pm25?.v || 'N/A', error: false, raw: data };
        }
        if (settings.waqiMetrics?.pm10) {
            results['waqi_pm10'] = { name: 'PM10', value: iaqi.pm10?.v || 'N/A', error: false, raw: data };
        }
        
        return results;
    } catch (err) {
        console.error('WAQI Fetch failed:', err);
        return generateWAQIError('CONN', settings.waqiMetrics);
    }
}

function generateWAQIError(code, metrics) {
    const errorObj = { value: code, error: true };
    const results = {};
    if (metrics?.aqi) results['waqi_aqi'] = { ...errorObj, name: 'AQI' };
    if (metrics?.o3) results['waqi_o3'] = { ...errorObj, name: '臭氧' };
    if (metrics?.pm25) results['waqi_pm25'] = { ...errorObj, name: 'PM2.5' };
    if (metrics?.pm10) results['waqi_pm10'] = { ...errorObj, name: 'PM10' };
    return results;
}
