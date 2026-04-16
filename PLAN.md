# 7plus-browser — implementation plan

Browser-based encoder/decoder for the 7PLUS file format (Axel Bauda, DG1BBQ, v2.2).
Reference C source: `/home/tf/src/7plus/`. Reference binary: `/home/tf/src/7plus-browser/7pl221en/7plus.exe`.
Golden test data: `/home/tf/src/7plus-browser/sample-data/` (sample.png + 19 encoded parts).

Scope for v1: **encode + decode only** (no `.err`/`.cor`/`.7ix`/extract/join yet).

## Format summary (verified against reference)

Each part is a text file (LF, CRLF, or CR line-endings all acceptable on decode):

```
[optional user-supplied top template lines]
 go_7+. NNN of NNN BASENAME.EXT  0FILESIZE BLOCKSIZE_HEX BLOCKLINES_HEX (7PLUS v2.2) \xb0\xb1\xb2<mcrc><crc2-2ch>
[optional "extended filename" line in part 1 when stored name is not 8.3:
 /fullname//...///\xb0\xb1\xb2*<mcrc><crc2-2ch>  (padded with '/' to char-52, suffix \xb0\xb1\xb2*)]
<code line 1>   (69 chars)
...
<code line N>   (69 chars)
 stop_7+. (BASENAME.PXX/YY) [HEXTIMESTAMP]<spaces padding>\xb0\xb1\xb2\xdb<mcrc><crc2-2ch>
[optional user-supplied bottom template lines]
```

Code line layout (69 chars):
- **0..63** — 16 × 31-bit longs, each encoded as 4 radix-216 chars (little-end first).
  - Per long: `ch0 = L%216; L/=216; ch1 = L%216; L/=216; ch2 = L%216; ch3 = L/216;`
- **64..66** — packed `(linenum<<14)|(crc14 & 0x3fff)` as 3 radix-216 chars, little-end.
- **67..68** — 15-bit CRC of chars 0..66 as 2 radix-216 chars.

Radix-216 alphabet (byte values emitted to file) — 216 codepoints in order:
- 0x21..0x29  (9)
- 0x2b..0x7e  (84)
- 0x80..0x90  (17)
- 0x92        (1)
- 0x94..0xfc  (105)
Total = 216.

CRC: CCITT-style, computed via `crctab[8]` table (see `init_crctab` in utils.c). `crc_calc(c, x) = c = crctab[c>>8] ^ (((c&255)<<8) | (x & 0xff))`.

**Radix216 per long**: max value written is `216^4 = 2,176,782,336`, which is > `2^31`, so all 31 bits fit. Bytes-to-longs packing: 31 bytes → 8 × 31-bit values via the bit-rearrangement in encode.c lines 580–587 (and its inverse in decode.c).

**Line payload**: 62 binary bytes → 1 code line. Last line of last part may carry fewer meaningful bytes (rest = filesize % 62, or 62 if 0).

**Header field details** (encoded via `sprintf " go_7+. %03d of %03d %-12s %07ld %04X %03X (7PLUS v2.2) \xb0\xb1\xb2%c"`):
- `%-12s` — uppercase DOS-style name padded to 12 chars (`SAMPLE.PNG  `).
- `%07ld` — decimal file size, 7 digits, zero-padded.
- `%04X` — `((blocklines)*64)` lower 16 bits, hex.
- `%03X` — blocklines as hex.
- Trailing `\xb0\xb1\xb2` + 1 mcrc byte + 2 crc2 bytes.
- The `%c` at end: `*` if using extended filename, otherwise space.

**Footer**: ` stop_7+. (NAME.PXX/YY) [TIMESTAMP]` padded with spaces to column 62, then `\xb0\xb1\xb2\xdb` + 1 mcrc byte + 2 crc2 bytes. Single-part files use `(NAME.7PL)` instead.

**mcrc** (one byte): scans for `\xb0\xb1` prefix; crc over bytes 0..pos+3 reduced mod 216, stored at pos+3 as a radix-216 code byte.

**crc2** (2 bytes): full 15-bit CRC over bytes 0..66 (for code lines) or 0..pos+3 (headers/footers), encoded as 2 radix-216 chars at positions 67..68 (code lines) or pos+4..pos+5 (headers/footers). Actually for headers `add_crc2` writes positions 67 and 68 unconditionally — the length of the header line is always 69 for code lines, but for header/footer the placement differs. **Need to verify via sample on implementation.**

**Extended filename line** (part 1 only, when `_extended=='*'`):
```
/<origname>//////////////////////////////////////////////\xb0\xb1\xb2*<mcrc><crc2>
```
Total 69 chars. Actual template: 52 `/` chars, origname overwrites starting at offset 1. Suffix `\xb0\xb1\xb2*` + 2 crc2 bytes.

**Blocksize sizing**: default block payload = 9940 bytes (160 code lines × 62 + 20, where 160 lines → 160 × 69 + overhead ≈ 9940). Actual reference picks blocklines = ceil(blocksize/62). Auto-split triggers to keep each part ≤ ~10KB.

## Tech stack

- Vite + TypeScript, no framework (plain DOM).
- Vitest for tests.
- No runtime deps. Inline store-only (compression method 0) zip writer for downloads.
- Build output: static HTML/JS/CSS — hostable anywhere or opened from `file://`.
- Core lib is pure (`Uint8Array` in/out), works in browser + Node + Worker.

## File layout

```
/home/tf/src/7plus-browser/
  PLAN.md              (this file — live progress tracker)
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.ts            (UI glue)
    ui.css
    sevenplus/
      tables.ts        (code[], decode[], crctab[])
      crc.ts           (crc_calc, mcrc, add_crc2, crc_n_lnum)
      encode.ts        (encodeFile -> parts)
      decode.ts        (decodeParts -> original bytes)
      rebuild.ts       (single-char flip recovery for corrupt lines)
      format.ts        (header/footer builders, extended-filename line)
      index.ts         (public API)
    zip.ts             (store-only zip writer for multi-part downloads)
    worker.ts          (optional — run encode/decode off main thread)
  test/
    golden.test.ts     (byte-identical encode of sample.png, decode of parts)
    roundtrip.test.ts  (property test: random bytes → encode → decode)
    fixtures/          (symlink or copy of sample-data)
  sample-data/         (existing)
  7pl221en/            (existing — reference binary)
```

## Public API (draft)

```ts
export interface EncodeOptions {
  filename: string;            // original filename, e.g. "sample.png"
  blocksize?: number;          // 0 = single part; else bytes-per-part payload target
  timestamp?: number;          // unix seconds; used in stop line (reproducible output)
  lineSep?: '\r\n' | '\n' | '\r'; // default '\r\n'
  extendedName?: boolean;      // force long-filename line; auto if name > 8.3
  topTemplate?: string;        // optional template w/ %o %p %q %P %Q placeholders
  bottomTemplate?: string;
}
export interface EncodedPart { name: string; data: Uint8Array; }
export function encodeFile(data: Uint8Array, opts: EncodeOptions): EncodedPart[];

export interface DecodeInputPart { name: string; data: Uint8Array; }
export interface DecodeResult {
  filename: string;            // recovered original name (full_name if extended)
  data: Uint8Array;            // decoded bytes (length = filesize from header)
  timestamp: number | null;    // unix seconds from footer
  stats: { totalLines: number; rebuilt: number; corrupted: number; };
}
export function decodeParts(parts: DecodeInputPart[]): DecodeResult;
```

## Tests

Golden (byte-identical where possible):
1. `encodeFile(sampleBytes, {filename:'sample.png', timestamp: <from footer>})` → 19 parts whose bytes equal `sample.pNN`. The `stop_7+.` line contains the timestamp, so we extract the timestamp from the reference `sample.p13` footer and pass it in.
2. `decodeParts([sample.p01 ... sample.p13])` → bytes equal `sample.png`.
3. Header mcrc/crc2 values on first code line of sample.p01 match our implementation.

Roundtrip (random):
4. For N random `Uint8Array` payloads of varying sizes (including sizes where `filesize % 62 == 0` and `!= 0`), encode → decode → equal.

Negative:
5. Corrupt a single char in a code line; decoder flags it as corrupted but recovers via rebuild (or reports it).
6. Missing part in the middle → decoder reports which lines are missing; does not crash.

## Progress tracker

Tick items as complete. Resume from the first unchecked.

### Phase 0 — scaffold
- [x] Explore reference source, identify format fundamentals
- [x] Verify byte-identical output is possible from reference binary (confirmed: parts match up to the timestamped stop line)
- [x] `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html` skeleton
- [x] Install deps (node via nvm → ~/.nvm, symlinked into ~/.local/bin; vite/typescript/vitest via npm)

**Shell note**: `node`/`npm` are nvm-managed. A `~/.local/bin/node` symlink keeps them on the default PATH. Sanity check: `node -v` → v22.22.2.

### Phase 1 — core tables + CRC
- [x] `tables.ts` — `code[216]`, `decode[256]`, `crctab[256]` (computed at module load)
- [x] `crc.ts` — `crcStep`, `mcrc`, `addCrc2`, `crcAndLinenum`, `codeLineCrc14`, `verifyCrc2`
- [x] Unit test: alphabet round-trip
- [x] Golden test against sample.p01 (header/extended/footer mcrc + 138 code-line crc14 + crc2 round-trip for all line types)

**Key discovery**: `add_crc2` iterates bytes **in reverse** (`for i=66..0`). Forward iteration produces wrong CRC. All 69-byte line types share the same layout: crc2 at positions 67..68.

### Phase 2 — encoder
- [x] `format.ts` — header / extended-filename / code / footer builders (all 69 bytes)
- [x] `encode.ts` — main loop: splits input, produces N EncodedParts
- [x] Golden test: all 19 parts of `sample-data/sample.p01..p13` match byte-for-byte (timestamp extracted from reference footer)

**Key facts pinned down**:
- Default blocksize = `138 * 62 = 8556` bytes (not 9940; that's the *file* size with metadata overhead).
- `_extended` defaults to `'*'` on LFN builds → extended-filename line is always emitted in part 1.
- Header `%04X` blocksize field is per-part: uses `linesInPart * 64` (shrinks on the final part); the `%03X` blocklines field stays at the full value.

### Phase 3 — decoder
- [x] `decode.ts` — parse header, validate CRCs, decode code lines to 62 bytes, reassemble
- [x] Line-separator auto-detect (splitLines accepts LF/CRLF/CR per-line)
- [x] Golden test: decode sample-data/* → bytes equal sample.png
- [x] Handle missing lines (fill with zeros, record in stats.missing)
- [x] Handle out-of-order parts (indexed by header part number)
- [x] Random-payload roundtrip test across sizes 1..159295 including boundaries

**Key fix**: BigInt shifts don't truncate like C 32-bit ulong — must `& 0xFFFFFFFFn` after each `<<`. And the j=7 branch emits 3 bytes (shifts 24, 16, 8), not 1.

### Phase 4 — rebuild (line recovery)
- [ ] Port `rebuild.c` — try flipping each char through the 216-value alphabet to find a CRC match
- [ ] Test: corrupt one char, verify recovery

### Phase 5 — UI
- [x] `index.html` + `ui.css` — two drop zones, file list, stats panel
- [x] `main.ts` — wire up drag-drop, show progress, trigger downloads
- [x] Multi-part download: store-only zip via `zip.ts` (test verifies python zipfile reads it back)
- [x] Single-part download: direct blob
- [x] Manual browser smoke test (encode → download → decode round-trip in a browser)
- [x] Cross-check: decode parts produced by reference `7plus.exe` in the browser

### Phase 6 — polish
- [ ] Optional Web Worker for large files
- [ ] Line separator toggle (CRLF vs CR for packet mode)
- [ ] Timestamp input override (default: now)
- [ ] Extended-filename toggle
- [ ] README with usage

### Deferred (post-v1)
- Correction files (`.err` → `.cor` flow)
- Joining `.upl` output
- Extract mode (pull 7plus files out of a log)
- Format templates (`.def` top/bottom)
- Rebuild mode from `.7mf`/`.7ix`

## Notes & gotchas

- **Timestamp format** in footer is `[%lX]` — hex of unix seconds. Different mtimes produce different footer bytes + footer crc. Encoder must accept a timestamp parameter to produce reproducible output (and tests use the timestamp extracted from the reference `sample.p13`).
- **`\xb0\xb1\xb2` sentinel** in header/footer is **literal bytes**, not UTF-8. File is raw 8-bit ASCII+extended-latin.
- **Line separator** in reference files: sample data uses CRLF (Windows binary). Decoder must handle any of LF/CRLF/CR (reference's `my_fgets` does).
- **`\xb0\xb1\xb2\xdb`** in footer — last `\xdb` is literally `\xdb` (mcrc is written at pos+3 which is `\xdb` position? re-check). Actually `\xb0\xb1\xb2\xdb` — the mcrc scanner looks for `\xb0\xb1`, writes mcrc at pos+3 which is `\xdb`'s position. So `\xdb` is a placeholder that gets overwritten by mcrc. Footer format is ` stop_7+. (NAME.PXX/YY) [TS]          \xb0\xb1\xb2` + mcrc byte + 2 crc2 bytes. **Verify on implementation.**
- Sample part files are 9940 bytes except p01 (10011, contains the extended filename line, so +71 chars = +69+CRLF) and p13 (6248, shorter final part).
- Header field `blocksize` is encoded as `(blocklines * 64) & 0xffff` in hex (%04X). For sample: blocklines=0x8A=138, 138*64=8832=0x2280. ✓

## How to resume

1. Read this file top-to-bottom.
2. Find the first unchecked `[ ]` under "Progress tracker".
3. If the previous phase's tests are green, pick up there.
4. Reference source: `/home/tf/src/7plus/{encode.c,decode.c,utils.c,rebuild.c,7plus.h}`.
5. Golden data: `/home/tf/src/7plus-browser/sample-data/sample.png` + `sample.p01`..`sample.p13`.
6. Reference binary to re-run for comparison: `/home/tf/src/7plus-browser/7pl221en/7plus.exe` (runs under WSL).
