// === Formatter utilities ===

function formatDisplayText(value) {
    if (value === null || value === undefined) return '...';
    // Just return as string, let the consumer decide how to round/format
    // This ensures background service gets the raw number string
    return value.toString();
}
