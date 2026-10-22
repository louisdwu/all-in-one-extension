/**
 * All-in-One Extension Config Bridge
 * Provides a unified API for storage and messaging
 */

export const ConfigBridge = {
    /**
     * Get settings from sync storage
     * @param {string | string[] | Object} keys
     * @returns {Promise<any>}
     */
    async get(keys) {
        return new Promise((resolve) => {
            chrome.storage.sync.get(keys, resolve);
        });
    },

    /**
     * Set settings to sync storage
     * @param {Object} items
     * @returns {Promise<void>}
     */
    async set(items) {
        return new Promise((resolve) => {
            chrome.storage.sync.set(items, resolve);
        });
    },

    /**
     * Send message to background or other parts.
     * Checks chrome.runtime.lastError to avoid "Unchecked runtime.lastError" warnings.
     * @param {Object} message
     * @returns {Promise<any>} Resolves to the response, or null if no response was received.
     */
    async sendMessage(message) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[ConfigBridge] sendMessage lastError:', chrome.runtime.lastError.message);
                    resolve(null);
                } else {
                    resolve(response);
                }
            });
        });
    },

    /**
     * Fire-and-forget message — no response expected.
     * Uses chrome.runtime.sendMessage without a callback so no port is held open.
     * Safe for notifications like UPDATE_CONFIG, UPDATE_HUD_CONFIG, reloadSettings.
     * @param {Object} message
     * @returns {Promise<void>}
     */
    async send(message) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(message);
            } catch (e) {
                console.warn('[ConfigBridge] send failed:', e.message);
            }
            resolve();
        });
    },

    /**
     * Get Speeder settings through messaging
     */
    async getSpeederSettings() {
        return this.sendMessage({ action: 'getSpeederSettings' });
    },

    /**
     * Save Speeder settings through messaging
     */
    async saveSpeederSettings(settings) {
        return this.sendMessage({ action: 'saveSpeederSettings', settings });
    },

    /**
     * Get Bilibili settings through messaging
     */
    async getBilibiliSettings() {
        return this.sendMessage({ action: 'getBilibiliSettings' });
    },

    /**
     * Save Bilibili settings through messaging
     */
    async saveBilibiliSettings(settings) {
        return this.sendMessage({ action: 'saveBilibiliSettings', settings });
    }
};
