try {
    importScripts(
        "aio_tabs.js",
        "ezincognito.js",
        "hotkey_changer.js",
        "smart_speeder.js",
        "bilibili_subtitles.js",
        "bilibili_1080p.js",
        "hud/utils.js",
        "hud/renderer.js",
        "hud/ha_api.js",
        "hud/waqi_api.js",
        "hud/index.js"
    );
    console.log('[All in One Extension] All background scripts loaded successfully.');

    // Initialize HUD service layer
    if (typeof setupHUDAlarms === 'function') {
        setupHUDAlarms();
    }
    if (typeof registerHUDEvents === 'function') {
        registerHUDEvents();
    }
} catch (e) {
    console.error('[All in One Extension] Failed to load background scripts', e);
}
