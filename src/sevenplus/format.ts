// Builders for the four 69-byte line types (header, extended-filename, code,
// footer). All mcrc/crc2 positions are filled in-place before return.

import { code } from './tables.js';
import { mcrc, addCrc2, crcStep } from './crc.js';

const ASCII = (s: string): Uint8Array => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) throw new Error(`non-latin1 char ${c} in "${s}"`);
    out[i] = c;
  }
  return out;
};

const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');

/**
 * Build the 12-character uppercase DOS 8.3 display name used in the header
 * `%-12s` field. Path components are stripped; base truncated to 8 chars;
 * extension (without dot) truncated to 3 chars; joined with '.', then padded
 * with spaces to 12 chars total.
 */
export function dosName(filename: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const base = slash >= 0 ? filename.slice(slash + 1) : filename;
  const dot = base.lastIndexOf('.');
  let name = (dot >= 0 ? base.slice(0, dot) : base).replace(/\s+/g, '').slice(0, 8);
  let ext = (dot >= 0 ? base.slice(dot + 1) : '').replace(/\s+/g, '').slice(0, 3);
  const full = (ext ? `${name}.${ext}` : name).toUpperCase();
  return full.padEnd(12, ' ');
}

export interface HeaderInfo {
  part: number;
  parts: number;
  hdrName: string;     // 12-char uppercase DOS name
  fileSize: number;
  blockSize: number;   // lower 16 bits of (blockLines * 64)
  blockLines: number;
  extended: boolean;
}

/**
 * Header layout (69 bytes, verified byte-for-byte against sample.p01):
 *   0..7   ' go_7+. '
 *   8..10  part as %03d
 *   11..14 ' of '
 *   15..17 parts as %03d
 *   18     ' '
 *   19..30 hdrName (12 chars)
 *   31     ' '
 *   32..38 fileSize as %07d
 *   39     ' '
 *   40..43 blockSize as %04X
 *   44     ' '
 *   45..47 blockLines as %03X
 *   48..61 ' (7PLUS v2.2) '
 *   62..64 \xb0\xb1\xb2
 *   65     '*' if extended, else ' '
 *   66     mcrc (filled by mcrc())
 *   67..68 crc2 (filled by addCrc2())
 */
export function buildHeaderLine(info: HeaderInfo): Uint8Array {
  const text =
    ' go_7+. ' +
    String(info.part).padStart(3, '0') + ' of ' +
    String(info.parts).padStart(3, '0') + ' ' +
    info.hdrName + ' ' +
    String(info.fileSize).padStart(7, '0') + ' ' +
    hex(info.blockSize & 0xffff, 4) + ' ' +
    hex(info.blockLines, 3) + ' (7PLUS v2.2) ';
  if (text.length !== 62) {
    throw new Error(`header text length ${text.length} != 62: "${text}"`);
  }
  const line = new Uint8Array(69);
  line.set(ASCII(text), 0);
  line[62] = 0xb0;
  line[63] = 0xb1;
  line[64] = 0xb2;
  line[65] = info.extended ? 0x2a : 0x20;
  mcrc(line, 1);
  addCrc2(line);
  return line;
}

/**
 * Extended filename line, part 1 only. Layout (69 bytes):
 *   0..61  '/' fill with origName placed at offset 1
 *   62..64 \xb0\xb1\xb2
 *   65     '*'
 *   66     mcrc
 *   67..68 crc2
 */
export function buildExtendedNameLine(origName: string): Uint8Array {
  const line = new Uint8Array(69);
  line.fill(0x2f, 0, 62);
  const bytes = ASCII(origName);
  if (bytes.length > 60) {
    throw new Error(`extended filename too long (max 60 bytes): "${origName}"`);
  }
  line.set(bytes, 1);
  line[62] = 0xb0;
  line[63] = 0xb1;
  line[64] = 0xb2;
  line[65] = 0x2a;
  mcrc(line, 1);
  addCrc2(line);
  return line;
}

export interface FooterInfo {
  hdrName: string;    // 12-char uppercase DOS name (header field, we'll trim)
  part: number;
  parts: number;
  timestamp: number;  // unix seconds
}

/**
 * Footer layout (69 bytes). Reference builds two buffers:
 *   line  = <62 spaces>\xb0\xb1\xb2\xdb
 *   line2 = " stop_7+. (NAME.PXX/YY) [HEXTS]"
 * then memcpys line2 over the prefix of line. mcrc writes at position 66
 * (overwriting null terminator / unused space). \xdb at position 65 survives
 * as the footer marker. addCrc2 writes at 67..68.
 */
export function buildFooterLine(info: FooterInfo): Uint8Array {
  const line = new Uint8Array(69);
  line.fill(0x20, 0, 62);
  line[62] = 0xb0;
  line[63] = 0xb1;
  line[64] = 0xb2;
  line[65] = 0xdb;

  // Trim padding spaces from hdrName, uppercase (already is).
  const trimmed = info.hdrName.trim(); // e.g. "SAMPLE.PNG"
  const [baseRaw, extRaw] = trimmed.split('.');
  const base = baseRaw ?? '';
  const ext = extRaw ?? '';
  const suffix = info.parts > 1
    ? `${base}.P${hex(info.part, 2)}/${hex(info.parts, 2)}`
    : `${base}.7PL`;
  const prefix = ` stop_7+. (${suffix}) [${info.timestamp.toString(16).toUpperCase()}]`;
  if (prefix.length > 62) {
    throw new Error(`footer prefix too long (${prefix.length}): "${prefix}"`);
  }
  // Preserve case of ext — unused for now since it ends up inside the paren
  // for split parts but NOT for single-part (.7PL). For split parts the
  // original extension doesn't appear — parts are named NAME.PXX. For .7PL
  // case we don't emit the ext either. So `ext` is unused here (kept above
  // only for clarity).
  void ext;
  line.set(ASCII(prefix), 0);
  mcrc(line, 1);
  addCrc2(line);
  return line;
}

/**
 * Build one 69-byte code line from 62 input payload bytes plus a line number.
 * Reference: encode.c inner loop (lines ~560–620).
 *
 *   1. Split 62 bytes into two 31-byte groups. Each group is packed into 8
 *      values by reading 4 (or 3, for the last value) sequential bytes
 *      big-endian into a 32-bit accumulator. Then the "bit-squeeze" at
 *      encode.c:580–587 rearranges those 8 × 32-bit accumulators into 8 ×
 *      31-bit values by shifting out the top bits of each to feed the next.
 *   2. Emit each of the resulting 16 × 31-bit longs as 4 radix-216 chars,
 *      little-endian (char 0 = value % 216, char 3 = value / 216^3).
 *   3. Compute 14-bit forward CRC over the 64 payload chars. Pack
 *      `(linenum << 14) | crc14` as 3 radix-216 chars at positions 64..66.
 *   4. Write 15-bit reverse-iteration CRC at positions 67..68 via addCrc2.
 */
export function buildCodeLine(payload: Uint8Array, linenum: number): Uint8Array {
  if (payload.length !== 62) {
    throw new Error(`buildCodeLine expects 62 payload bytes, got ${payload.length}`);
  }
  const line = new Uint8Array(69);
  const after = new BigUint64Array(16);

  let p = 0;
  for (let g = 0; g < 2; g++) {
    const off = g * 8;
    for (let j = 0; j < 8; j++) {
      let v = 0n;
      const nBytes = j === 7 ? 3 : 4;
      for (let k = 0; k < nBytes; k++) {
        const b = p < payload.length ? payload[p++]! : 0;
        v = (v << 8n) | BigInt(b);
      }
      after[off + j] = v;
    }
    // Bit-squeeze — see encode.c 580..587.
    after[off + 7] =  after[off + 7]              | ((after[off + 6] & 0x7fn) << 24n);
    after[off + 6] = (after[off + 6] >> 7n)       | ((after[off + 5] & 0x3fn) << 25n);
    after[off + 5] = (after[off + 5] >> 6n)       | ((after[off + 4] & 0x1fn) << 26n);
    after[off + 4] = (after[off + 4] >> 5n)       | ((after[off + 3] & 0x0fn) << 27n);
    after[off + 3] = (after[off + 3] >> 4n)       | ((after[off + 2] & 0x07n) << 28n);
    after[off + 2] = (after[off + 2] >> 3n)       | ((after[off + 1] & 0x03n) << 29n);
    after[off + 1] = (after[off + 1] >> 2n)       | ((after[off + 0] & 0x01n) << 30n);
    after[off + 0] = (after[off + 0] >> 1n);
  }

  const D216 = 216n;
  let j = 0;
  for (let i = 0; i < 16; i++) {
    let v = after[i];
    line[j++] = code[Number(v % D216)]!;
    v /= D216;
    line[j++] = code[Number(v % D216)]!;
    v /= D216;
    line[j++] = code[Number(v % D216)]!;
    v /= D216;
    line[j++] = code[Number(v)]!;
  }

  // linenum + crc14 packed into 3 radix-216 chars at 64..66.
  let crc14 = 0;
  for (let i = 0; i < 64; i++) crc14 = crcStep(crc14, line[i]!);
  crc14 &= 0x3fff;
  let packed = (BigInt(linenum & 0x1ff) << 14n) | BigInt(crc14);
  line[64] = code[Number(packed % D216)]!;
  packed /= D216;
  line[65] = code[Number(packed % D216)]!;
  packed /= D216;
  line[66] = code[Number(packed)]!;

  addCrc2(line);
  return line;
}
