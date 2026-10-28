/**
 * Bilibili panel.
 */
import './shared.js';
import { schema, core, toast } from './shared.js';

export async function initBilibili() {
    const settings = await schema.load();

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (el.type === 'checkbox') el.checked = !!value;
        else el.value = value;
    };

    set('bili-enabled', settings.biliEnabled);
    set('bili-autoplay-enable', settings.biliAutoPlay);
    set('bili-autoSubtitle', settings.biliAutoSubtitle);
    set('bili-subtitleHotkey', settings.bilibiliSubtitles.subtitleHotkey);
    set('bili-1080p-enable', settings.bilibili1080PEnabled);
    set('bili-comments-enable', settings.biliCommentsEnabled);
    set('bili-ai-subtitle-enable', settings.biliAISubtitleEnabled);
    set('bili-playnext-disable', settings.biliPlayNextDisabled);
    set('bili-sessdata', settings.biliCookies.sessdata);
    set('bili-dede-userid', settings.biliCookies.dedeUserId);
    set('bili-incognito-login', settings.biliIncognitoLogin);

    const bind = (id, key, transform = (value) => value) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', async () => {
            await schema.save({ [key]: transform(el.type === 'checkbox' ? el.checked : el.value) });
        });
    };

    bind('bili-enabled', 'biliEnabled');
    bind('bili-autoplay-enable', 'biliAutoPlay');
    bind('bili-1080p-enable', 'bilibili1080PEnabled');
    bind('bili-comments-enable', 'biliCommentsEnabled');
    bind('bili-ai-subtitle-enable', 'biliAISubtitleEnabled');
    bind('bili-playnext-disable', 'biliPlayNextDisabled');
    bind('bili-incognito-login', 'biliIncognitoLogin');

    // Subtitle switch has one canonical key; the schema keeps the legacy nested
    // object in sync for older builds.
    document.getElementById('bili-autoSubtitle')?.addEventListener('change', async (event) => {
        await schema.save({ biliAutoSubtitle: event.target.checked });
        toast(event.target.checked ? '已开启自动字幕' : '已关闭自动字幕，当前页面会自动收起字幕');
    });

    // Single-key subtitle hotkey recorder.
    const hotkeyInput = document.getElementById('bili-subtitleHotkey');
    hotkeyInput?.addEventListener('keydown', async (event) => {
        if (event.key === 'Escape') return;
        if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;
        event.preventDefault();
        const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
        hotkeyInput.value = key;
        const current = await schema.load();
        await schema.save({ bilibiliSubtitles: Object.assign({}, current.bilibiliSubtitles, { subtitleHotkey: key }) });
        toast('字幕快捷键已更新为 ' + key);
    });

    // Why the incognito window needs this account at all: bilibili only serves
    // 1080P renditions to logged-in clients, so the old "fake the nav response"
    // trick cannot produce a real 1080P stream any more.
    const refreshStatus = async () => {
        const el = document.getElementById('bili-cookie-status');
        if (!el) return;
        const status = await core.sendMessage({ type: 'bili:incognitoStatus' }, 4000);
        if (!status) {
            el.textContent = '无法读取状态：后台未响应。';
            return;
        }
        if (!status.allowed) {
            el.textContent = '⚠️ 扩展没有「在无痕模式下启用」：无痕窗口里所有增强（含 1080P）都不会运行。请到 chrome://extensions 的扩展详情页开启。';
            return;
        }
        if (!status.hasCredential) {
            el.textContent = '尚未保存 SESSDATA：无痕窗口按未登录处理，最高 480P。';
            return;
        }
        el.textContent = status.loginEnabled
            ? '✅ 已保存登录态：无痕窗口打开 B站视频时会自动写入该会话（窗口关闭即清除）。'
            : '已关闭「无痕沿用此账号」：新打开的无痕窗口按未登录处理（最高 480P），已打开的窗口需关闭重开。';
    };
    refreshStatus();

    const saveCookies = core.debounce(async () => {
        await schema.save({
            biliCookies: {
                sessdata: (document.getElementById('bili-sessdata')?.value || '').trim(),
                dedeUserId: (document.getElementById('bili-dede-userid')?.value || '').trim()
            }
        });
        refreshStatus();
    }, 500);
    document.getElementById('bili-sessdata')?.addEventListener('input', saveCookies);
    document.getElementById('bili-dede-userid')?.addEventListener('input', saveCookies);

    document.getElementById('bili-fetch-cookies')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        const result = await core.sendMessage({ type: 'bili:captureCookies' });
        button.disabled = false;
        if (!result || !result.ok) {
            toast('未读取到 B站 Cookie：请先在浏览器中登录 bilibili.com（无痕窗口需已允许扩展运行）', 'error');
            return;
        }
        document.getElementById('bili-sessdata').value = result.sessdata || '';
        document.getElementById('bili-dede-userid').value = result.dedeUserId || '';
        await saveCookies();
        toast('已读取并保存 Cookie' + (result.incognito ? '（来自无痕窗口）' : '（来自常规窗口）'));
    });

    document.getElementById('bili-seed-incognito')?.addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        const result = await core.sendMessage({ type: 'bili:seedIncognitoLogin' }, 5000);
        button.disabled = false;
        if (!result || !result.ok) {
            toast('没有可写入的无痕窗口：先打开一个无痕窗口，并确认已保存 SESSDATA', 'error');
            return;
        }
        toast('已把登录态写入 ' + result.seeded + ' 个无痕会话，刷新页面即生效');
        refreshStatus();
    });
}
