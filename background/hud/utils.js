// === Formatter utilities ===

function formatDisplayText(value) {
    if (value === null || value === undefined) return '...';
    const num = parseFloat(value);
    if (isNaN(num)) return '?';
    if (num >= 10000) return Math.round(num / 1000) + '';
    if (num >= 1000) return (num / 1000).toFixed(1) + '';
    return Math.round(num) + '';
}
