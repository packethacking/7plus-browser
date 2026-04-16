import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { mcrc, addCrc2, codeLineCrc14, crcAndLinenum } from '../src/sevenplus/crc.js';

const sampleP01 = readFileSync(new URL('../sample-data/sample.p01', import.meta.url));

// Split sample.p01 by CRLF, keeping bytes as Uint8Array per line (no content
// conversion — 7plus is 8-bit clean).
function splitLines(buf: Buffer): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const end = i > 0 && buf[i - 1] === 0x0d ? i - 1 : i;
      out.push(new Uint8Array(buf.subarray(start, end)));
      start = i + 1;
    }
  }
  if (start < buf.length) out.push(new Uint8Array(buf.subarray(start)));
  return out;
}

describe('CRC golden values from sample.p01', () => {
  const lines = splitLines(sampleP01);

  it('parses sample.p01 into reasonable line count', () => {
    expect(lines.length).toBeGreaterThan(100);
  });

  it('header line mcrc validates', () => {
    // First non-empty line is the header.
    const header = lines.find((l) => {
      const s = new TextDecoder('latin1').decode(l);
      return s.startsWith(' go_7+.');
    })!;
    expect(header).toBeDefined();
    expect(mcrc(header, 0)).toBe(1);
  });

  it('extended filename line mcrc validates', () => {
    // Second header-ish line in part 1: begins with '/'.
    const extended = lines.find((l) => l[0] === 0x2f /* '/' */)!;
    expect(extended).toBeDefined();
    expect(mcrc(extended, 0)).toBe(1);
  });

  it('stop_7+. footer mcrc validates', () => {
    const stop = lines.find((l) => {
      const s = new TextDecoder('latin1').decode(l);
      return s.startsWith(' stop_7+.');
    })!;
    expect(stop).toBeDefined();
    expect(mcrc(stop, 0)).toBe(1);
  });

  // All structural lines (header/extended/code/footer) are 69 bytes. Identify
  // the code-line band as: lines[2..N-2] (skipping header, extended filename,
  // and footer) for sample.p01.
  it('identifies 138 code lines between header-block and footer', () => {
    // p01: line 0 = header, line 1 = extended filename, lines 2..139 = code,
    // line 140 = footer.
    expect(lines[0]?.length).toBe(69);
    expect(lines[1]?.length).toBe(69);
    expect(lines[140]?.length).toBe(69);
    const codeBand = lines.slice(2, 140);
    expect(codeBand.length).toBe(138);
    for (const l of codeBand) expect(l.length).toBe(69);
  });

  it('all code lines pass crc14 check with sequential line numbers', () => {
    const codeBand = lines.slice(2, 140);
    for (let i = 0; i < codeBand.length; i++) {
      const line = codeBand[i]!;
      const { linenum, crc } = crcAndLinenum(line);
      expect(linenum).toBe(i);
      expect(crc).toBe(codeLineCrc14(line));
    }
  });

  it('code line crc15 (67..68) round-trips through addCrc2 (reverse-iteration)', () => {
    const ref = lines[2]!; // first code line
    const mut = new Uint8Array(ref);
    mut[67] = 0;
    mut[68] = 0;
    addCrc2(mut);
    expect(mut[67]).toBe(ref[67]);
    expect(mut[68]).toBe(ref[68]);
  });

  it('header line crc2 (67..68) round-trips through addCrc2', () => {
    const header = lines[0]!;
    expect(header.length).toBe(69);
    const mut = new Uint8Array(header);
    mut[67] = 0;
    mut[68] = 0;
    addCrc2(mut);
    expect(mut[67]).toBe(header[67]);
    expect(mut[68]).toBe(header[68]);
  });

  it('footer line crc2 (67..68) round-trips through addCrc2', () => {
    const footer = lines[140]!;
    expect(footer.length).toBe(69);
    const mut = new Uint8Array(footer);
    mut[67] = 0;
    mut[68] = 0;
    addCrc2(mut);
    expect(mut[67]).toBe(footer[67]);
    expect(mut[68]).toBe(footer[68]);
  });
});
