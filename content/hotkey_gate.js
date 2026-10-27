/**
 * Hotkey remapper — ISOLATED bridge (formerly hotkey_changer.js).
 *
 * The MAIN-world injector cannot read chrome.storage, so this script publishes
 * the resolved configuration on a DOM attribute. Using an attribute instead of
 * a CustomEvent means the injector can read the *current* value at any time
 * (no race on document_start) and has no dependency on event ordering.
 */
(function () {
    'use strict';

    const AIO = window.AIO;
    if (!AIO || !AIO.content) return;
    const { log, isTopFrame } = AIO.content;
    const gateLog = log('hotkeys');

    const HOSTNAME = location.hostname;
    let lastPublished = '';

    function publish(settings) {
        const mappings = (settings.hotkeyMappings && settings.hotkeyMappings[HOSTNAME]) || {};
        const siteDisabled = settings.enabledSites && settings.enabledSites[HOSTNAME] === false;
        const enabled = settings.hotkeyEnabled !== false && !siteDisabled;
        const payload = JSON.stringify({ enabled: enabled && Object.keys(mappings).length > 0, hostname: HOSTNAME, mappings });
        if (payload === lastPublished) return;
        lastPublished = payload;
        try {
            document.documentElement.setAttribute('data-aio-hotkeys', payload);
        } catch (err) {
            gateLog.debug('publish failed', err.message);
        }
        if (enabled && Object.keys(mappings).length) gateLog.debug('published', Object.keys(mappings).length, 'mappings');
    }

    AIO.content.settings().then(publish);
    AIO.content.onChange(publish);
})();
