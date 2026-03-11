const ALARM_NAME = 'HA_POLLING_ALARM';
const CAROUSEL_ALARM = 'HA_CAROUSEL_ALARM';

// === 格式化显示文本 ===
function formatDisplayText(value) {
    if (value === null || value === undefined) return '...';
    const num = parseFloat(value);
    if (isNaN(num)) return '?';
    if (num >= 10000) return Math.round(num / 1000) + '';
    if (num >= 1000) return (num / 1000).toFixed(1) + '';
    return Math.round(num) + '';
}

// === OffscreenCanvas 渲染图标 ===
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

function updateIcon(name, text, bgColor) {
    chrome.action.setIcon({
        imageData: {
            16: renderIconAtSize(text, bgColor, 16),
            32: renderIconAtSize(text, bgColor, 32),
            48: renderIconAtSize(text, bgColor, 48),
            128: renderIconAtSize(text, bgColor, 128)
        }
    });
    chrome.action.setBadgeText({ text: '' });
    // 设置 tooltip 为完整的实体名和数值
    chrome.action.setTitle({ title: `HA Monitor: ${name} = ${text}` });
}

// === 多实体轮询 ===
async function fetchAllEntities() {
    const settings = await chrome.storage.sync.get({
        haUrl: '', haToken: '', entities: [], haEnabled: true
    });

    if (!settings.haEnabled) {
        chrome.action.setIcon({ path: { "16": "/icons/icon16.png", "48": "/icons/icon48.png", "128": "/icons/icon128.png" } });
        chrome.action.setTitle({ title: "HA Monitor (已禁用)" });
        return;
    }

    if (!settings.haUrl || !settings.haToken || settings.entities.length === 0) {
        updateIcon('ERR', 'ERR', '#F44336');
        return;
    }

    const cleanUrl = settings.haUrl.replace(/[\s\r\n]/g, '').replace(/\/+$/, '');
    const cleanToken = settings.haToken.replace(/[\s\r\n]/g, '').replace(/[^\x20-\x7E]/g, '');

    const results = {};

    for (const entity of settings.entities) {
        const cleanId = entity.id.replace(/[\s\r\n]/g, '');
        const apiUrl = `${cleanUrl}/api/states/${cleanId}`;

        try {
            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: {
                    'Authorization': 'Bearer ' + cleanToken,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                results[entity.id] = { name: entity.name, value: 'ERR', error: true };
                continue;
            }

            const data = await response.json();
            const displayText = formatDisplayText(data.state);
            results[entity.id] = { name: entity.name, value: displayText, error: false };
        } catch (error) {
            console.error(`Fetch failed for ${entity.name}:`, error.message);
            results[entity.id] = { name: entity.name, value: 'X', error: true };
        }
    }

    // 保存所有结果到 local storage
    await chrome.storage.local.set({ entityResults: results });

    // 立即显示当前轮播项
    showCurrentCarouselItem();
}

// === 轮播逻辑 ===
let carouselIndex = 0;

async function showCurrentCarouselItem() {
    const data = await chrome.storage.local.get(['entityResults']);
    const results = data.entityResults || {};
    const keys = Object.keys(results);

    if (keys.length === 0) {
        updateIcon('--', '--', '#9E9E9E');
        return;
    }

    carouselIndex = carouselIndex % keys.length;
    const current = results[keys[carouselIndex]];

    const bgColor = current.error ? '#9E9E9E' : '#03A9F4';
    updateIcon(current.name, current.value, bgColor);
}

function advanceCarousel() {
    carouselIndex++;
    showCurrentCarouselItem();
}

// === 定时器管理 ===
async function setupAlarms() {
    const settings = await chrome.storage.sync.get({
        refreshRate: 1,
        carouselInterval: 3,
        entities: [],
        haEnabled: true
    });

    chrome.alarms.clear(ALARM_NAME);
    chrome.alarms.clear(CAROUSEL_ALARM);

    if (!settings.haEnabled) {
        chrome.action.setIcon({ path: { "16": "/icons/icon16.png", "48": "/icons/icon48.png", "128": "/icons/icon128.png" } });
        chrome.action.setTitle({ title: "HA Monitor (已禁用)" });
        return;
    }

    // 数据刷新定时器
    chrome.alarms.create(ALARM_NAME, {
        periodInMinutes: parseFloat(settings.refreshRate)
    });

    // 轮播定时器（秒转分钟）
    if (settings.entities.length > 1) {
        const carouselMinutes = parseInt(settings.carouselInterval) / 60;
        chrome.alarms.create(CAROUSEL_ALARM, {
            periodInMinutes: Math.max(carouselMinutes, 1 / 60) // 最小 1 秒
        });
    }

    // 立即拉取一次
    fetchAllEntities();
}

// === 事件监听 ===
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        fetchAllEntities();
    } else if (alarm.name === CAROUSEL_ALARM) {
        advanceCarousel();
    }
});

chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'UPDATE_CONFIG') {
        carouselIndex = 0;
        setupAlarms();
    }
});

chrome.runtime.onInstalled.addListener(() => setupAlarms());
chrome.runtime.onStartup.addListener(() => setupAlarms());
