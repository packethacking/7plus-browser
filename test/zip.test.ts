import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { buildStoredZip } from '../src/zip.js';

describe('buildStoredZip', () => {
  it('produces a ZIP that python zipfile can read back byte-identical', () => {
    const entries = [
      { name: 'hello.txt', data: new TextEncoder().encode('hello world\n') },
      { name: 'empty.bin', data: new Uint8Array(0) },
      { name: 'binary.dat', data: Uint8Array.from({ length: 1024 }, (_, i) => (i * 37 + 5) & 0xff) },
    ];
    const zip = buildStoredZip(entries);

    const dir = mkdtempSync(join(tmpdir(), 'zip-test-'));
    try {
      const path = join(dir, 'out.zip');
      writeFileSync(path, zip);
      const script = `
import json, sys, zipfile
out = {}
with zipfile.ZipFile(sys.argv[1]) as z:
    for info in z.infolist():
        out[info.filename] = list(z.read(info.filename))
print(json.dumps(out))
`;
      const stdout = execFileSync('python3', ['-c', script, path], { encoding: 'utf8' });
      const parsed = JSON.parse(stdout) as Record<string, number[]>;
      expect(Object.keys(parsed).sort()).toEqual(entries.map((e) => e.name).sort());
      for (const e of entries) {
        expect(parsed[e.name]).toEqual(Array.from(e.data));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
