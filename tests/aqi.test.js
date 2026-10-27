import test from 'node:test';
import assert from 'node:assert/strict';
import '../libs/core.js';
import '../libs/aqi.js';

const { toConcentration } = globalThis.AIO.aqi;

test('concentration breakpoints map exactly', () => {
    assert.equal(toConcentration(0, 'o3'), 0);
    assert.equal(toConcentration(50, 'o3'), 160);
    assert.equal(toConcentration(100, 'o3'), 200);
    assert.equal(toConcentration(50, 'pm25'), 35);
    assert.equal(toConcentration(100, 'pm25'), 75);
    assert.equal(toConcentration(50, 'pm10'), 50);
});

test('linear interpolation inside a band', () => {
    // IAQI 75 sits halfway through the 50..100 band → 75% of the way to 75 μg/m³
    assert.equal(toConcentration(75, 'pm25'), 55);
});

test('CO is converted from mg/m³ to μg/m³', () => {
    assert.equal(toConcentration(50, 'co'), 5000);
    assert.equal(toConcentration(100, 'co'), 10000);
});

test('values above 500 are clamped to the last band', () => {
    assert.equal(toConcentration(900, 'pm25'), 500);
});

test('invalid input yields null, unknown pollutants pass through', () => {
    assert.equal(toConcentration(null, 'o3'), null);
    assert.equal(toConcentration(NaN, 'o3'), null);
    assert.equal(toConcentration(-5, 'o3'), null);
    assert.equal(toConcentration(42, 'unknown'), 42);
});
