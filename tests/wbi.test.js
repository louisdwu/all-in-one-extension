import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/md5.js';
import '../libs/wbi.js';

const { getMixinKey, useWebKey, encWbi, cleanValue, MIXIN_KEY_ENC_TAB } = globalThis.AIO.wbi;

const IMG = 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png';
const SUB = 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';

test('mixin key table is a full permutation of 64 indices', () => {
    assert.equal(MIXIN_KEY_ENC_TAB.length, 64);
    assert.equal(new Set(MIXIN_KEY_ENC_TAB).size, 64);
    assert.deepEqual(MIXIN_KEY_ENC_TAB.slice().sort((a, b) => a - b), Array.from({ length: 64 }, (_, i) => i));
});

test('useWebKey extracts the file stem', () => {
    assert.equal(useWebKey(IMG), '7cd084941338484aae1ad9425b84077c');
    assert.equal(useWebKey(''), '');
    assert.equal(useWebKey('nodot'), 'nodot');
});

test('getMixinKey yields 32 chars', () => {
    const key = getMixinKey(useWebKey(IMG) + useWebKey(SUB));
    assert.equal(key.length, 32);
    assert.match(key, /^[0-9a-f]{32}$/);
});

test('cleanValue strips the four chars Bilibili filters', () => {
    assert.equal(cleanValue("a!b'c(d)e*f"), 'abcdef');
});

test('encWbi is deterministic, sorted and signed', () => {
    const query = encWbi({ qn: '80', try_look: '1', bvid: 'BV1xx411c7mD' }, useWebKey(IMG), useWebKey(SUB), 1700000000000);
    const params = new URLSearchParams(query);
    assert.equal(params.get('wts'), '1700000000');
    assert.match(params.get('w_rid'), /^[0-9a-f]{32}$/);
    assert.equal(query.indexOf('bvid=') < query.indexOf('qn='), true, 'params must be sorted');
    // signing twice is stable
    const again = encWbi({ qn: '80', try_look: '1', bvid: 'BV1xx411c7mD' }, useWebKey(IMG), useWebKey(SUB), 1700000000000);
    assert.equal(query, again);
    // and depends on the keys
    const other = encWbi({ qn: '80' }, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 1700000000000);
    assert.notEqual(new URLSearchParams(other).get('w_rid'), new URLSearchParams(encWbi({ qn: '80' }, useWebKey(IMG), useWebKey(SUB), 1700000000000)).get('w_rid'));
});
