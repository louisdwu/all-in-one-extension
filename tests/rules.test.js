import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/rules.js';

const { matches, testAny, clearCache } = globalThis.AIO.rules;

test('no rules means the feature applies everywhere', () => {
    assert.equal(matches('https://example.com/a', {}), true);
    assert.equal(matches('https://example.com/a', { includeRules: [], excludeRules: [] }), true);
});

test('include rules are a whitelist', () => {
    const rules = { includeRules: ['youtube\\.com'], excludeRules: ['youtube\\.com/live'] };
    assert.equal(matches('https://www.youtube.com/watch?v=1', rules), true);
    // include wins: exclude is ignored when include is non-empty
    assert.equal(matches('https://www.youtube.com/live/abc', rules), true);
    assert.equal(matches('https://example.com', rules), false);
});

test('exclude rules disable matching urls only', () => {
    const rules = { excludeRules: ['github\\.com'] };
    assert.equal(matches('https://github.com/x', rules), false);
    assert.equal(matches('https://youtube.com/x', rules), true);
});

test('invalid patterns are ignored instead of throwing', () => {
    clearCache();
    assert.equal(testAny('https://a.com', ['([unclosed']), false);
    assert.equal(matches('https://a.com', { excludeRules: ['([unclosed'] }), true);
});

test('regex cache survives repeated lookups', () => {
    clearCache();
    const first = globalThis.AIO.rules.compile('abc');
    const second = globalThis.AIO.rules.compile('abc');
    assert.equal(first, second);
});
