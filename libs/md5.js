/**
 * MD5 (RFC 1321) — required by Bilibili's WBI request signing.
 *
 * WebCrypto has no MD5, and the original implementation was a 170-line block
 * inlined in the middle of a 676-line page injector. Extracted here so it can be
 * unit-tested against Node's crypto module.
 *
 * Input is UTF-8 encoded; output is a lowercase 32-char hex digest.
 */
(function (root) {
    'use strict';

    const AIO = (root.AIO = root.AIO || {});
    if (AIO.md5) return;

    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
    ];

    const K = new Uint32Array(64);
    for (let i = 0; i < 64; i++) {
        K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
    }

    function toBytes(input) {
        if (typeof input === 'string') {
            if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(input);
            // Extremely old runtimes: latin1-ish fallback
            const out = new Uint8Array(input.length);
            for (let i = 0; i < input.length; i++) out[i] = input.charCodeAt(i) & 0xff;
            return out;
        }
        if (input instanceof Uint8Array) return input;
        if (input && input.buffer) return new Uint8Array(input.buffer, input.byteOffset || 0, input.byteLength);
        return new Uint8Array(0);
    }

    function rotl(value, shift) {
        return ((value << shift) | (value >>> (32 - shift))) >>> 0;
    }

    function md5(input) {
        const message = toBytes(input);
        const bitLength = message.length * 8;
        // message + 0x80 + zero padding + 8-byte length, padded to 64-byte blocks
        const blockCount = (((message.length + 8) >>> 6) + 1);
        const blocks = new Uint8Array(blockCount * 64);
        blocks.set(message);
        blocks[message.length] = 0x80;

        // 64-bit little-endian length (high 4 bytes stay 0 for inputs < 512MB)
        const lengthOffset = blocks.length - 8;
        blocks[lengthOffset] = bitLength & 0xff;
        blocks[lengthOffset + 1] = (bitLength >>> 8) & 0xff;
        blocks[lengthOffset + 2] = (bitLength >>> 16) & 0xff;
        blocks[lengthOffset + 3] = (bitLength >>> 24) & 0xff;

        let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
        const M = new Uint32Array(16);

        for (let offset = 0; offset < blocks.length; offset += 64) {
            for (let i = 0; i < 16; i++) {
                const j = offset + i * 4;
                M[i] = (blocks[j] | (blocks[j + 1] << 8) | (blocks[j + 2] << 16) | (blocks[j + 3] << 24)) >>> 0;
            }

            let A = a0, B = b0, C = c0, D = d0;

            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) { F = (B & C) | (~B & D); g = i; }
                else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
                else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
                else { F = C ^ (B | ~D); g = (7 * i) % 16; }

                F = (F + A + K[i] + M[g]) >>> 0;
                A = D;
                D = C;
                C = B;
                B = (B + rotl(F, S[i])) >>> 0;
            }

            a0 = (a0 + A) >>> 0;
            b0 = (b0 + B) >>> 0;
            c0 = (c0 + C) >>> 0;
            d0 = (d0 + D) >>> 0;
        }

        return [a0, b0, c0, d0].map(function (word) {
            let hex = '';
            for (let i = 0; i < 4; i++) {
                const byte = (word >>> (i * 8)) & 0xff;
                hex += (byte < 16 ? '0' : '') + byte.toString(16);
            }
            return hex;
        }).join('');
    }

    AIO.md5 = md5;
})(typeof globalThis !== 'undefined' ? globalThis : self);
