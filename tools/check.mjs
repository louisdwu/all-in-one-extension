#!/usr/bin/env node
/**
 * Static integrity checks — the only "build" this project has.
 *
 *  1. every file referenced by manifest.json / HTML exists
 *  2. every JavaScript file parses (classic scripts and ES modules alike)
 *  3. no duplicate DOM ids, and every #id used by a page script exists in its HTML
 *  4. MAIN-world content scripts never touch the `chrome.*` API
 *  5. content-script files that need a shared lib load it first
 *  6. no committed API tokens / secrets
 *
 * Usage: node tools/check.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const note = (message) => notes.push(message);

const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const exists = (path) => {
  try { return statSync(join(ROOT, path)).isFile(); } catch (e) { return false; }
};

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.tmp') continue;
    const rel = dir ? dir + '/' + entry : entry;
    const stat = statSync(join(ROOT, rel));
    if (stat.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const allFiles = walk('');
const jsFiles = allFiles.filter((f) => extname(f) === '.js' || extname(f) === '.mjs');

/* ---------------- 1. manifest integrity ---------------- */
const manifest = JSON.parse(read('manifest.json'));
const referenced = new Set();
const addRef = (path) => { if (path && !path.startsWith('http')) referenced.add(path.replace(/^\//, '')); };

addRef(manifest.background && manifest.background.service_worker);
for (const script of manifest.content_scripts || []) {
  for (const file of script.js || []) addRef(file);
  for (const file of script.css || []) addRef(file);
  // libs/core.js is explicitly written to be safe in a MAIN world: every
  // `chrome` access is behind a `hasChrome()` guard (see the file header).
  const MAIN_WORLD_SAFE = new Set(['libs/core.js']);
  if (script.world === 'MAIN') {
    for (const file of script.js || []) {
      if (!exists(file) || MAIN_WORLD_SAFE.has(file)) continue;
      const source = read(file);
      const match = source.match(/chrome\s*\.\s*(runtime|storage|tabs|cookies|alarms|action)/);
      if (match) fail('MAIN-world script uses chrome.* API: ' + file + ' (' + match[0] + ')');
    }
  }
}
if (manifest.action && manifest.action.default_popup) addRef(manifest.action.default_popup);
if (manifest.options_page) addRef(manifest.options_page);
for (const size of Object.values(manifest.icons || {})) addRef(size);
for (const entry of manifest.web_accessible_resources || []) {
  for (const file of entry.resources || []) {
    if (file.includes('*')) continue;
    addRef(file);
  }
}
for (const file of referenced) {
  if (!exists(file)) fail('manifest references a missing file: ' + file);
}

const commands = manifest.commands || {};
for (const [name, command] of Object.entries(commands)) {
  if (!command.description) fail('command "' + name + '" has no description (Chrome shows it in chrome://extensions/shortcuts)');
}

/* ---------------- 2. syntax of every script ---------------- */
const tempDir = mkdtempSync(join(tmpdir(), 'aio-check-'));
for (const file of jsFiles) {
  if (file.includes('.tmp/')) continue;
  const source = read(file);
  const isModule = /^\s*(?:import|export)\s/m.test(source) || file.endsWith('.mjs');
  const target = join(tempDir, file.replace(/[\/]/g, '_') + (isModule ? '.mjs' : '.cjs'));
  writeFileSync(target, source);
  try {
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
  } catch (error) {
    fail('syntax error in ' + file + ':\n' + String(error.stderr || error.message).split('\n').slice(0, 6).join('\n'));
  } finally {
    try { unlinkSync(target); } catch (e) { /* ignore */ }
  }
}

/* ---------------- 2b. relative import resolution ---------------- */
for (const file of jsFiles) {
  if (file.includes('.tmp/')) continue;
  const source = read(file);
  const specifiers = [];
  for (const match of source.matchAll(/(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/g)) specifiers.push(match[1]);
  for (const match of source.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) specifiers.push(match[1]);
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]);
  for (const specifier of specifiers) {
    if (!specifier.startsWith('.')) continue;
    const target = resolve(dirname(join(ROOT, file)), specifier);
    const candidate = exists(specifier) && specifier.startsWith('/') ? specifier : target;
    let ok = false;
    try {
      ok = statSync(candidate).isFile();
    } catch (e) {
      ok = false;
    }
    if (!ok) fail(file + ' imports a missing module: ' + specifier);
  }
}

/* ---------------- 2c. locales + data-i18n keys ---------------- */
const localesDir = join(ROOT, '_locales');
const localeMessages = new Map();
if (manifest.default_locale) {
  if (!exists('_locales/' + manifest.default_locale + '/messages.json')) {
    fail('default_locale "' + manifest.default_locale + '" has no _locales/' + manifest.default_locale + '/messages.json');
  }
} else {
  note('manifest has no default_locale (i18n disabled)');
}
try {
  for (const entry of readdirSync(localesDir)) {
    const file = '_locales/' + entry + '/messages.json';
    if (!exists(file)) continue;
    try {
      localeMessages.set(entry, JSON.parse(read(file)));
    } catch (err) {
      fail('invalid JSON in ' + file + ': ' + err.message);
    }
  }
} catch (err) {
  /* no _locales directory at all */
}

// every __MSG_key__ referenced by the manifest must exist in the default locale
const defaultMessages = localeMessages.get(manifest.default_locale) || {};
const manifestText = read('manifest.json');
for (const match of manifestText.matchAll(/__MSG_([A-Za-z0-9_@]+)__/g)) {
  if (!defaultMessages[match[1]]) fail('manifest references __MSG_' + match[1] + '__ which is missing from the default locale');
}

// every data-i18n key must exist in every locale, so translations cannot drift
for (const htmlFile of allFiles.filter((f) => f.startsWith('ui/') && f.endsWith('.html'))) {
  const source = read(htmlFile);
  for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    for (const [localeName, messages] of localeMessages) {
      if (!messages[match[1]]) fail(htmlFile + ' uses data-i18n="' + match[1] + '" but ' + localeName + ' has no such message');
    }
  }
}

/* ---------------- 2d. stylesheet & script references ---------------- */
function resolveFrom(file, specifier) {
    return resolve(dirname(join(ROOT, file)), specifier);
}

function isFile(absolutePath) {
    try {
        return statSync(absolutePath).isFile();
    } catch (err) {
        return false;
    }
}

for (const htmlFile of allFiles.filter((file) => file.endsWith('.html'))) {
    const source = read(htmlFile);
    for (const match of source.matchAll(/<link[^>]+href="([^"]+)"/g)) {
        if (/^(https?:|data:|#)/.test(match[1])) continue;
        if (!isFile(resolveFrom(htmlFile, match[1]))) fail(htmlFile + ' links a missing stylesheet: ' + match[1]);
    }
    for (const match of source.matchAll(/<script[^>]+src="([^"]+)"/g)) {
        if (/^(https?:|data:)/.test(match[1])) continue;
        if (!isFile(resolveFrom(htmlFile, match[1]))) fail(htmlFile + ' loads a missing script: ' + match[1]);
    }
}

for (const cssFile of allFiles.filter((file) => file.endsWith('.css'))) {
    const source = read(cssFile);
    for (const match of source.matchAll(/@import\s+url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (!isFile(resolveFrom(cssFile, match[1]))) fail(cssFile + ' imports a missing stylesheet: ' + match[1]);
    }
}

/* ---------------- 3. DOM ids ---------------- */
function checkHtml(htmlPath, scriptPaths) {
  const html = read(htmlPath);
  const ids = Array.from(html.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) fail('duplicate id "' + id + '" in ' + htmlPath);
    seen.add(id);
  }
  for (const scriptPath of scriptPaths) {
    if (!exists(scriptPath)) continue;
    const source = read(scriptPath);
    const used = new Set();
    for (const match of source.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) used.add(match[1]);
    for (const match of source.matchAll(/querySelector\(\s*['"]#([A-Za-z0-9_-]+)['"]\s*\)/g)) used.add(match[1]);
    for (const id of used) {
      if (!seen.has(id)) fail(scriptPath + ' references #' + id + ' which does not exist in ' + htmlPath);
    }
  }
}

checkHtml('ui/options.html', ['ui/options.js', ...allFiles.filter((f) => f.startsWith('ui/modules/'))]);
checkHtml('ui/popup.html', ['ui/popup.js']);

/* ---------------- 4. content-script load order ---------------- */
for (const script of manifest.content_scripts || []) {
  const files = script.js || [];
  files.forEach((file, index) => {
    const source = read(file);
    const needs = [];
    if (/AIO\.keys\./.test(source)) needs.push('libs/keys.js');
    if (/AIO\.rules\./.test(source)) needs.push('libs/rules.js');
    if (/AIO\.schema\./.test(source)) needs.push('libs/schema.js');
    if (/AIO\.md5\(/.test(source)) needs.push('libs/md5.js');
    if (/AIO\.wbi\./.test(source)) { needs.push('libs/wbi.js'); needs.push('libs/md5.js'); }
    if (/AIO\.bili\./.test(source)) needs.push('libs/bili.js');
    if (/AIO\.core\./.test(source)) needs.push('libs/core.js');
    for (const dep of needs) {
      const depIndex = files.indexOf(dep);
      if (depIndex === -1) fail(file + ' needs ' + dep + ' in the same content script bundle');
      else if (depIndex > index) fail(file + ' is listed before its dependency ' + dep);
    }
  });
}

/* ---------------- 5. secrets ---------------- */
const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');
const SECRET_PATTERNS = [
  { re: /\b[0-9a-f]{32,40}\b/, why: 'possible hardcoded API token' },
  { re: /Bearer\s+[A-Za-z0-9_\-]{20,}/, why: 'possible hardcoded bearer token' },
  { re: /SESSDATA\s*[:=]\s*['"][^'"]{10,}/, why: 'possible hardcoded SESSDATA' }
];
for (const file of jsFiles) {
  if (file.startsWith('tools/') || file.startsWith('tests/') || file.includes('.tmp/')) continue;
  if (file.includes('protobuf')) continue;
  const source = stripComments(read(file));
  for (const pattern of SECRET_PATTERNS) {
    const match = source.match(pattern.re);
    if (match) fail('possible secret in ' + file + ': "' + match[0].slice(0, 12) + '…" (' + pattern.why + ')');
  }
}

/* ---------------- report ---------------- */
const stats = {
  jsFiles: jsFiles.length,
  manifestReferenced: referenced.size,
  contentScriptBundles: (manifest.content_scripts || []).length
};
console.log('Checked ' + stats.jsFiles + ' scripts, ' + stats.manifestReferenced + ' manifest resources, ' + stats.contentScriptBundles + ' content-script bundles.');
for (const message of notes) console.log('note: ' + message);
if (problems.length) {
  console.error('\n' + problems.length + ' problem(s):');
  for (const problem of problems) console.error('  ✖ ' + problem);
  process.exit(1);
}
console.log('All checks passed.');
