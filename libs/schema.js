/**
 * AIO settings schema — the single source of truth for every stored option.
 *
 * Why this exists: the old code spread defaults across ~10 files
 * (`result.x !== false`, `chrome.storage.sync.get({ hudEnabled: true })`, ...), so
 * a missing key silently changed behaviour and two keys could describe the same
 * switch (`biliAutoSubtitle` vs `bilibiliSubtitles.autoEnableSubtitle`).
 *
 * Storage layout is intentionally still FLAT with the legacy key names, because
 * users already have data in `chrome.storage.sync` (which is quota-bound and
 * synced across devices). `migrate()` upgrades old shapes in place.
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.schema) return;

    const SCHEMA_VERSION = 2;

    const DEFAULT_SHORTCUTS = {
        increaseSpeed: 'Ctrl+Shift+ArrowRight',
        decreaseSpeed: 'Ctrl+Shift+ArrowLeft',
        presetSpeed: 'Ctrl+Shift+Space'
    };

    const DEFAULTS = {
        // ---- global / meta ----
        aioSchemaVersion: SCHEMA_VERSION,
        aioDebug: false,

        // ---- tab switcher ----
        aioTabsEnabled: true,
        aioTabsDelay: 1000,
        aioTabsWrap: true,

        // ---- incognito link opener ----
        ezEnabled: true,
        modifierKey: 'ctrlKey',

        // ---- hotkey remapper ----
        hotkeyEnabled: true,
        hotkeyMappings: {},
        enabledSites: {},

        // ---- smart speeder (flat keys kept for backward compatibility) ----
        globalEnabled: true,
        hideFloatingBall: false,
        excludeRules: [],
        includeRules: [],
        defaultSpeed: 1,
        presetSpeed: '2.0',
        shortcuts: Object.assign({}, DEFAULT_SHORTCUTS),
        /** 'off' | 'global' | 'site' — see libs/speed_memory.js */
        speederSpeedMemory: 'site',
        speederMinRate: 0.25,
        speederMaxRate: 16,
        speederStep: 0.25,

        // ---- bilibili ----
        biliEnabled: true,
        biliAutoSubtitle: true,
        bilibiliSubtitles: { autoEnableSubtitle: true, subtitleHotkey: 's' },
        bilibili1080PEnabled: true,
        biliCommentsEnabled: true,
        biliAISubtitleEnabled: true,
        biliAutoPlay: false,
        biliPlayNextDisabled: false,
        biliCookies: { sessdata: '', dedeUserId: '' },

        // ---- HUD ----
        hudEnabled: true,
        hudIconRound: true,
        hudCarouselInterval: 5,
        waqiToken: '',
        waqiCity: '',
        waqiRefreshRate: 60,
        waqiMetrics: { aqi: false, o3: true, pm25: false, pm10: false, no2: false, so2: false, co: false, t: false, h: false, p: false, w: false },
        haUrl: '',
        haToken: '',
        haRefreshRate: 1,
        haEntities: []
    };

    /** Storage keys that are written back to sync storage. */
    const PERSISTED_KEYS = Object.keys(DEFAULTS);

    const WAQI_METRIC_KEYS = ['aqi', 'o3', 'pm25', 'pm10', 'no2', 'so2', 'co', 't', 'h', 'p', 'w'];

    function num(value, fallback, min, max) {
        const n = typeof value === 'number' ? value : parseFloat(value);
        if (!isFinite(n)) return fallback;
        if (min !== undefined && n < min) return min;
        if (max !== undefined && n > max) return max;
        return n;
    }

    function str(value, fallback) {
        return typeof value === 'string' ? value : (value == null ? fallback : String(value));
    }

    function bool(value, fallback) {
        if (value === undefined || value === null) return fallback;
        return value === true || value === 'true' || value === 1 || value === '1';
    }

    function arr(value, fallback) {
        return Array.isArray(value) ? value.slice() : (fallback || []).slice();
    }

    function normalizeKeyCombo(combo) {
        if (typeof combo !== 'string' || !combo) return combo;
        // Legacy content scripts emitted "Ctrl+Shift+Right"; the canonical form
        // (event.key) is "Ctrl+Shift+ArrowRight". Accept both when reading.
        const map = { Right: 'ArrowRight', Left: 'ArrowLeft', Up: 'ArrowUp', Down: 'ArrowDown', Esc: 'Escape' };
        return combo.split('+').map((part) => map[part] || part).join('+');
    }

    /**
     * Speed memory used to be a boolean (`speederRememberSpeed`); it is now a
     * three-way mode. Old values migrate transparently on read.
     */
    function normalizeSpeedMemory(source) {
        const raw = source.speederSpeedMemory;
        if (['off', 'global', 'site'].includes(raw)) return raw;
        if (source.speederRememberSpeed !== undefined) {
            return bool(source.speederRememberSpeed, true) ? 'global' : 'off';
        }
        return DEFAULTS.speederSpeedMemory;
    }

    function normalizeShortcuts(value) {
        const out = Object.assign({}, DEFAULT_SHORTCUTS);
        if (value && typeof value === 'object') {
            for (const key of Object.keys(DEFAULT_SHORTCUTS)) {
                if (typeof value[key] === 'string' && value[key]) out[key] = normalizeKeyCombo(value[key]);
            }
        }
        return out;
    }

    function normalizeMetrics(value) {
        const out = Object.assign({}, DEFAULTS.waqiMetrics);
        if (value && typeof value === 'object') {
            for (const key of WAQI_METRIC_KEYS) out[key] = bool(value[key], out[key]);
        }
        return out;
    }

    function normalizeEntities(value) {
        if (!Array.isArray(value)) return [];
        return value
            .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && item.id.trim())
            .map((item) => ({
                name: str(item.name, item.id).trim() || item.id,
                id: item.id.replace(/[\s\r\n]/g, ''),
                op: item.op === '<' ? '<' : '>',
                warn: item.warn == null ? '' : String(item.warn),
                crit: item.crit == null ? '' : String(item.crit)
            }));
    }

    function normalizeMappings(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        const out = {};
        for (const [site, mappings] of Object.entries(value)) {
            if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) continue;
            const clean = {};
            for (const [from, to] of Object.entries(mappings)) {
                if (typeof from === 'string' && typeof to === 'string' && from && to) clean[from] = to;
            }
            if (Object.keys(clean).length) out[site] = clean;
        }
        return out;
    }

    function normalizeCookies(value) {
        const out = { sessdata: '', dedeUserId: '' };
        if (value && typeof value === 'object') {
            out.sessdata = str(value.sessdata, '').trim();
            out.dedeUserId = str(value.dedeUserId, '').trim();
        }
        return out;
    }

    /** Coerce any raw storage snapshot into a fully typed, valid settings object. */
    function normalize(raw) {
        const source = raw && typeof raw === 'object' ? raw : {};
        const subtitlePrefs = source.bilibiliSubtitles && typeof source.bilibiliSubtitles === 'object'
            ? source.bilibiliSubtitles
            : {};

        // Two legacy keys describe the same switch. `biliAutoSubtitle` is the
        // canonical one and must win when present: `toStorage()` also writes the
        // nested copy, so if the nested copy took precedence a stale `true`
        // would resurrect the switch right after the user turned it off (that
        // made "关闭自动开启字幕" impossible to persist). The nested key is only
        // a fallback for data written by builds that knew nothing else.
        let autoSubtitle = DEFAULTS.biliAutoSubtitle;
        if (subtitlePrefs.autoEnableSubtitle !== undefined) autoSubtitle = bool(subtitlePrefs.autoEnableSubtitle, autoSubtitle);
        if (source.biliAutoSubtitle !== undefined) autoSubtitle = bool(source.biliAutoSubtitle, autoSubtitle);

        return {
            aioSchemaVersion: SCHEMA_VERSION,
            aioDebug: bool(source.aioDebug, DEFAULTS.aioDebug),

            aioTabsEnabled: bool(source.aioTabsEnabled, DEFAULTS.aioTabsEnabled),
            aioTabsDelay: num(source.aioTabsDelay, DEFAULTS.aioTabsDelay, 0, 5000),
            aioTabsWrap: bool(source.aioTabsWrap, DEFAULTS.aioTabsWrap),

            ezEnabled: bool(source.ezEnabled, DEFAULTS.ezEnabled),
            modifierKey: ['ctrlKey', 'altKey', 'shiftKey', 'metaKey'].includes(source.modifierKey)
                ? source.modifierKey : DEFAULTS.modifierKey,

            hotkeyEnabled: bool(source.hotkeyEnabled, DEFAULTS.hotkeyEnabled),
            hotkeyMappings: normalizeMappings(source.hotkeyMappings),
            enabledSites: normalizeMappings(source.enabledSites),

            globalEnabled: bool(source.globalEnabled, DEFAULTS.globalEnabled),
            hideFloatingBall: bool(source.hideFloatingBall, DEFAULTS.hideFloatingBall),
            excludeRules: arr(source.excludeRules, DEFAULTS.excludeRules).filter((r) => typeof r === 'string' && r.trim()),
            includeRules: arr(source.includeRules, DEFAULTS.includeRules).filter((r) => typeof r === 'string' && r.trim()),
            defaultSpeed: num(source.defaultSpeed, DEFAULTS.defaultSpeed, 0.25, 16),
            presetSpeed: normalizePreset(source.presetSpeed),
            shortcuts: normalizeShortcuts(source.shortcuts),
            speederSpeedMemory: normalizeSpeedMemory(source),
            speederMinRate: num(source.speederMinRate, DEFAULTS.speederMinRate, 0.1, 16),
            speederMaxRate: num(source.speederMaxRate, DEFAULTS.speederMaxRate, 0.25, 16),
            speederStep: num(source.speederStep, DEFAULTS.speederStep, 0.05, 4),

            biliEnabled: bool(source.biliEnabled, DEFAULTS.biliEnabled),
            biliAutoSubtitle: autoSubtitle,
            bilibiliSubtitles: {
                autoEnableSubtitle: autoSubtitle,
                subtitleHotkey: str(subtitlePrefs.subtitleHotkey, DEFAULTS.bilibiliSubtitles.subtitleHotkey) || 's'
            },
            bilibili1080PEnabled: bool(source.bilibili1080PEnabled, DEFAULTS.bilibili1080PEnabled),
            biliCommentsEnabled: bool(source.biliCommentsEnabled, DEFAULTS.biliCommentsEnabled),
            biliAISubtitleEnabled: bool(source.biliAISubtitleEnabled, DEFAULTS.biliAISubtitleEnabled),
            biliAutoPlay: bool(source.biliAutoPlay, DEFAULTS.biliAutoPlay),
            biliPlayNextDisabled: bool(source.biliPlayNextDisabled, DEFAULTS.biliPlayNextDisabled),
            biliCookies: normalizeCookies(source.biliCookies),

            hudEnabled: bool(source.hudEnabled, DEFAULTS.hudEnabled),
            hudIconRound: bool(source.hudIconRound, DEFAULTS.hudIconRound),
            hudCarouselInterval: num(source.hudCarouselInterval, DEFAULTS.hudCarouselInterval, 3, 60),
            waqiToken: str(source.waqiToken, '').trim(),
            waqiCity: str(source.waqiCity, '').trim(),
            waqiRefreshRate: num(source.waqiRefreshRate, DEFAULTS.waqiRefreshRate, 10, 240),
            waqiMetrics: normalizeMetrics(source.waqiMetrics),
            haUrl: str(source.haUrl, '').trim().replace(/\/+$/, ''),
            haToken: str(source.haToken, '').trim(),
            haRefreshRate: num(source.haRefreshRate, DEFAULTS.haRefreshRate, 0.25, 10),
            haEntities: normalizeEntities(source.haEntities)
        };
    }

    /** "1.0, 3.0" → "1.0, 3.0" (validated, deduped, clamped). */
    function normalizePreset(value) {
        const parts = String(value == null ? DEFAULTS.presetSpeed : value)
            .split(/[,，]/)
            .map((item) => parseFloat(item.trim()))
            .filter((item) => isFinite(item) && item > 0)
            .map((item) => Math.min(16, Math.max(0.25, item)));
        const unique = Array.from(new Set(parts));
        return (unique.length ? unique : [2]).join(', ');
    }

    /** Parse "1, 2.5" into [1, 2.5] for runtime use. */
    function presetList(settings) {
        return String(settings && settings.presetSpeed || DEFAULTS.presetSpeed)
            .split(/[,，]/)
            .map((item) => parseFloat(item.trim()))
            .filter((item) => isFinite(item) && item > 0);
    }

    /** Patch object for storage: only persisted keys, values already normalized. */
    function toStorage(settings) {
        const out = {};
        for (const key of PERSISTED_KEYS) {
            if (settings[key] !== undefined) out[key] = settings[key];
        }
        return out;
    }

    function core() {
        return AIO.core || null;
    }

    async function load() {
        const c = core();
        const raw = c ? await c.storage.getSync(null) : {};
        return normalize(raw);
    }

    /**
     * Persist a partial (or full) settings object. Returns the normalized result.
     *
     * Writes every persisted key in one `storage.set` call: one write operation
     * against the sync quota, and it guarantees `aioSchemaVersion` is recorded.
     */
    async function save(patch) {
        const c = core();
        const current = await load();
        const next = Object.assign({}, current, patch || {});

        // `bilibiliSubtitles` is a nested object, so the shallow merge above
        // would drop `subtitleHotkey` whenever a caller patches only one field.
        // A legacy writer that only knows the nested `autoEnableSubtitle` flag
        // would also be overridden by the canonical flat key, so lift it.
        const prefsPatch = patch && patch.bilibiliSubtitles;
        if (prefsPatch && typeof prefsPatch === 'object') {
            next.bilibiliSubtitles = Object.assign({}, current.bilibiliSubtitles, prefsPatch);
            if (prefsPatch.autoEnableSubtitle !== undefined && patch.biliAutoSubtitle === undefined) {
                next.biliAutoSubtitle = bool(prefsPatch.autoEnableSubtitle, current.biliAutoSubtitle);
            }
        }

        const settings = normalize(next);
        if (c) await c.storage.setSync(toStorage(settings));
        return settings;
    }

    /** Watch for settings changes, emitting a normalized snapshot. */
    function subscribe(listener) {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.onChanged) return () => {};
        const handler = async (changes, area) => {
            if (area !== 'sync') return;
            const touched = Object.keys(changes).filter((key) => key !== 'hs');
            if (!touched.length) return;
            listener(await load(), changes);
        };
        chrome.storage.onChanged.addListener(handler);
        return () => {
            try { chrome.storage.onChanged.removeListener(handler); } catch (e) { /* ignore */ }
        };
    }

    /**
     * One-shot upgrade of pre-schema data. Returns true when anything changed,
     * so callers can avoid rewriting storage on every service-worker wake-up.
     */
    async function migrate() {
        const c = core();
        if (!c) return false;
        const raw = await c.storage.getSync(null);
        const dirty = raw.aioSchemaVersion !== SCHEMA_VERSION ||
            raw.shortcutReference !== undefined ||
            raw.speederRememberSpeed !== undefined ||
            (raw.bilibiliSubtitles && raw.bilibiliSubtitles.autoEnableSubtitle !== raw.biliAutoSubtitle);
        if (raw.shortcutReference !== undefined) await c.storage.removeSync(['shortcutReference']);
        // The boolean is folded into speederSpeedMemory by normalize().
        if (raw.speederRememberSpeed !== undefined) await c.storage.removeSync(['speederRememberSpeed']);
        if (!dirty) return false;
        const settings = normalize(raw);
        await c.storage.setSync(toStorage(settings));
        return true;
    }

    AIO.schema = {
        SCHEMA_VERSION,
        DEFAULTS,
        PERSISTED_KEYS,
        WAQI_METRIC_KEYS,
        DEFAULT_SHORTCUTS,
        normalize,
        normalizeSpeedMemory,
        normalizePreset,
        normalizeKeyCombo,
        presetList,
        toStorage,
        load,
        save,
        subscribe,
        migrate
    };
})(typeof globalThis !== 'undefined' ? globalThis : self);
