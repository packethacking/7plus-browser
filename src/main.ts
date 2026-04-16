import { encodeFile, type EncodedPart } from './sevenplus/encode.js';
import { decodeParts, type DecodeInputPart } from './sevenplus/decode.js';
import { buildStoredZip } from './zip.js';

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
      const parts = encodeFile(data, { filename: file.name });
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
      downloadBlob(result.filename, result.data);
      const ts = result.timestamp != null ? new Date(result.timestamp * 1000).toISOString() : 'none';
      const parts = [
        `Recovered ${result.filename} (${result.data.length} bytes)`,
        `Lines: ${result.stats.totalCodeLines}  corrupted: ${result.stats.corrupted}  missing: ${result.stats.missing}`,
        `Timestamp: ${ts}`,
      ];
      status.textContent = parts.join('\n');
    } catch (err) {
      showError(status, err);
    }
  });
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

function showError(status: HTMLElement, err: unknown): void {
  status.className = 'status err';
  status.textContent = err instanceof Error ? err.message : String(err);
}
