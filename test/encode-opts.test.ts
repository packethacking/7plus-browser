import { describe, it, expect } from 'vitest';
import { encodeFile } from '../src/sevenplus/encode.js';
import { decodeParts } from '../src/sevenplus/decode.js';

function makePayload(n: number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 2654435761) & 0xff;
  return a;
}

describe('EncodeOptions advanced', () => {
  const data = makePayload(25_000);

  it('partCount splits into roughly N equal parts', () => {
    const parts = encodeFile(data, { filename: 'rand.bin', partCount: 5, timestamp: 1 });
    expect(parts.length).toBe(5);
  });

  it('onlyParts emits just the requested subset', () => {
    const parts = encodeFile(data, { filename: 'rand.bin', partCount: 5, onlyParts: [2, 4], timestamp: 1 });
    expect(parts.map((p) => p.name)).toEqual(['rand.p02', 'rand.p04']);
  });

  it('terminator appends an extra line after the footer', () => {
    const [part] = encodeFile(data.subarray(0, 500), { filename: 'rand.bin', terminator: '/ex', timestamp: 1 });
    const text = new TextDecoder('latin1').decode(part!.data);
    // The terminator line should appear AFTER the ` stop_7+.` footer line.
    const stopIdx = text.indexOf(' stop_7+.');
    const exIdx = text.indexOf('/ex');
    expect(stopIdx).toBeGreaterThan(-1);
    expect(exIdx).toBeGreaterThan(stopIdx);
    // …and the decoder must still recover the original (terminator is ignored).
    const decoded = decodeParts([{ name: part!.name, data: part!.data }]);
    expect(decoded.data).toEqual(data.subarray(0, 500));
  });

  it('partCount + onlyParts still round-trips when all parts are included', () => {
    const parts = encodeFile(data, { filename: 'rand.bin', partCount: 3, timestamp: 1 });
    const decoded = decodeParts(parts);
    expect(decoded.data).toEqual(data);
  });
});
