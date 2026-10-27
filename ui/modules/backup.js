/**
 * Backup / restore / factory reset.
 *
 * Uses the schema so the exported file is versioned and normalized, and an
 * import cannot inject unknown or ill-typed keys.
 */
import './shared.js';
import { schema, core, toast } from './shared.js';

export async function initBackup() {
    document.getElementById('backup-export-btn')?.addEventListener('click', async () => {
        const settings = await schema.load();
        const payload = {
            format: 'aio-settings',
            schemaVersion: schema.SCHEMA_VERSION,
            exportedAt: new Date().toISOString(),
            extensionVersion: chrome.runtime.getManifest().version,
            data: settings
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = 'aio-backup-' + new Date().toISOString().slice(0, 10) + '.json';
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('配置已导出');
    });

    const fileInput = document.getElementById('backup-import-file');
    document.getElementById('backup-import-btn')?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const parsed = JSON.parse(text);
            const data = parsed && parsed.data ? parsed.data : parsed;
            if (!data || typeof data !== 'object') throw new Error('文件中没有可用的配置数据');
            if (!confirm('导入将覆盖当前全部设置，确定继续？')) return;
            await schema.save(schema.normalize(data));
            toast('配置已导入，正在刷新…');
            setTimeout(() => location.reload(), 600);
        } catch (err) {
            toast('导入失败：' + err.message, 'error');
        } finally {
            fileInput.value = '';
        }
    });

    document.getElementById('backup-reset-btn')?.addEventListener('click', async () => {
        if (!confirm('确定恢复出厂设置？所有配置（含 B站 Cookie 与 HUD 实体）都会被清空。')) return;
        await core.storage.removeSync(null);
        await core.storage.removeLocal(null);
        toast('已恢复出厂设置，正在刷新…');
        setTimeout(() => location.reload(), 600);
    });
}
