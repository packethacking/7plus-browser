// 7PLUS encoder. Produces one or more part files from a source blob.

import {
  buildHeaderLine, buildExtendedNameLine, buildFooterLine, buildCodeLine, dosName,
} from './format.js';

export type LineSep = '\r\n' | '\n' | '\r';

export interface EncodeOptions {
  /** Original filename, stored in the header and optionally in the extended line. */
  filename: string;
  /**
   * Target block payload size in bytes. 0 → single part (no split). Rounded up
   * to a whole number of code lines (62 payload bytes each). Reference caps at
   * 512 lines/part (= 31744 bytes). Default 8556 (= 138 × 62) matches the
   * reference default, producing ~10KB part files including metadata.
   */
  blocksize?: number;
  /** Unix seconds; stored in footer as hex. Default: now. */
  timestamp?: number;
  /** Line separator for output. Default '\r\n'. */
  lineSep?: LineSep;
  /**
   * Emit the extended-filename line in part 1 (preserves the full original
   * filename). Default `true` — matches the reference's default (LFN builds
   * initialize `_extended = '*'`).
   */
  extendedName?: boolean;
  /**
   * Split into roughly N equal parts (reference's `-sp N`). Overrides
   * `blocksize` when provided.
   */
  partCount?: number;
  /**
   * Emit only these part numbers (1-based), e.g. `[1, 5, 6, 7]`. Splitting
   * still uses the full part count — this just filters the output. Useful for
   * resending a subset when the recipient reports missing parts. Reference:
   * `-r 5-10,1`.
   */
  onlyParts?: Iterable<number>;
  /**
   * Optional string appended as one extra line after each part's footer.
   * Reference's `-t` flag. Typical value: `/ex` to signal end-of-file to a
   * packet BBS on upload.
   */
  terminator?: string;
}

export interface EncodedPart {
  /** Output filename, e.g. "sample.p01" (or "sample.7pl" for single-part). */
  name: string;
  /** Full encoded bytes including line separators. */
  data: Uint8Array;
}

const DEFAULT_BLOCKSIZE = 138 * 62;

/** Encode a blob into 7PLUS parts. */
export function encodeFile(data: Uint8Array, opts: EncodeOptions): EncodedPart[] {
  const sep = opts.lineSep ?? '\r\n';
  const sepBytes = sep === '\r\n' ? new Uint8Array([0x0d, 0x0a]) : sep === '\n' ? new Uint8Array([0x0a]) : new Uint8Array([0x0d]);
  const size = data.length;
  if (size === 0) throw new Error('7PLUS refuses to encode zero-length files');

  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const hdrName = dosName(opts.filename);
  const extended = opts.extendedName ?? true;

  // Sizing — follow reference encode.c lines 199–224:
  //   1. If requested size > 50000, adjust to split "roughly equal parts".
  //   2. If 0 or bigger than file, use filesize.
  //   3. Cap at 512 lines × 62 per part.
  //   4. blocklines = ceil(blocksize / 62).
  //   5. parts = ceil(size / (blocklines * 62)).
  let blocksize = opts.blocksize ?? DEFAULT_BLOCKSIZE;
  if (opts.partCount != null) {
    if (opts.partCount < 1 || !Number.isFinite(opts.partCount)) {
      throw new Error(`partCount must be ≥1 (got ${opts.partCount})`);
    }
    blocksize = Math.ceil(Math.ceil((size + 61) / 62) / opts.partCount) * 62;
  } else if (blocksize > 50000) {
    const requestedParts = blocksize - 50000;
    blocksize = Math.ceil((Math.ceil((size + 61) / 62)) / requestedParts) * 62;
  }
  if (blocksize === 0 || blocksize > size) blocksize = size;
  if (blocksize > 512 * 62) blocksize = 512 * 62;
  const blockLines = Math.ceil(blocksize / 62);
  const partPayload = blockLines * 62;
  const parts = Math.ceil(size / partPayload);
  if (parts > 255) {
    throw new Error(`7PLUS supports at most 255 parts (got ${parts}). Choose a larger blocksize.`);
  }

  const baseName = dosBaseName(opts.filename);
  const result: EncodedPart[] = [];
  const onlyParts = opts.onlyParts ? new Set(opts.onlyParts) : null;
  const terminatorBytes = opts.terminator ? asciiLine(opts.terminator) : null;

  for (let part = 1; part <= parts; part++) {
    if (onlyParts && !onlyParts.has(part)) continue;
    const buf: number[] = [];

    const startByte = (part - 1) * partPayload;
    const endByte = Math.min(startByte + partPayload, size);
    const linesInPart = part === parts && parts > 1
      ? Math.max(1, Math.ceil((endByte - startByte) / 62))
      : blockLines;
    // Header `%04X` blocksize field is `(linesInPart * 64) & 0xffff` — on the
    // last part the reference mutates the local `blocksize` so this field
    // shrinks; `blockLines` (the `%03X` field) stays at the full value.
    const blockSizeField = (linesInPart * 64) & 0xffff;

    pushLine(buf, buildHeaderLine({
      part, parts, hdrName, fileSize: size, blockSize: blockSizeField, blockLines, extended,
    }), sepBytes);

    if (part === 1 && extended) {
      pushLine(buf, buildExtendedNameLine(stripPath(opts.filename)), sepBytes);
    }

    for (let l = 0; l < linesInPart; l++) {
      const off = startByte + l * 62;
      const sliceEnd = Math.min(off + 62, size);
      const slice = new Uint8Array(62);
      slice.set(data.subarray(off, sliceEnd), 0);
      pushLine(buf, buildCodeLine(slice, l), sepBytes);
    }

    // Footer.
    pushLine(buf, buildFooterLine({
      hdrName, part, parts, timestamp,
    }), sepBytes);

    if (terminatorBytes) pushLine(buf, terminatorBytes, sepBytes);

    const partData = new Uint8Array(buf);
    const partName = parts === 1 ? `${baseName}.7pl` : `${baseName}.p${toHex2(part)}`;
    result.push({ name: partName, data: partData });
  }

  return result;
}

function stripPath(filename: string): string {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  return slash >= 0 ? filename.slice(slash + 1) : filename;
}

/** lowercase basename (no extension) used for part file names. */
function dosBaseName(filename: string): string {
  const base = stripPath(filename);
  const dot = base.lastIndexOf('.');
  const name = dot >= 0 ? base.slice(0, dot) : base;
  return name.replace(/\s+/g, '').slice(0, 8).toLowerCase();
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function pushLine(buf: number[], line: Uint8Array, sep: Uint8Array): void {
  for (const b of line) buf.push(b);
  for (const b of sep) buf.push(b);
}

function asciiLine(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0xff) throw new Error(`terminator contains non-latin1 char: "${s}"`);
    out[i] = c;
  }
  return out;
}
