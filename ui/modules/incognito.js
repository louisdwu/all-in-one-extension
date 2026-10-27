/**
 * Incognito link opener panel.
 */
import './shared.js';
import { schema, bindToggle, bindSelect, renderIncognitoState } from './shared.js';

export async function initIncognito() {
    const settings = await schema.load();
    const enable = document.getElementById('ez-enable');
    const modifier = document.getElementById('ez-modifier-key');
    if (enable) enable.checked = settings.ezEnabled !== false;
    if (modifier) modifier.value = settings.modifierKey;

    bindToggle('ez-enable', 'ezEnabled');
    bindSelect('ez-modifier-key', 'modifierKey', { numeric: false });
    renderIncognitoState();
}
