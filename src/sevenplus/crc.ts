// CRC helpers matching utils.c:
//   crc_calc(crc, x) = crctab[crc>>8] ^ (((crc & 0xff) << 8) | (x & 0xff))
//   mcrc      — single-char "header crc" checked/written at the `\xb0\xb1\xb2?` sentinel
//   add_crc2  — 15-bit CRC encoded as 2 radix-216 chars at line[pos..pos+1]
//   crc_n_lnum — reads 3 radix-216 chars (line number + 14-bit crc) at line[64..66]

import { code, decodeTab, crctab } from './tables.js';

export function crcStep(crc: number, x: number): number {
  return (crctab[crc >>> 8]! ^ (((crc & 0xff) << 8) | (x & 0xff))) & 0xffff;
}

/**
 * Mini-CRC used for 7plus headers/footers. Finds the `\xb0\xb1` sentinel in the
 * line; computes CRC over bytes [0..pos+4) reduced mod 216; either verifies the
 * byte at pos+3 (flag=0, returns 1 if matches else 0) or writes it (flag=1).
 * Reference: utils.c `mcrc()`.
 */
export function mcrc(line: Uint8Array, flag: 0 | 1): number {
  let pos = -1;
  for (let i = 0; i < line.length - 1; i++) {
    if (line[i] === 0xb0 && line[i + 1] === 0xb1) { pos = i; break; }
  }
  if (pos < 0) return 0;
  const j = pos + 4;
  let crc = 0;
  for (let i = 0; i < j; i++) crc = crcStep(crc, line[i]!);
  crc = crc % 216;
  if (flag === 0) {
    return decodeTab[line[j]!] === crc ? 1 : 0;
  }
  line[j] = code[crc]!;
  return crc;
}

/**
 * 15-bit CRC written as 2 radix-216 chars at line[67..68]. Reference utils.c
 * `add_crc2` feeds bytes *in reverse* — `for (i=66; i>-1; i--)` — over the
 * first 67 bytes of a 69-byte line. Every structural line (header, extended
 * filename, code line, footer) is 69 bytes, so this is unconditional.
 */
export function addCrc2(line: Uint8Array): void {
  if (line.length !== 69) {
    throw new Error(`addCrc2 expects a 69-byte line, got ${line.length}`);
  }
  let crc = 0;
  for (let i = 66; i >= 0; i--) crc = crcStep(crc, line[i]!);
  crc &= 0x7fff;
  line[67] = code[crc % 216]!;
  line[68] = code[Math.floor(crc / 216)]!;
}

/** True if line[67..68] matches the CRC computed from line[0..67) in reverse. */
export function verifyCrc2(line: Uint8Array): boolean {
  if (line.length !== 69) return false;
  let crc = 0;
  for (let i = 66; i >= 0; i--) crc = crcStep(crc, line[i]!);
  crc &= 0x7fff;
  return line[67] === code[crc % 216] && line[68] === code[Math.floor(crc / 216)];
}

/**
 * Extract line number (9 bits) and 14-bit CRC from code line positions 64..66.
 * Reference: utils.c crc_n_lnum().
 */
export function crcAndLinenum(line: Uint8Array): { linenum: number; crc: number } {
  const d64 = decodeTab[line[64]!]!;
  const d65 = decodeTab[line[65]!]!;
  const d66 = decodeTab[line[66]!]!;
  // cs = 0xb640 * d66 + 0xd8 * d65 + d64  (216^2 = 46656 = 0xb640)
  const cs = 0xb640 * d66 + 0xd8 * d65 + d64;
  return { linenum: Math.floor(cs / 0x4000), crc: cs & 0x3fff };
}

/**
 * 14-bit CRC computed over the first 64 bytes of a code line. Used during both
 * encode (to pack into positions 64..66) and decode (to validate).
 */
export function codeLineCrc14(line: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < 64; i++) crc = crcStep(crc, line[i]!);
  return crc & 0x3fff;
}
