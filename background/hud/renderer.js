// === OffscreenCanvas Renderer for HUD ===
// Used to draw text on the extension icon

function renderIconAtSize(text, bgColor, size) {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext('2d');

    const r = Math.round(size * 0.15);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(size - r, 0);
    ctx.quadraticCurveTo(size, 0, size, r);
    ctx.lineTo(size, size - r);
    ctx.quadraticCurveTo(size, size, size - r, size);
    ctx.lineTo(r, size);
    ctx.quadraticCurveTo(0, size, 0, size - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
    ctx.fillStyle = bgColor;
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    let fontSize;
    if (text.length <= 2) fontSize = size * 0.7;
    else if (text.length === 3) fontSize = size * 0.6;
    else if (text.length === 4) fontSize = size * 0.5;
    else fontSize = size * 0.4;

    ctx.font = `bold ${Math.round(fontSize)}px Arial, sans-serif`;
    ctx.fillText(text, size / 2, size / 2 + 1);

    return ctx.getImageData(0, 0, size, size);
}

function updateExtensionIcon(name, text, bgColor) {
    chrome.action.setIcon({
        imageData: {
            16: renderIconAtSize(text, bgColor, 16),
            32: renderIconAtSize(text, bgColor, 32),
            48: renderIconAtSize(text, bgColor, 48),
            128: renderIconAtSize(text, bgColor, 128)
        }
    });
    chrome.action.setBadgeText({ text: '' });
    chrome.action.setTitle({ title: `HUD: ${name} = ${text}` });
}
