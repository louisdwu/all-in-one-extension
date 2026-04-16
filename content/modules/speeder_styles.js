/**
 * All-in-One Extension: Smart Speeder Styles
 */

function injectSpeederStyles() {
    if (document.getElementById('video-speed-styles')) return;

    const style = document.createElement('style');
    style.id = 'video-speed-styles';
    style.textContent = `
        /* Floating Ball Styles */
        #video-speed-float-ball .speed-display {
            font-size: 14px;
            font-weight: bold;
            line-height: 1;
        }
        #video-speed-float-ball .speed-label {
            font-size: 9px;
            opacity: 0.9;
            margin-top: 2px;
        }
        
        /* Floating Menu Styles */
        #video-speed-floating-menu .menu-header {
            font-size: 16px;
            font-weight: bold;
            margin-bottom: 12px;
            color: #333;
            border-bottom: 2px solid #4CAF50;
            padding: 12px 15px;
            background: #f5f5f5;
            border-radius: 8px 8px 0 0;
        }
        #video-speed-floating-menu .menu-section {
            margin-bottom: 12px;
            padding: 0 15px;
        }
        #video-speed-floating-menu .menu-section-title {
            font-weight: bold;
            margin-bottom: 6px;
            color: #555;
        }
        #video-speed-floating-menu .menu-toggle-container {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        #video-speed-floating-menu .menu-toggle-switch {
            position: relative;
            width: 50px;
            height: 24px;
            background: #ccc;
            border-radius: 12px;
            cursor: pointer;
            transition: background 0.3s;
        }
        #video-speed-floating-menu .menu-toggle-switch.active {
            background: #4CAF50;
        }
        #video-speed-floating-menu .menu-toggle-slider {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 20px;
            height: 20px;
            background: white;
            border-radius: 50%;
            transition: transform 0.3s;
        }
        #video-speed-floating-menu .menu-toggle-switch.active .menu-toggle-slider {
            transform: translateX(26px);
        }
        #video-speed-floating-menu .menu-speed-display {
            text-align: center;
            font-size: 24px;
            font-weight: bold;
            color: #4CAF50;
            margin: 8px 0;
        }
        #video-speed-floating-menu .menu-button-group {
            display: flex;
            gap: 8px;
            margin-top: 8px;
        }
        #video-speed-floating-menu .menu-btn {
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 4px;
            background: #4CAF50;
            color: white;
            cursor: pointer;
            font-size: 13px;
            transition: background 0.2s;
        }
        #video-speed-floating-menu .menu-btn:hover { background: #45a049; }
        #video-speed-floating-menu .menu-btn:active { transform: scale(0.98); }
        
        #video-speed-floating-menu .menu-secondary-btn {
            background: #2196F3;
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 4px;
            color: white;
            cursor: pointer;
            font-size: 13px;
            transition: background 0.2s;
        }
        #video-speed-floating-menu .menu-export-btn {
            background: #FF9800;
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 4px;
            color: white;
            cursor: pointer;
            font-size: 13px;
        }
        #video-speed-floating-menu .menu-import-btn {
            background: #9C27B0;
            flex: 1;
            padding: 8px;
            border: none;
            border-radius: 4px;
            color: white;
            cursor: pointer;
            font-size: 13px;
        }
        #video-speed-floating-menu .menu-keyboard-hint {
            background: #f0f0f0;
            padding: 8px;
            border-radius: 4px;
            font-size: 11px;
            color: #555;
            margin-top: 8px;
            line-height: 1.4;
        }
        #video-speed-floating-menu .menu-info {
            font-size: 12px;
            color: #666;
            margin-top: 10px;
            text-align: center;
            padding: 8px 15px;
            border-top: 1px solid #eee;
        }
        #video-speed-floating-menu .menu-status {
            padding: 6px;
            border-radius: 4px;
            text-align: center;
            font-size: 12px;
            margin: 0 15px 10px;
        }
        #video-speed-floating-menu .menu-status.enabled {
            background: #d4edda;
            color: #155724;
            border: 1px solid #c3e6cb;
        }
        #video-speed-floating-menu .menu-status.disabled {
            background: #f8d7da;
            color: #721c24;
            border: 1px solid #f5c6cb;
        }
        #video-speed-floating-menu .menu-close-hint {
            font-size: 10px;
            color: #999;
            text-align: center;
            padding: 8px 15px;
            background: #fafafa;
            border-radius: 0 0 8px 8px;
        }
        
        /* Speed Indicator (Top Right) */
        #video-speed-indicator {
            position: fixed;
            top: 20px;
            right: 20px;
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            font-size: 16px;
            font-weight: bold;
            z-index: 10000;
            font-family: Arial, sans-serif;
            transition: opacity 0.3s;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

// 自动注入样式
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSpeederStyles);
} else {
    injectSpeederStyles();
}
