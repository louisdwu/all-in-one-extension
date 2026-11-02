import test from 'node:test';
import assert from 'node:assert/strict';

import { nextOccurrence, trimHistory } from '../background/features/screenshot_scheduler.js';

test('nextOccurrence returns today when the time is still ahead', () => {
    const now = new Date('2026-11-02T08:00:00');
    const target = new Date(nextOccurrence('09:30', now));
    assert.equal(target.getHours(), 9);
    assert.equal(target.getMinutes(), 30);
    assert.equal(target.getDate(), 2);
});

test('nextOccurrence rolls to tomorrow when the time already passed', () => {
    const now = new Date('2026-11-02T10:00:00');
    const target = new Date(nextOccurrence('09:30', now));
    assert.equal(target.getDate(), 3);
    assert.equal(target.getHours(), 9);
});

test('nextOccurrence is strictly after now even for the same minute', () => {
    const now = new Date('2026-11-02T09:30:00');
    assert.ok(nextOccurrence('09:30', now) > now.getTime());
});

test('nextOccurrence normalizes single-digit and junk input', () => {
    const now = new Date('2026-11-02T08:00:00');
    const loose = new Date(nextOccurrence('9:5', now));
    assert.equal(loose.getHours(), 9);
    assert.equal(loose.getMinutes(), 5);
    const junk = new Date(nextOccurrence('not-a-time', now));
    assert.equal(junk.getHours(), 9);
    assert.equal(junk.getMinutes(), 0);
});

test('trimHistory keeps the newest entries and drops junk', () => {
    const entries = [
        { id: 1, timestamp: 100, image: 'data:image/jpeg;base64,aaa' },
        { id: 2, timestamp: 300, image: 'data:image/jpeg;base64,bbb' },
        { id: 3, timestamp: 200, image: 'data:image/jpeg;base64,ccc' },
        { id: 4, timestamp: 400 }, // no image — junk
        'garbage'
    ];
    const trimmed = trimHistory(entries, 2);
    assert.deepEqual(trimmed.map((item) => item.id), [2, 3]);
});

test('trimHistory tolerates non-array input', () => {
    assert.deepEqual(trimHistory(null), []);
    assert.deepEqual(trimHistory('nope'), []);
});
