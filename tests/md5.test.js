import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../libs/core.js';
import '../libs/md5.js';

const md5 = globalThis.AIO.md5;
const oracle = (value) => createHash('md5').update(value, 'utf8').digest('hex');

test('known RFC 1321 vectors', () => {
    assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
    assert.equal(md5('a'), '0cc175b9c0f1b6a831c399e269772661');
    assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
    assert.equal(md5('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0');
});

test('matches Node crypto for utf-8, boundaries and long inputs', () => {
    const samples = ['中文测试', 'Bilibili WBI 签名', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), '😀 emoji'];
    for (const sample of samples) {
        assert.equal(md5(sample), oracle(sample), 'mismatch for length ' + sample.length);
    }
});

test('accepts byte arrays', () => {
    assert.equal(md5(new TextEncoder().encode('abc')), oracle('abc'));
});
