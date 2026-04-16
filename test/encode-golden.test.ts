import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { encodeFile } from '../src/sevenplus/encode.js';

function readSample(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../sample-data/${name}`, import.meta.url)));
}

/** Extract timestamp (hex) from the footer of a reference part file. */
function timestampFromFooter(part: Uint8Array): number {
  // Footer line starts with ' stop_7+. (...) [HEXTS]' and is 69 bytes.
  // Find ' stop_7+. ' in the last chunk and pull the [...] field.
  const text = new TextDecoder('latin1').decode(part);
  const m = text.match(/ stop_7\+\. \([^)]+\) \[([0-9A-Fa-f]+)\]/);
  if (!m) throw new Error('no footer timestamp found');
  return parseInt(m[1]!, 16);
}

const FIXTURE = 'fields.jpg';
const PART_COUNT = 17;
const LAST_PART = (PART_COUNT).toString(16).padStart(2, '0');

describe('encoder byte-identical against sample-data', () => {
  const source = readSample(FIXTURE);
  const refP01 = readSample('fields.p01');
  const refLast = readSample(`fields.p${LAST_PART}`);
  const ts = timestampFromFooter(refLast);

  it(`produces ${PART_COUNT} parts with matching names`, () => {
    const parts = encodeFile(source, { filename: FIXTURE, timestamp: ts });
    expect(parts.length).toBe(PART_COUNT);
    expect(parts[0]!.name).toBe('fields.p01');
    expect(parts[PART_COUNT - 1]!.name).toBe(`fields.p${LAST_PART}`);
  });

  it('part 1 matches fields.p01 byte-for-byte', () => {
    const parts = encodeFile(source, { filename: FIXTURE, timestamp: ts });
    const got = parts[0]!.data;
    expect(got.length).toBe(refP01.length);
    if (!bufEq(got, refP01)) {
      const diff = firstDiff(got, refP01);
      throw new Error(`fields.p01 differs at byte ${diff.idx}: got ${diff.got}, expected ${diff.exp}`);
    }
  });

  it(`all ${PART_COUNT} parts match byte-for-byte`, () => {
    const parts = encodeFile(source, { filename: FIXTURE, timestamp: ts });
    for (let i = 0; i < parts.length; i++) {
      const partNum = (i + 1).toString(16).padStart(2, '0');
      const ref = readSample(`fields.p${partNum}`);
      const got = parts[i]!.data;
      expect(got.length, `part ${partNum} length`).toBe(ref.length);
      if (!bufEq(got, ref)) {
        const diff = firstDiff(got, ref);
        throw new Error(`fields.p${partNum} differs at byte ${diff.idx}: got ${diff.got}, expected ${diff.exp}`);
      }
    }
  });
});

function bufEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function firstDiff(a: Uint8Array, b: Uint8Array): { idx: number; got: number; exp: number } {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return { idx: i, got: a[i]!, exp: b[i]! };
  }
  return { idx: Math.min(a.length, b.length), got: -1, exp: -1 };
}
