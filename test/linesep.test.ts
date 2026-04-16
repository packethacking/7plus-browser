import { describe, it, expect } from 'vitest';
import { encodeFile } from '../src/sevenplus/encode.js';

describe('line separator', () => {
  const data = new Uint8Array(500);
  for (let i = 0; i < 500; i++) data[i] = i & 0xff;

  it('CRLF output contains 0x0a bytes at line ends', () => {
    const out = encodeFile(data, { filename: 'test.bin', timestamp: 1, lineSep: '\r\n' })[0]!.data;
    const lfCount = [...out].filter((b) => b === 0x0a).length;
    expect(lfCount).toBeGreaterThan(5);
  });

  it('CR output contains zero 0x0a bytes', () => {
    const out = encodeFile(data, { filename: 'test.bin', timestamp: 1, lineSep: '\r' })[0]!.data;
    const lfCount = [...out].filter((b) => b === 0x0a).length;
    expect(lfCount).toBe(0);
  });

  it('CRLF output is exactly N bytes longer than CR output (one extra LF per line)', () => {
    const crlf = encodeFile(data, { filename: 'test.bin', timestamp: 1, lineSep: '\r\n' })[0]!.data;
    const cr   = encodeFile(data, { filename: 'test.bin', timestamp: 1, lineSep: '\r'   })[0]!.data;
    const crCount = [...cr].filter((b) => b === 0x0d).length;
    expect(crlf.length - cr.length).toBe(crCount);
  });
});
