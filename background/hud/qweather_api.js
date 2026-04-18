// === QWeather API logic (Classic Script) ===

/**
 * Helper to perform fetch with domain fallback
 */
async function callQWeather(endpoint, location, key, customHost) {
    // If custom host is set, use only that. Otherwise fallback between dev and biz
    const domains = customHost ? [customHost] : ['devapi.qweather.com', 'api.qweather.com'];
    let lastData = null;

    for (const domain of domains) {
        try {
            // Add timestamp to avoid cached error pages
            const url = `https://${domain}/v7/${endpoint}?location=${encodeURIComponent(location)}&key=${encodeURIComponent(key)}&t=${Date.now()}`;
            const res = await fetch(url);
            
            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.error(`QWeather parse failed from ${domain}:`, text.substring(0, 100));
                // Extract possible title from HTML if it is HTML
                const match = text.match(/<title>(.*?)<\/title>/i);
                lastData = { code: match ? `!${match[1].substring(0,4)}` : '!PARSE' };
                continue;
            }
            
            // If code is 200, we are good
            if (data.code === '200') return data;
            
            lastData = data;
            // If code is 401 or 402 and we ARE using default domains, keep trying next domain
            if (!customHost && (data.code === '401' || data.code === '402')) {
                continue; 
            } else {
                break; // Custom host failed or non-domain error
            }
        } catch (err) {
            console.error(`QWeather fetch failed on ${domain}:`, err.message);
            lastData = { code: '!NET' };
        }
    }
    return lastData;
}

async function fetchQWeather(settings) {
    if (!settings.qwKey || !settings.qwLocation) return {};
    if (!settings.qwMetrics || Object.values(settings.qwMetrics).every(v => !v)) return {};

    const cleanKey = settings.qwKey.trim();
    const cleanLocation = settings.qwLocation.trim();
    const customHost = settings.qwHost ? settings.qwHost.trim() : null;
    
    const needsAir = settings.qwMetrics.aqi || settings.qwMetrics.o3 || settings.qwMetrics.pm25 || settings.qwMetrics.pm10;
    const needsWeather = settings.qwMetrics.temp;

    const results = {};

    // 1. Fetch Air Quality data
    if (needsAir) {
        const data = await callQWeather('air/now', cleanLocation, cleanKey, customHost);
        if (data && data.code === '200' && data.now) {
            const common = { error: false, raw: data };
            if (settings.qwMetrics.aqi) results['qw_aqi'] = { ...common, name: 'AQI', value: data.now.aqi };
            if (settings.qwMetrics.o3) results['qw_o3'] = { ...common, name: '臭氧', value: data.now.o3 };
            if (settings.qwMetrics.pm25) results['qw_pm25'] = { ...common, name: 'PM2.5', value: data.now.pm2p5 };
            if (settings.qwMetrics.pm10) results['qw_pm10'] = { ...common, name: 'PM10', value: data.now.pm10 };
        } else {
            let errVal = 'ERR';
            if (data) {
                if (data.code) errVal = String(data.code);
                else {
                    const deepError = data.error || data;
                    if (typeof deepError === 'object' && deepError !== null) {
                        const val = deepError.message || deepError.msg || deepError.code || deepError.error_code || Object.values(deepError).find(v => typeof v === 'string');
                        errVal = `!${String(val || 'OBJ').substring(0, 4)}`;
                    } else {
                        errVal = `!${String(deepError).substring(0, 4)}`;
                    }
                }
            }
            const errorObj = { value: errVal, error: true, raw: data };
            if (settings.qwMetrics.aqi) results['qw_aqi'] = { ...errorObj, name: 'AQI' };
            if (settings.qwMetrics.o3) results['qw_o3'] = { ...errorObj, name: '臭氧' };
            if (settings.qwMetrics.pm25) results['qw_pm25'] = { ...errorObj, name: 'PM2.5' };
            if (settings.qwMetrics.pm10) results['qw_pm10'] = { ...errorObj, name: 'PM10' };
        }
    }

    // 2. Fetch basic weather data
    if (needsWeather) {
        const data = await callQWeather('weather/now', cleanLocation, cleanKey, customHost);
        if (data && data.code === '200' && data.now) {
            results['qw_temp'] = { name: '温度', value: data.now.temp, error: false, raw: data };
        } else {
            let errVal = 'ERR';
            if (data) {
                const deepError = data.error || data;
                if (typeof deepError === 'object' && deepError !== null) {
                    const val = deepError.message || deepError.msg || deepError.code || Object.values(deepError).find(v => typeof v === 'string');
                    errVal = `!${String(val || 'OBJ').substring(0, 4)}`;
                } else {
                    errVal = String(data.code || 'ERR');
                }
            }
            results['qw_temp'] = { name: '温度', value: errVal, error: true, raw: data };
        }
    }

    return results;
}


