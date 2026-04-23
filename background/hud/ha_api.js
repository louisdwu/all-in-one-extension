// === HA API logic (Classic Script) ===

async function fetchHAEntities(settings) {
    if (!settings.haUrl || !settings.haToken || !settings.haEntities || settings.haEntities.length === 0) {
        return {}; // Nothing to fetch or missing config
    }

    const cleanUrl = settings.haUrl.replace(/[\s\r\n]/g, '').replace(/\/+$/, '');
    const cleanToken = settings.haToken.replace(/[\s\r\n]/g, '').replace(/[^\x20-\x7E]/g, '');
    const results = {};

    for (const entity of settings.haEntities) {
        const cleanId = entity.id.replace(/[\s\r\n]/g, '');
        const apiUrl = `${cleanUrl}/api/states/${cleanId}`;
        const queueKey = `ha_${entity.id}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + cleanToken,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                results[queueKey] = { name: entity.name, value: 'ERR', error: true };
                continue;
            }

            const data = await response.json();
            const displayText = formatDisplayText(data.state);
            results[queueKey] = { name: entity.name, value: displayText, error: false };
        } catch (error) {
            console.error(`HA Fetch failed for ${entity.name}:`, error.message);
            results[queueKey] = { name: entity.name, value: 'X', error: true };
        }
    }

    return results;
}

async function updateHASensor(settings, entityId, state, attributes = {}) {
    if (!settings.haUrl || !settings.haToken) return;

    const cleanUrl = settings.haUrl.replace(/[\s\r\n]/g, '').replace(/\/+$/, '');
    const cleanToken = settings.haToken.replace(/[\s\r\n]/g, '').replace(/[^\x20-\x7E]/g, '');
    const apiUrl = `${cleanUrl}/api/states/${entityId}`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + cleanToken,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                state: state,
                attributes: {
                    ...attributes,
                    last_updated_by: 'AIO Extension Scraper'
                }
            })
        });

        if (response.ok) {
            return { success: true };
        } else {
            const errText = await response.text();
            return { success: false, error: `HA Error: ${response.status} - ${errText}` };
        }
    } catch (err) {
        console.error('[All in One Extension] Failed to push to HA', err);
        return { success: false, error: err.message };
    }
}

