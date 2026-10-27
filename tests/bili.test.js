import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/bili.js';

const { purifyUrl, isVideoPage } = globalThis.AIO.bili;

test('bilibili video urls keep only p and t', () => {
    const cleaned = purifyUrl('https://www.bilibili.com/video/BV1xx411c7mD?spm_id_from=333.999&vd_source=abc&p=2&t=30&share_source=copy');
    const url = new URL(cleaned);
    assert.equal(url.searchParams.get('p'), '2');
    assert.equal(url.searchParams.get('t'), '30');
    assert.equal(url.searchParams.get('spm_id_from'), null);
    assert.equal(url.searchParams.get('vd_source'), null);
    assert.equal(url.searchParams.get('share_source'), null);
});

test('generic urls lose tracking params only', () => {
    const cleaned = purifyUrl('https://example.com/page?id=42&utm_source=x&utm_medium=y&fbclid=z&keep=me');
    const url = new URL(cleaned);
    assert.equal(url.searchParams.get('id'), '42');
    assert.equal(url.searchParams.get('keep'), 'me');
    assert.equal(url.searchParams.get('utm_source'), null);
    assert.equal(url.searchParams.get('fbclid'), null);
});

test('unparseable input is returned untouched', () => {
    assert.equal(purifyUrl('not a url'), 'not a url');
    assert.equal(purifyUrl(''), '');
});

test('isVideoPage recognises video, bangumi and list pages', () => {
    assert.equal(isVideoPage('https://www.bilibili.com/video/BV1xx411c7mD'), true);
    assert.equal(isVideoPage('https://www.bilibili.com/bangumi/play/ep123'), true);
    assert.equal(isVideoPage('https://www.bilibili.com/list/watchlater'), true);
    assert.equal(isVideoPage('https://www.bilibili.com/'), false);
    assert.equal(isVideoPage('https://example.com/video/BV1'), false);
    assert.equal(isVideoPage('garbage'), false);
});
