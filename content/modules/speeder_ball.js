/**
 * All-in-One Extension: Smart Speeder Floating Ball
 */

function createFloatingBall() {
    // 检查是否已经存在
    const existingBall = document.getElementById('video-speed-float-ball');
    if (existingBall) return existingBall;

    // 基础配置检查 (依赖于全局 settings)
    const settings = window.speederSettings || { hideFloatingBall: false };
    if (settings.hideFloatingBall) return null;

    const ball = document.createElement('div');
    ball.id = 'video-speed-float-ball';
    
    // 初始化显示内容 (依赖于全局 currentSpeed)
    const currentSpeed = window.speederCurrentSpeed || 1.0;
    ball.innerHTML = `
        <div class="speed-display">${currentSpeed.toFixed(2)}x</div>
        <div class="speed-label">速度</div>
    `;

    ball.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 60px;
        height: 60px;
        background: linear-gradient(135deg, #4CAF50, #45a049);
        border-radius: 50%;
        color: white;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 9999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        font-family: Arial, sans-serif;
        transition: transform 0.2s, box-shadow 0.2s;
        user-select: none;
    `;

    // 悬停效果
    ball.addEventListener('mouseenter', () => {
        ball.style.transform = 'scale(1.1)';
        ball.style.boxShadow = '0 6px 16px rgba(0,0,0,0.4)';
    });

    ball.addEventListener('mouseleave', () => {
        ball.style.transform = 'scale(1)';
        ball.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    });

    // 点击事件
    ball.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof showFloatingMenu === 'function') {
            showFloatingMenu();
        }
    });

    // 阻止拖拽干扰
    ball.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
    });

    document.body.appendChild(ball);
    return ball;
}

/**
 * 更新悬浮球显示
 */
function updateFloatingBall() {
    const ball = document.getElementById('video-speed-float-ball');
    if (!ball) return;
    
    const display = ball.querySelector('.speed-display');
    const currentSpeed = window.speederCurrentSpeed || 1.0;
    if (display) {
        display.textContent = `${currentSpeed.toFixed(2)}x`;
    }
}

// 暴露给全局 (通过 window 挂载，因为 Content Script 重构为按序注入)
window.createFloatingBall = createFloatingBall;
window.updateFloatingBall = updateFloatingBall;
