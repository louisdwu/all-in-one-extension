/**
 * Modifier + click → open the link in an incognito window.
 *
 * Fixes over the original: the link lookup walks the event's composed path (so
 * links inside shadow DOM work), downloads and non-left clicks are ignored, and
 * a blocked incognito mode now produces a visible explanation instead of a
 * silent failure.
 */
(function () {
    'use strict';

    const AIO = window.AIO;
    if (!AIO || !AIO.content) return;
    const { log, settings, onChange } = AIO.content;
    const incogLog = log('ezincognito');

    let enabled = true;
    let modifier = 'ctrlKey';
    let installed = false;

    function findLink(event) {
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
        for (const node of path) {
            if (node && node.nodeType === 1 && node.tagName === 'A' && node.href) return node;
        }
        return null;
    }

    function onClick(event) {
        if (!enabled || event.button !== 0 || !event[modifier]) return;
        if (event.defaultPrevented) return;
        const link = findLink(event);
        if (!link || !link.href) return;
        if (link.hasAttribute('download')) return;
        if (!/^https?:/i.test(link.href)) return;

        event.preventDefault();
        event.stopPropagation();
        AIO.core.sendMessage({ type: 'incognito:open', url: link.href }).then((result) => {
            if (result && result.ok === false && result.error !== 'incognito_disabled') {
                incogLog.warn('open failed', result.error);
            }
        });
    }

    function apply(settings) {
        enabled = settings.ezEnabled !== false;
        modifier = settings.modifierKey || 'ctrlKey';
        if (enabled && !installed) {
            document.addEventListener('click', onClick, true);
            installed = true;
        } else if (!enabled && installed) {
            document.removeEventListener('click', onClick, true);
            installed = false;
        }
    }

    settings().then(apply);
    onChange(apply);

    // Background toasts (e.g. incognito access not granted).
    AIO.core.onMessage((message) => {
        if (message && message.type === 'aio:toast') {
            AIO.content.toast(message.message, message.level || 'info');
            return { ok: true };
        }
        return undefined;
    });
})();
