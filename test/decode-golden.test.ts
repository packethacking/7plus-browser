import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeParts } from '../src/sevenplus/decode.js';
import { encodeFile } from '../src/sevenplus/encode.js';

function readSample(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../sample-data/${name}`, import.meta.url)));
}

describe('decoder against sample-data', () => {
  const source = readSample('fields.jpg');
  const partNames = Array.from({ length: 17 }, (_, i) => `fields.p${(i + 1).toString(16).padStart(2, '0')}`);
  const parts = partNames.map((n) => ({ name: n, data: readSample(n) }));

  it('decodes all 17 parts back to fields.jpg byte-for-byte', () => {
    const result = decodeParts(parts);
    expect(result.data.length).toBe(source.length);
    expect(result.stats.corrupted).toBe(0);
    expect(result.stats.missing).toBe(0);
    for (let i = 0; i < source.length; i++) {
      if (result.data[i] !== source[i]) {
        throw new Error(`differs at byte ${i}: got ${result.data[i]}, expected ${source[i]}`);
      }
    }
  });

  it('recovers the extended filename', () => {
    const result = decodeParts(parts);
    expect(result.filename).toBe('fields.jpg');
  });

  it('extracts a timestamp from the footer', () => {
    const result = decodeParts(parts);
    expect(result.timestamp).not.toBeNull();
  });

  it('accepts parts in shuffled order', () => {
    const shuffled = [...parts].reverse();
    const result = decodeParts(shuffled);
    expect(result.data.length).toBe(source.length);
    for (let i = 0; i < source.length; i++) {
      if (result.data[i] !== source[i]) {
        throw new Error(`differs at byte ${i}`);
      }
    }
  });

  it('round-trips random payloads through encode + decode', () => {
    // Force different sizes including edge cases: exact multiples of 62, size+1,
    // very small, spanning multiple parts.
    const sizes = [1, 31, 62, 63, 124, 8555, 8556, 8557, 159293, 159294, 159295];
    for (const n of sizes) {
      const src = new Uint8Array(n);
      for (let i = 0; i < n; i++) src[i] = (i * 1103515245 + 12345) & 0xff;
      const encoded = encodeFile(src, { filename: 'rand.bin', timestamp: 1700000000 });
      const decoded = decodeParts(encoded);
      expect(decoded.data.length).toBe(n);
      expect(decoded.stats.corrupted).toBe(0);
      expect(decoded.stats.missing).toBe(0);
      for (let i = 0; i < n; i++) {
        if (decoded.data[i] !== src[i]) throw new Error(`size ${n} differs at byte ${i}`);
      }
    }
  });
});
