import { encodeFile, type EncodeOptions, type EncodedPart, type LineSep } from './sevenplus/encode.js';
import { decodeParts, type DecodeInputPart } from './sevenplus/decode.js';
import { buildStoredZip } from './zip.js';

const previewUrls: string[] = [];

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

setupEncode();
setupDecode();

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
    status.textContent = `Decoding ${files.length} part${files.length === 1 ? '' : 's'}…`;
    try {
      const inputs: DecodeInputPart[] = await Promise.all(
        files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
      );
      const result = decodeParts(inputs);
      const previewed = renderPreview(result.filename, result.data);
      if (!previewed) downloadBlob(result.filename, result.data);
      const ts = result.timestamp != null ? new Date(result.timestamp * 1000).toISOString() : 'none';
      const parts = [
        `Recovered ${result.filename} (${result.data.length} bytes)`,
        `Lines: ${result.stats.totalCodeLines}  corrupted: ${result.stats.corrupted}  missing: ${result.stats.missing}`,
        `Timestamp: ${ts}`,
        previewed ? 'Previewed inline (right-click → Save As to download).' : '',
      ].filter(Boolean);
      status.textContent = parts.join('\n');
    } catch (err) {
      showError(status, err);
    }
  });
}

/** Returns true if we rendered an inline preview (and skipped the download). */
function renderPreview(filename: string, data: Uint8Array): boolean {
  const pane = $('decode-preview');
  // Clear any prior preview and revoke its object URL so we don't leak memory.
  pane.replaceChildren();
  for (const url of previewUrls.splice(0)) URL.revokeObjectURL(url);

  const mime = imageMime(filename, data);
  if (!mime) {
    pane.hidden = true;
    return false;
  }
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  previewUrls.push(url);
  const img = document.createElement('img');
  img.src = url;
  img.alt = filename;
  pane.appendChild(img);
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
