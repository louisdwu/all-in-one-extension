#!/usr/bin/env node
/**
 * Bump manifest.json + package.json to `1.YYYY.MMDD.HHMM` (Asia/Shanghai).
 *
 * Chrome truncates leading zeros when displaying the version (1.2026.612.2031)
 * but the stored value keeps them, which is what the project rule requires.
 *
 * Usage: node tools/bump-version.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dry = process.argv.includes('--dry');

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false
}).formatToParts(new Date()).reduce((acc, part) => {
  acc[part.type] = part.value;
  return acc;
}, {});

const version = '1.' + parts.year + '.' + parts.month + parts.day + '.' + parts.hour + parts.minute;

const manifestPath = resolve(ROOT, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const previous = manifest.version;
manifest.version = version;
if (!dry) {
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
  const packagePath = resolve(ROOT, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.version = version;
  writeFileSync(packagePath, JSON.stringify(pkg, null, 4) + '\n');
}
console.log((dry ? '[dry] ' : '') + 'version ' + previous + ' → ' + version);
