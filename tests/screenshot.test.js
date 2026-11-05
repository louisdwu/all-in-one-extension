import test from 'node:test';
import assert from 'node:assert/strict';

import { nextOccurrence, trimHistory, hasHostPermission, planBaseAlarmRun } from '../background/features/screenshot_scheduler.js';

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

test('planBaseAlarmRun keeps the jitter while fired on time', () => {
    const scheduled = Date.parse('2026-11-05T09:00:00');
    const plan = planBaseAlarmRun(scheduled + 2000, scheduled, 5);
    assert.deepEqual(plan, { mode: 'jitter', maxDelayMs: 5 * 60000 });
});

test('planBaseAlarmRun keeps the jitter while still inside the offset window', () => {
    const scheduled = Date.parse('2026-11-05T09:00:00');
    // Fired 3 minutes late with a 5-minute window: the missed time has not
    // fully passed yet, so the random offset still applies.
    const plan = planBaseAlarmRun(scheduled + 3 * 60000, scheduled, 5);
    assert.deepEqual(plan, { mode: 'jitter', maxDelayMs: 5 * 60000 });
});

test('planBaseAlarmRun signs in immediately after the offset window passed', () => {
    const scheduled = Date.parse('2026-11-05T09:00:00');
    // Sleep/wake replay: Chrome fires the missed alarm 30 minutes after its
    // original scheduledTime — catch up right away, no new jitter.
    const plan = planBaseAlarmRun(scheduled + 30 * 60000, scheduled, 5);
    assert.deepEqual(plan, { mode: 'immediate' });
});

test('planBaseAlarmRun always signs in immediately without jitter', () => {
    const scheduled = Date.parse('2026-11-05T09:00:00');
    assert.deepEqual(planBaseAlarmRun(scheduled + 1000, scheduled, 0), { mode: 'immediate' });
    assert.deepEqual(planBaseAlarmRun(scheduled + 1000, scheduled, undefined), { mode: 'immediate' });
    assert.deepEqual(planBaseAlarmRun(scheduled + 1000, scheduled, -3), { mode: 'immediate' });
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

test('hasHostPermission requires <all_urls> or *://*/*', async () => {
    globalThis.chrome = {
        permissions: {
            contains: async ({ origins }) => origins.includes('<all_urls>') || origins.includes('*://*/*')
        }
    };
    try {
        const ok = await hasHostPermission('https://example.com/checkin');
        assert.equal(ok, true);
    } finally {
        delete globalThis.chrome;
    }
});

test('hasHostPermission rejects when neither <all_urls> nor *://*/* is granted', async () => {
    globalThis.chrome = {
        permissions: {
            contains: async () => false
        }
    };
    try {
        const ok = await hasHostPermission('https://example.com/checkin');
        assert.equal(ok, false);
    } finally {
        delete globalThis.chrome;
    }
});
