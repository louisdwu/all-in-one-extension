/**
 * All-in-One Extension Utilities
 */

/**
 * Escapes HTML special characters to prevent XSS
 * @param {string} str 
 * @returns {string}
 */
export function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

/**
 * Shows a toast notification message
 * @param {string} message 
 * @param {'success' | 'error'} type 
 */
export function showStatus(message, type = 'success') {
    const el = document.getElementById('statusMessage');
    if (!el) {
        console.log(`[${type.toUpperCase()}] ${message}`);
        return;
    }
    el.textContent = message;
    el.className = `status-msg show ${type}`;
    setTimeout(() => el.classList.remove('show'), 3000);
}

/**
 * Debounce a function
 * @param {Function} func 
 * @param {number} wait 
 */
export function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
