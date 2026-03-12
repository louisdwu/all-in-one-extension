try {
    importScripts(
        "aio_tabs.js",
        "ezincognito.js",
        "hotkey_changer.js",
        "smart_speeder.js",
        "home_assistant.js",
        "bilibili_subtitles.js"
    );
    console.log('[All in One Extension] All background scripts loaded successfully.');
} catch (e) {
    console.error('[All in One Extension] Failed to load background scripts', e);
}
