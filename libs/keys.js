/**
 * Keyboard combo utilities — one canonical format used everywhere.
 *
 * The old code had four different serializers that disagreed:
 *   speeder content → "Ctrl+Shift+Right"   (Arrow stripped)
 *   options recorder → "Ctrl+Shift+ArrowRight"
 *   hotkey remapper → "CTRL+SHIFT+ARROWRIGHT"-ish
 * so a shortcut recorded in the UI never matched the runtime check.
 *
 * Canonical form: modifiers in the order Ctrl, Alt, Shift, Meta, then the key
 * exactly as `KeyboardEvent.key` spells it ("ArrowRight", "Space", "F5", "A").
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.keys) return;

    const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];
    /** `event.key` values that represent a modifier press on their own. */
    const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock'];
    /** Every token that may appear as a modifier *name* in a combo string. */
    const MODIFIER_TOKENS = ['Ctrl', 'Control', 'Alt', 'Shift', 'Meta', 'Cmd', 'Win', 'Command', 'AltGraph', 'CapsLock'];

    /** Normalize an `event.key` value into the canonical spelling. */
    function normalizeKey(key) {
        if (!key) return '';
        if (key === ' ' || key === 'Spacebar') return 'Space';
        if (key === 'Esc') return 'Escape';
        if (key === 'Del') return 'Delete';
        if (key === 'Left') return 'ArrowLeft';
        if (key === 'Right') return 'ArrowRight';
        if (key === 'Up') return 'ArrowUp';
        if (key === 'Down') return 'ArrowDown';
        if (key.length === 1) return key.toUpperCase();
        return key;
    }

    function modifiersOf(event) {
        const parts = [];
        if (event.ctrlKey) parts.push('Ctrl');
        if (event.altKey) parts.push('Alt');
        if (event.shiftKey) parts.push('Shift');
        if (event.metaKey) parts.push('Meta');
        return parts;
    }

    /** Serialize a KeyboardEvent to "Ctrl+Shift+ArrowRight". */
    function serialize(event) {
        if (!event) return '';
        const key = normalizeKey(event.key);
        if (!key || MODIFIER_KEYS.includes(event.key)) return modifiersOf(event).join('+');
        return modifiersOf(event).concat(key).join('+');
    }

    /** Parse "Ctrl+Shift+ArrowRight" into a predicate-friendly object. */
    function parse(combo) {
        const parts = String(combo || '').split('+').filter(Boolean);
        const key = parts.length ? parts[parts.length - 1] : '';
        return {
            ctrlKey: parts.includes('Ctrl'),
            altKey: parts.includes('Alt'),
            shiftKey: parts.includes('Shift'),
            metaKey: parts.includes('Meta'),
            key: normalizeKey(key)
        };
    }

    function sameShape(a, b) {
        return Boolean(a.ctrlKey) === Boolean(b.ctrlKey) &&
            Boolean(a.altKey) === Boolean(b.altKey) &&
            Boolean(a.shiftKey) === Boolean(b.shiftKey) &&
            Boolean(a.metaKey) === Boolean(b.metaKey);
    }

    /** Does this KeyboardEvent match the combo string? */
    function matches(event, combo) {
        if (!event || !combo) return false;
        const target = parse(combo);
        if (!sameShape(target, event)) return false;
        return normalizeKey(event.key) === target.key;
    }

    /** Find the first [action, combo] entry matching an event. */
    function matchAction(event, map) {
        for (const [action, combo] of Object.entries(map || {})) {
            if (matches(event, combo)) return action;
        }
        return null;
    }

    /** A usable global shortcut needs at least one modifier plus a real key. */
    function isValid(combo) {
        const parsed = parse(combo);
        if (!parsed.key) return false;
        if (MODIFIER_KEYS.includes(parsed.key) || MODIFIER_TOKENS.includes(parsed.key)) return false;
        return parsed.ctrlKey || parsed.altKey || parsed.shiftKey || parsed.metaKey;
    }

    /** Pretty-print for UI: "Ctrl + Shift + →". */
    function display(combo) {
        const arrow = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
        const parsed = parse(combo);
        if (!parsed.key) return String(combo || '');
        return parsed.ctrlKey || parsed.altKey || parsed.shiftKey || parsed.metaKey
            ? combo.replace(/Arrow(Left|Right|Up|Down)/g, (m) => arrow[m] || m).replace(/\+/g, ' + ')
            : combo;
    }

    AIO.keys = { MODIFIER_ORDER, MODIFIER_KEYS, MODIFIER_TOKENS, normalizeKey, serialize, parse, matches, matchAction, isValid, display };
})(typeof globalThis !== 'undefined' ? globalThis : self);
