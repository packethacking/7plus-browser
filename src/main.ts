import { encodeFile, type EncodeOptions, type EncodedPart, type LineSep } from './sevenplus/encode.js';
import { decodeParts, extractParts, type DecodeInputPart } from './sevenplus/decode.js';
import { buildStoredZip } from './zip.js';

const previewUrls: string[] = [];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

setupEncode();
setupDecode();
setupPaste();

function setupEncode(): void {
  const drop = $('encode-drop');
  const input = $<HTMLInputElement>('encode-input');
  const status = $('encode-status');

  wireDropZone(drop, input, async (files) => {
    if (files.length === 0) return;
    if (files.length > 1) {
      showError(status, 'Drop a single file to encode.');
      return;
    }
    const file = files[0]!;
    status.className = 'status';
    status.textContent = `Encoding ${file.name} (${file.size} bytes)…`;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const opts: EncodeOptions = { filename: file.name, lineSep: readLineSep(), ...readAdvancedOpts() };
      const parts = encodeFile(data, opts);
      deliverEncoded(file.name, parts);
      status.textContent = summarizeEncode(file.name, parts);
    } catch (err) {
      showError(status, err);
    }
  });
}

function setupDecode(): void {
  const drop = $('decode-drop');
  const input = $<HTMLInputElement>('decode-input');
  const status = $('decode-status');

  wireDropZone(drop, input, async (files) => {
    if (files.length === 0) return;
    status.className = 'status';
    status.textContent = `Scanning ${files.length} file${files.length === 1 ? '' : 's'}…`;
    try {
      let added = 0, dupes = 0, total = 0;
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const r = absorbBytes(bytes);
        added += r.added; dupes += r.dupes; total += r.total;
      }
      if (total === 0) {
        showError(status, 'No 7PLUS parts found in the dropped file(s).');
        return;
      }
      renderPasteStatus(status, { added, dupes });
    } catch (err) {
      showError(status, err);
    }
  });
}

/**
 * Accumulates parts scanned across multiple pastes, keyed by filename→part#.
 * A fresh paste adds to this; the Reset button clears it.
 */
const pasteBuckets = new Map<string, Map<number, { total: number; data: Uint8Array }>>();

function setupPaste(): void {
  const textarea = $<HTMLTextAreaElement>('paste-input');
  const scan = $<HTMLButtonElement>('paste-scan');
  const reset = $<HTMLButtonElement>('paste-reset');
  const status = $('paste-status');

  scan.addEventListener('click', () => {
    const txt = textarea.value;
    if (!txt.trim()) {
      showError(status, 'Paste some mail text first.');
      return;
    }
    try {
      const added = absorbBytes(latin1ToBytes(txt));
      if (added.total === 0) {
        showError(status, 'No 7plus parts found in the pasted text.');
        return;
      }
      textarea.value = '';
      renderPasteStatus(status, added);
    } catch (err) {
      showError(status, err);
    }
  });

  reset.addEventListener('click', () => {
    pasteBuckets.clear();
    textarea.value = '';
    status.className = 'status';
    status.textContent = '';
  });
}

/**
 * Run extractParts over a raw byte blob and merge any new parts into the
 * shared pasteBuckets. Returns the count of parts actually added and of
 * duplicates we already had.
 */
function absorbBytes(bytes: Uint8Array): { added: number; dupes: number; total: number } {
  const found = extractParts(bytes);
  let added = 0, dupes = 0;
  for (const p of found) {
    let bucket = pasteBuckets.get(p.filename);
    if (!bucket) { bucket = new Map(); pasteBuckets.set(p.filename, bucket); }
    if (bucket.has(p.part)) { dupes++; continue; }
    bucket.set(p.part, { total: p.parts, data: p.data });
    added++;
  }
  return { added, dupes, total: found.length };
}

function renderPasteStatus(status: HTMLElement, summary: { added: number; dupes: number }): void {
  status.className = 'status';
  status.replaceChildren();

  const header = document.createElement('div');
  header.textContent = `Scanned: +${summary.added} new part${summary.added === 1 ? '' : 's'}${summary.dupes ? `, ${summary.dupes} duplicate` : ''}`;
  status.appendChild(header);

  const completed: string[] = [];
  for (const [name, bucket] of pasteBuckets) {
    const first = bucket.values().next().value;
    const total = first?.total ?? 0;
    const have = [...bucket.keys()].sort((a, b) => a - b);
    const missing: number[] = [];
    for (let p = 1; p <= total; p++) if (!bucket.has(p)) missing.push(p);

    const row = document.createElement('div');
    row.className = 'paste-row';
    if (missing.length === 0 && total > 0) {
      completed.push(name);
      row.textContent = `  ✓ ${name} — all ${total} parts, decoding…`;
      // Snapshot parts now so the button still works after we delete the
      // bucket below (post-decode).
      const snap: [number, Uint8Array][] = [...bucket.entries()].map(([p, v]) => [p, v.data]);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'partial-btn';
      btn.textContent = 'Download all parts';
      btn.addEventListener('click', () => downloadAllPartsZip(name, total, snap));
      row.appendChild(btn);
    } else {
      row.textContent = `  ${name} — ${have.length}/${total}, missing: ${formatRanges(missing)}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'partial-btn';
      btn.textContent = 'Download partial ZIP';
      btn.addEventListener('click', () => downloadPartialZip(name));
      row.appendChild(btn);
    }
    status.appendChild(row);
  }

  // Decode each completed file, then remove from bucket so we don't re-decode.
  // Clear the preview pane once so multiple image results can stack up.
  if (completed.length > 0) clearPreview();
  for (const name of completed) {
    const bucket = pasteBuckets.get(name)!;
    const inputs: DecodeInputPart[] = [...bucket.entries()]
      .sort(([a], [b]) => a - b)
      .map(([part, v]) => ({ name: `${name}.p${toHex2(part)}`, data: v.data }));
    const resultLine = document.createElement('div');
    try {
      const result = decodeParts(inputs);
      const previewed = appendPreview(result.filename, result.data);
      if (!previewed) downloadBlob(result.filename, result.data);
      resultLine.textContent = `    → ${result.filename} (${result.data.length} bytes)${previewed ? ' previewed below' : ' downloaded'}`;
    } catch (err) {
      resultLine.textContent = `    ! ${name}: ${err instanceof Error ? err.message : String(err)}`;
    }
    status.appendChild(resultLine);
    pasteBuckets.delete(name);
  }
}

/**
 * Bundle the parts we've collected so far for a given filename into a ZIP,
 * alongside a README.txt explaining which parts are missing. Useful when a
 * single paste only carries a subset and the user wants to save progress
 * (or hand the partial set off to someone else to fill in the gaps).
 */
/**
 * Bundle a complete set of parts for a given filename into a ZIP. Offered as
 * a convenience for users who want to re-send the full .pXX set to someone
 * else without having to re-scan or re-encode.
 */
function downloadAllPartsZip(filename: string, total: number, parts: [number, Uint8Array][]): void {
  const baseName = filename.replace(/\.[^.]*$/, '') || filename;
  const entries = [...parts]
    .sort(([a], [b]) => a - b)
    .map(([p, data]) => ({ name: `${baseName}.p${toHex2(p)}`, data }));
  const readme =
    `Complete 7PLUS parts for ${filename}\n` +
    `\n` +
    `Total parts: ${total}\n` +
    `\n` +
    `Drop all .p?? files into the decoder together to rebuild ${filename}.\n`;
  entries.push({ name: 'README.txt', data: new TextEncoder().encode(readme) });
  const zip = buildStoredZip(entries);
  downloadBlob(`${baseName}-parts.zip`, zip);
}

function downloadPartialZip(filename: string): void {
  const bucket = pasteBuckets.get(filename);
  if (!bucket) return;
  const first = bucket.values().next().value;
  const total = first?.total ?? 0;
  const present = [...bucket.keys()].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let p = 1; p <= total; p++) if (!bucket.has(p)) missing.push(p);

  const baseName = filename.replace(/\.[^.]*$/, '') || filename;
  const entries = present.map((p) => ({
    name: `${baseName}.p${toHex2(p)}`,
    data: bucket.get(p)!.data,
  }));
  const readme =
    `Partial 7PLUS parts for ${filename}\n` +
    `\n` +
    `Total parts expected: ${total}\n` +
    `Parts present (${present.length}): ${formatRanges(present)}\n` +
    `Parts missing (${missing.length}): ${formatRanges(missing)}\n` +
    `\n` +
    `To finish decoding this file you still need parts ${formatRanges(missing)}.\n` +
    `Drop all .p?? files into the decoder together once you have the full set.\n`;
  entries.push({ name: 'README.txt', data: new TextEncoder().encode(readme) });

  const zip = buildStoredZip(entries);
  downloadBlob(`${baseName}-partial.zip`, zip);
}

function toHex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

/** Render a missing-parts list as compact ranges, e.g. [1,2,3,5,7,8] → "1-3, 5, 7-8". */
function formatRanges(nums: number[]): string {
  if (nums.length === 0) return 'none';
  const parts: string[] = [];
  let lo = nums[0]!, hi = lo;
  for (let i = 1; i < nums.length; i++) {
    const n = nums[i]!;
    if (n === hi + 1) { hi = n; continue; }
    parts.push(lo === hi ? `${lo}` : `${lo}-${hi}`);
    lo = hi = n;
  }
  parts.push(lo === hi ? `${lo}` : `${lo}-${hi}`);
  return parts.join(', ');
}

/**
 * Convert a string to bytes using Latin-1 (codepoint ≤ 255 → one byte).
 * 7PLUS uses raw bytes including 0xb0/0xb1/0xb2 sentinel markers; UTF-8
 * decoding would replace those with U+FFFD. We require the paste to have
 * preserved the original bytes (most terminals/clients do this when the
 * source was served as ISO-8859-1, which is the packet-radio norm).
 */
function latin1ToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[i] = c > 0xff ? 0x3f : c; // '?' for anything that won't fit
  }
  return out;
}

/** Returns true if we rendered an inline preview (and skipped the download). */
function renderPreview(filename: string, data: Uint8Array): boolean {
  clearPreview();
  return appendPreview(filename, data);
}

function clearPreview(): void {
  const pane = $('decode-preview');
  pane.replaceChildren();
  for (const url of previewUrls.splice(0)) URL.revokeObjectURL(url);
  pane.hidden = true;
}

/** Append an image to the preview pane without clearing earlier previews. */
function appendPreview(filename: string, data: Uint8Array): boolean {
  const pane = $('decode-preview');
  const mime = imageMime(filename, data);
  if (!mime) return false;
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  previewUrls.push(url);
  const fig = document.createElement('figure');
  fig.className = 'preview-item';
  const caption = document.createElement('figcaption');
  caption.textContent = filename;
  const img = document.createElement('img');
  img.src = url;
  img.alt = filename;
  fig.appendChild(caption);
  fig.appendChild(img);
  pane.appendChild(fig);
  pane.hidden = false;
  return true;
}

/**
 * Identify an image MIME type by magic bytes (primary) or extension (fallback).
 * Returns null for anything we won't try to preview inline.
 */
function imageMime(filename: string, data: Uint8Array): string | null {
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif';
  if (
    data.length >= 12 && data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46 &&
    data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return 'image/webp';
  // SVG — text-based, check the root element.
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'svg') return 'image/svg+xml';
  return null;
}

function wireDropZone(
  zone: HTMLElement,
  input: HTMLInputElement,
  handle: (files: File[]) => void,
): void {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
    handle(files);
  });
  input.addEventListener('change', () => {
    const files = input.files ? Array.from(input.files) : [];
    handle(files);
    input.value = '';
  });
}

function deliverEncoded(origName: string, parts: EncodedPart[]): void {
  if (parts.length === 1) {
    downloadBlob(parts[0]!.name, parts[0]!.data);
    return;
  }
  const zip = buildStoredZip(parts.map((p) => ({ name: p.name, data: p.data })));
  const stem = origName.replace(/\.[^.]*$/, '') || '7plus';
  downloadBlob(`${stem}.7plus.zip`, zip);
}

function summarizeEncode(origName: string, parts: EncodedPart[]): string {
  const total = parts.reduce((n, p) => n + p.data.length, 0);
  const names = parts.map((p) => p.name).join(', ');
  return [
    `Encoded ${origName} → ${parts.length} part${parts.length === 1 ? '' : 's'} (${total} bytes)`,
    names,
  ].join('\n');
}

function downloadBlob(filename: string, data: Uint8Array): void {
  // Copy into a fresh ArrayBuffer so the Blob constructor's DOM typings are happy
  // (Uint8Array<ArrayBufferLike> isn't assignable to BlobPart in TS 5.7+).
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readAdvancedOpts(): Partial<EncodeOptions> {
  const bytes = $<HTMLInputElement>('opt-bytes').valueAsNumber;
  const partCountRaw = $<HTMLInputElement>('opt-parts').valueAsNumber;
  const terminator = $<HTMLInputElement>('opt-terminator').value.trim();
  const onlyRaw = $<HTMLInputElement>('opt-only').value.trim();

  const out: Partial<EncodeOptions> = {};
  if (Number.isFinite(partCountRaw) && partCountRaw > 0) out.partCount = partCountRaw;
  else if (Number.isFinite(bytes) && bytes > 0) out.blocksize = bytes;
  if (terminator) out.terminator = terminator;
  if (onlyRaw) out.onlyParts = parsePartRanges(onlyRaw);
  return out;
}

/** Parse a range spec like "1,5-7,10" into an array of part numbers. */
function parsePartRanges(spec: string): number[] {
  const out = new Set<number>();
  for (const tok of spec.split(',')) {
    const t = tok.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) throw new Error(`bad part range: "${t}" (use e.g. "1,5-7")`);
    const lo = parseInt(m[1]!, 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    if (lo < 1 || hi < lo) throw new Error(`bad part range: "${t}"`);
    for (let n = lo; n <= hi; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

function readLineSep(): LineSep {
  const picked = document.querySelector<HTMLInputElement>('input[name="linesep"]:checked');
  switch (picked?.value) {
    case 'cr': return '\r';
    case 'lf': return '\n';
    default: return '\r\n';
  }
}

function showError(status: HTMLElement, err: unknown): void {
  status.className = 'status err';
  status.textContent = err instanceof Error ? err.message : String(err);
}
