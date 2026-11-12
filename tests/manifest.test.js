import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('manifest declares a valid MV3 background service worker', () => {
    assert.equal(manifest.manifest_version, 3);
    const worker = manifest.background.service_worker;
    assert.ok(existsSync(join(ROOT, worker)), worker + ' must exist');
});

test('version follows 1.YYYY.MMDD.HHMM (Asia/Shanghai)', () => {
    assert.match(manifest.version, /^1\.\d{4}\.\d{4}\.\d{4}$/);
    // The regex above is only shape: also enforce plausible calendar values so
    // a bump that produced e.g. "2405" (h24 ICU) or month 99 cannot slip in.
    const parts = manifest.version.split('.');
    const mmdd = parts[2];
    const hhmm = parts[3];
    const month = Number(mmdd.slice(0, 2));
    const day = Number(mmdd.slice(2, 4));
    const hour = Number(hhmm.slice(0, 2));
    const minute = Number(hhmm.slice(2, 4));
    assert.ok(month >= 1 && month <= 12, 'month out of range: ' + month);
    assert.ok(day >= 1 && day <= 31, 'day out of range: ' + day);
    assert.ok(hour >= 0 && hour <= 23, 'hour out of range: ' + hour);
    assert.ok(minute >= 0 && minute <= 59, 'minute out of range: ' + minute);
});

test('every referenced resource exists', () => {
    const refs = [];
    refs.push(manifest.background.service_worker);
    for (const script of manifest.content_scripts) {
        refs.push(...script.js);
        if (script.css) refs.push(...script.css);
    }
    refs.push(manifest.action.default_popup, manifest.options_page, ...Object.values(manifest.icons));
    if (manifest.action.default_icon) refs.push(...Object.values(manifest.action.default_icon));
    for (const ref of refs) {
        assert.ok(existsSync(join(ROOT, ref)), 'missing referenced file: ' + ref);
    }
});

test('content script bundles load shared libs before consumers', () => {
    for (const script of manifest.content_scripts) {
        const files = script.js;
        files.forEach((file, index) => {
            const source = read(file);
            const deps = [];
            if (/AIO\.core\./.test(source)) deps.push('libs/core.js');
            if (/AIO\.keys\./.test(source)) deps.push('libs/keys.js');
            if (/AIO\.rules\./.test(source)) deps.push('libs/rules.js');
            if (/AIO\.schema\./.test(source)) deps.push('libs/schema.js');
            if (/AIO\.speedMemory\./.test(source)) deps.push('libs/speed_memory.js');
            if (/AIO\.aqi\./.test(source)) deps.push('libs/aqi.js');
            if (/AIO\.wbi\./.test(source)) deps.push('libs/wbi.js', 'libs/md5.js');
            if (/AIO\.md5\(/.test(source)) deps.push('libs/md5.js');
            for (const dep of deps) {
                const at = files.indexOf(dep);
                assert.notEqual(at, -1, file + ' must bundle ' + dep);
                assert.ok(at < index, dep + ' must load before ' + file);
            }
        });
    }
});

test('MAIN world scripts never touch the chrome API', () => {
    // No MAIN bundle ships libs/core.js any more: every chrome.* access is
    // guarded by hasChrome() in that file, but it is not injected into MAIN.
    const MAIN_APIS = 'runtime|storage|tabs|cookies|alarms|action|windows|permissions|scripting|idle|webNavigation|commands|notifications|extension';
    for (const script of manifest.content_scripts) {
        if (script.world !== 'MAIN') continue;
        for (const file of script.js) {
            assert.equal(
                new RegExp('chrome\\s*\\.\\s*(?:' + MAIN_APIS + ')').test(read(file)), false, file);
        }
    }
});

test('page scripts only reference ids that exist in their HTML', () => {
    const pairs = [
        ['ui/options.html', ['ui/options.js']],
        ['ui/popup.html', ['ui/popup.js']]
    ];
    for (const [htmlPath, scripts] of pairs) {
        const html = read(htmlPath);
        const ids = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]));
        for (const scriptPath of scripts) {
            const source = read(scriptPath);
            for (const match of source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
                assert.ok(ids.has(match[1]), scriptPath + ' references missing #' + match[1]);
            }
        }
    }
});

test('every relative import resolves to a real file', () => {
    const walk = (dir) => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            if (['node_modules', '.git', '.tmp'].includes(entry)) continue;
            const rel = dir ? dir + '/' + entry : entry;
            const stat = statSync(join(ROOT, rel));
            if (stat.isDirectory()) walk(rel);
            else if (['.js', '.mjs'].includes(extname(entry))) {
                const source = read(rel);
                const specs = [];
                for (const m of source.matchAll(/(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
                for (const m of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specs.push(m[1]);
                for (const spec of specs) {
                    if (!spec.startsWith('.')) continue;
                    // Resolve relative to the importing file's own directory.
                    const target = join(ROOT, dir, spec);
                    assert.ok(existsSync(target), rel + ' imports missing ' + spec);
                }
            }
        }
    };
    walk('background');
    walk('libs');
    walk('content');
    walk('ui');
    walk('tools');
    walk('tests');
});

test('options and popup pages have no duplicate element ids', () => {
    for (const html of ['ui/options.html', 'ui/popup.html']) {
        const ids = Array.from(read(html).matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]);
        assert.equal(new Set(ids).size, ids.length, html + ' has duplicate ids');
    }
});

test('host permissions cover bilibili, waqi, and <all_urls>', () => {
    const hosts = manifest.host_permissions || [];
    assert.ok(hosts.some((pattern) => pattern.includes('bilibili.com')), 'cookies + webNavigation need bilibili origins');
    assert.ok(hosts.some((pattern) => pattern.includes('api.waqi.info')), 'the WAQI feed is fetched from the worker');
    assert.ok(hosts.includes('<all_urls>'), 'captureVisibleTab requires <all_urls> in host_permissions');
});

test('no unused permission is declared', () => {
    const used = new Set();
    const walk = (dir) => {
        for (const entry of readdirSync(join(ROOT, dir))) {
            if (['node_modules', '.git', '.tmp'].includes(entry)) continue;
            const rel = join(dir, entry);
            const stat = statSync(join(ROOT, rel));
            if (stat.isDirectory()) walk(rel);
            else if (['.js', '.mjs'].includes(extname(entry))) {
                // Strip line comments only. A naive /* ... */ strip breaks on
                // strings like '*://*.bilibili.com/*' (URL match patterns).
                const source = read(rel)
                    .split('\n')
                    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
                    .join('\n');
                for (const match of source.matchAll(/chrome\.([a-zA-Z]+)\./g)) used.add(match[1]);
            }
        }
    };
    walk('background');
    walk('content');
    walk('ui');
    walk('libs');
    const apiToPermission = {
        tabs: 'tabs', storage: 'storage', alarms: 'alarms', idle: 'idle',
        cookies: 'cookies', webNavigation: 'webNavigation', action: null,
        runtime: null, commands: null, windows: null, scripting: 'scripting',
        notifications: 'notifications', activeTab: 'activeTab'
    };
    for (const permission of manifest.permissions) {
        const api = Object.entries(apiToPermission).find(([, value]) => value === permission);
        if (!api) continue;
        assert.ok(used.has(api[0]), 'permission "' + permission + '" is declared but never used');
    }
});
