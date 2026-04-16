import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractParts, decodeParts } from '../src/sevenplus/decode.js';

function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
}

describe('extractParts against a real BBS mail dump', () => {
  const raw = readFixture('bbs-mail.txt');

  it('pulls every 7plus part out of a multi-file mail bundle', () => {
    const parts = extractParts(raw);
    const counts = new Map<string, Set<number>>();
    for (const p of parts) {
      if (!counts.has(p.filename)) counts.set(p.filename, new Set());
      counts.get(p.filename)!.add(p.part);
    }
    // The fixture contains four files: 9+3+7+6 = 25 parts total.
    expect(parts.length).toBe(25);
    expect(counts.get('NORDKAPP.JPG')?.size).toBe(9);
    expect(counts.get('PINKSK_1.JPG')?.size).toBe(3);
    expect(counts.get('22-1-2_1.JPG')?.size).toBe(7);
    expect(counts.get('SUNDAY.JPG')?.size).toBe(6);
  });

  it('decodes NORDKAPP.JPG end-to-end from the extracted parts', () => {
    const parts = extractParts(raw).filter((p) => p.filename === 'NORDKAPP.JPG');
    const result = decodeParts(parts.map((p) => ({ name: `${p.filename}.p${p.part}`, data: p.data })));
    expect(result.stats.corrupted).toBe(0);
    expect(result.stats.missing).toBe(0);
    // Real JPEG magic bytes.
    expect(result.data[0]).toBe(0xff);
    expect(result.data[1]).toBe(0xd8);
    expect(result.data[2]).toBe(0xff);
  });

  it('handles parts pasted in scrambled order (22-1-2_1.JPG)', () => {
    const parts = extractParts(raw).filter((p) => p.filename === '22-1-2_1.JPG');
    // Verify the fixture really is out-of-order — that's the interesting case.
    const order = parts.map((p) => p.part);
    expect(order).not.toEqual([...order].sort((a, b) => a - b));
    const result = decodeParts(parts.map((p) => ({ name: `${p.filename}.p${p.part}`, data: p.data })));
    expect(result.stats.corrupted).toBe(0);
    expect(result.stats.missing).toBe(0);
  });
});
