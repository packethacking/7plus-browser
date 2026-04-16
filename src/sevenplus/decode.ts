// 7PLUS decoder. Parses parts, validates CRCs, reassembles the original blob.

import { decodeTab } from './tables.js';
import { mcrc, verifyCrc2, crcAndLinenum, codeLineCrc14 } from './crc.js';

export interface DecodeInputPart {
  name: string;
  data: Uint8Array;
}

export interface DecodeResult {
  filename: string;           // recovered name (extended-filename line if present)
  data: Uint8Array;
  timestamp: number | null;   // unix seconds from footer
  stats: {
    totalCodeLines: number;
    corrupted: number;        // lines with bad CRC that couldn't be rebuilt
    missing: number;          // lines absent entirely
  };
}

const LF = 0x0a;
const CR = 0x0d;

/**
 * Split a raw part file into lines. Accepts any of LF, CRLF, CR as terminator.
 * Empty trailing line is dropped. Line bytes don't include the terminator.
 */
function splitLines(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = 0;
  let i = 0;
  while (i < buf.length) {
    const b = buf[i]!;
    if (b === LF) {
      const end = i > start && buf[i - 1] === CR ? i - 1 : i;
      out.push(buf.subarray(start, end));
      i++;
      start = i;
    } else if (b === CR) {
      // CR followed by LF → handled above. Otherwise it's a standalone CR line sep.
      if (i + 1 < buf.length && buf[i + 1] === LF) {
        out.push(buf.subarray(start, i));
        i += 2;
        start = i;
      } else {
        out.push(buf.subarray(start, i));
        i++;
        start = i;
      }
    } else {
      i++;
    }
  }
  if (start < buf.length) out.push(buf.subarray(start));
  return out;
}

interface HeaderFields {
  part: number;
  parts: number;
  hdrName: string;
  fileSize: number;
  blockSize: number;
  blockLines: number;
  extended: boolean;
  headerLine: Uint8Array;
}

/**
 * Parse a 69-byte header line. Returns null if not a valid ` go_7+. ` header
 * or mcrc/crc2 fail.
 */
function parseHeader(line: Uint8Array): HeaderFields | null {
  if (line.length !== 69) return null;
  const text = latin1(line);
  if (!text.startsWith(' go_7+.')) return null;
  // Fields parsed out of fixed positions (see format.ts buildHeaderLine comment).
  const part = parseInt(text.slice(8, 11), 10);
  if (text.slice(11, 15) !== ' of ') return null;
  const parts = parseInt(text.slice(15, 18), 10);
  if (text[18] !== ' ') return null;
  const hdrName = text.slice(19, 31);
  if (text[31] !== ' ') return null;
  const fileSize = parseInt(text.slice(32, 39), 10);
  if (text[39] !== ' ') return null;
  const blockSize = parseInt(text.slice(40, 44), 16);
  if (text[44] !== ' ') return null;
  const blockLines = parseInt(text.slice(45, 48), 16);
  if (text.slice(48, 62) !== ' (7PLUS v2.2) ') return null;
  if (line[62] !== 0xb0 || line[63] !== 0xb1 || line[64] !== 0xb2) return null;
  const extended = line[65] === 0x2a; // '*'
  if (
    Number.isNaN(part) || Number.isNaN(parts) || Number.isNaN(fileSize) ||
    Number.isNaN(blockSize) || Number.isNaN(blockLines)
  ) return null;
  if (!mcrc(line, 0)) return null;
  if (!verifyCrc2(line)) return null;
  return { part, parts, hdrName, fileSize, blockSize, blockLines, extended, headerLine: line };
}

function parseExtendedName(line: Uint8Array): string | null {
  if (line.length !== 69) return null;
  if (line[0] !== 0x2f) return null;
  if (line[62] !== 0xb0 || line[63] !== 0xb1 || line[64] !== 0xb2 || line[65] !== 0x2a) return null;
  if (!mcrc(line, 0) || !verifyCrc2(line)) return null;
  // Find first '/' after position 0 that terminates the name.
  let end = 1;
  while (end < 62 && line[end] !== 0x2f) end++;
  return latin1(line.subarray(1, end));
}

function parseFooter(line: Uint8Array): { timestamp: number | null } | null {
  if (line.length !== 69) return null;
  const text = latin1(line);
  if (!text.startsWith(' stop_7+.')) return null;
  if (line[62] !== 0xb0 || line[63] !== 0xb1 || line[64] !== 0xb2 || line[65] !== 0xdb) return null;
  if (!mcrc(line, 0) || !verifyCrc2(line)) return null;
  const m = text.match(/\[([0-9A-Fa-f]+)\]/);
  return { timestamp: m ? parseInt(m[1]!, 16) : null };
}

/**
 * Decode a 69-byte code line back to its 62 payload bytes. Returns null if
 * the 14-bit CRC at positions 64..66 does not match the computed CRC.
 *
 * Inverse of buildCodeLine in format.ts:
 *   1. Rebuild 16 × 31-bit longs from 4 radix-216 chars each (big-end).
 *   2. Reverse the bit-squeeze (decode.c:634..641) to recover 2 × 8 × 32-bit
 *      values containing 31 source bytes per group.
 *   3. Emit the 31 bytes in order for each group (last long only 3 bytes).
 */
export function decodeCodeLine(line: Uint8Array): { data: Uint8Array; linenum: number } | null {
  if (line.length !== 69) return null;
  const after = new BigUint64Array(16);

  // Rebuild 16 longs from chars 0..63. Reference decode.c 618..627:
  //   for (i=k=0; i<64; i++) {
  //     if ((i&3) == 3) {
  //       after[k] = 0;
  //       for (j=i; j>(i-4); j--) after[k] = after[k] * 216 + decode[p[j]];
  //       k++;
  //     }
  //   }
  for (let i = 0, k = 0; i < 64; i++) {
    if ((i & 3) === 3) {
      let v = 0n;
      for (let j = i; j > i - 4; j--) {
        const d = decodeTab[line[j]!]!;
        if (d === 255) return null;
        v = v * 216n + BigInt(d);
      }
      after[k++] = v;
    }
  }

  // Reverse the bit-squeeze. Reference decode.c 634..641. The reference uses
  // 32-bit ulong — left shifts truncate at 32 bits. BigInt has unlimited
  // precision, so we explicitly mask each shifted result with 0xFFFFFFFF.
  const M32 = 0xFFFFFFFFn;
  const out = new Uint8Array(62);
  for (let g = 0; g < 2; g++) {
    const off = g * 8;
    const a = after;
    a[off + 0] = ((a[off + 0]! << 1n) | (a[off + 1]! >> 30n)) & M32;
    a[off + 1] = ((a[off + 1]! << 2n) | (a[off + 2]! >> 29n)) & M32;
    a[off + 2] = ((a[off + 2]! << 3n) | (a[off + 3]! >> 28n)) & M32;
    a[off + 3] = ((a[off + 3]! << 4n) | (a[off + 4]! >> 27n)) & M32;
    a[off + 4] = ((a[off + 4]! << 5n) | (a[off + 5]! >> 26n)) & M32;
    a[off + 5] = ((a[off + 5]! << 6n) | (a[off + 6]! >> 25n)) & M32;
    a[off + 6] = ((a[off + 6]! << 7n) | (a[off + 7]! >> 24n)) & M32;
    a[off + 7] = (a[off + 7]! << 8n) & M32;

    // Emit 4 bytes for j=0..6 (shifts 24,16,8,0) and 3 bytes for j=7
    // (shifts 24,16,8 — the low 8 bits are zero after the `<<8` above).
    let outIdx = g * 31;
    for (let j = 0; j < 8; j++) {
      const v = a[off + j]!;
      out[outIdx++] = Number((v >> 24n) & 0xffn);
      out[outIdx++] = Number((v >> 16n) & 0xffn);
      out[outIdx++] = Number((v >> 8n) & 0xffn);
      if (j === 7) break;
      out[outIdx++] = Number(v & 0xffn);
    }
  }

  const { linenum, crc } = crcAndLinenum(line);
  if (crc !== codeLineCrc14(line)) return null;
  return { data: out, linenum };
}

/**
 * Decode a set of 7PLUS parts back to the original bytes. Parts may be given
 * in any order; the part number is read from each header. All parts required
 * by the first header's `parts` count must be present.
 */
export function decodeParts(inputs: DecodeInputPart[]): DecodeResult {
  if (inputs.length === 0) throw new Error('decodeParts: no input parts');

  // First pass: parse each part's header, index by part number.
  const byPart = new Map<number, { header: HeaderFields; lines: Uint8Array[]; extName?: string; footer?: { timestamp: number | null } }>();
  let totalParts = 0;
  let fileSize = 0;
  let extFromFirst: string | undefined;
  let timestampOut: number | null = null;

  for (const input of inputs) {
    const lines = splitLines(input.data);
    // Header is the first 69-byte line that parses as a valid header.
    let headerIdx = -1;
    let header: HeaderFields | null = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length === 69) {
        header = parseHeader(lines[i]!);
        if (header) { headerIdx = i; break; }
      }
    }
    if (!header) throw new Error(`${input.name}: no valid 7PLUS header found`);

    if (totalParts === 0) {
      totalParts = header.parts;
      fileSize = header.fileSize;
    } else if (header.parts !== totalParts || header.fileSize !== fileSize) {
      throw new Error(`${input.name}: header mismatch (parts=${header.parts} vs ${totalParts})`);
    }

    // Extended filename (part 1 only).
    let extName: string | undefined;
    let bodyStart = headerIdx + 1;
    if (header.extended && header.part === 1 && lines[bodyStart]?.length === 69) {
      const parsed = parseExtendedName(lines[bodyStart]!);
      if (parsed !== null) {
        extName = parsed;
        extFromFirst = parsed;
        bodyStart++;
      }
    }

    // Footer: last 69-byte line beginning with ' stop_7+.'.
    let footer: { timestamp: number | null } | undefined;
    let bodyEnd = lines.length;
    for (let i = lines.length - 1; i >= bodyStart; i--) {
      if (lines[i]!.length === 69) {
        const parsed = parseFooter(lines[i]!);
        if (parsed) { footer = parsed; bodyEnd = i; break; }
      }
    }
    if (footer?.timestamp != null && timestampOut === null) {
      timestampOut = footer.timestamp;
    }

    byPart.set(header.part, {
      header,
      lines: lines.slice(bodyStart, bodyEnd),
      extName,
      footer,
    });
  }

  // Validate coverage.
  for (let p = 1; p <= totalParts; p++) {
    if (!byPart.has(p)) throw new Error(`missing part ${p} of ${totalParts}`);
  }

  // Assemble the output buffer.
  const blockLines = byPart.get(1)!.header.blockLines;
  const out = new Uint8Array(fileSize);
  let corrupted = 0;
  let missing = 0;
  let totalCodeLines = 0;

  for (let p = 1; p <= totalParts; p++) {
    const info = byPart.get(p)!;
    const partStart = (p - 1) * blockLines * 62;
    // Reference computes lines in this part based on fileSize/blockSize math.
    // Each part has `blockLines` code lines, except the last part which has
    // ceil((fileSize - (parts-1)*blockLines*62) / 62) lines.
    const bytesThisPart = Math.min(blockLines * 62, fileSize - partStart);
    const linesThisPart = Math.ceil(bytesThisPart / 62);
    totalCodeLines += linesThisPart;

    // Index code lines we received by their declared line number.
    const received = new Map<number, Uint8Array>();
    for (const line of info.lines) {
      if (line.length !== 69) continue;
      const decoded = decodeCodeLine(line);
      if (!decoded) { corrupted++; continue; }
      received.set(decoded.linenum, decoded.data);
    }

    // Emit each line's 62 (or fewer, for the final line of the final part)
    // bytes into the output buffer at its position.
    for (let l = 0; l < linesThisPart; l++) {
      const globalOff = partStart + l * 62;
      const remaining = fileSize - globalOff;
      const lineBytes = Math.min(62, remaining);
      const line = received.get(l);
      if (line) {
        out.set(line.subarray(0, lineBytes), globalOff);
      } else {
        missing++;
        // Leave zeros in the output (out starts zero-filled).
      }
    }
  }

  return {
    filename: extFromFirst ?? byPart.get(1)!.header.hdrName.trim(),
    data: out,
    timestamp: timestampOut,
    stats: { totalCodeLines, corrupted, missing },
  };
}

function latin1(buf: Uint8Array): string {
  return new TextDecoder('latin1').decode(buf);
}
