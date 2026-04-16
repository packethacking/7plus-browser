// Radix-216 alphabet and CRC table, built at module load to match the
// reference C code in utils.c (init_codetab, init_decodetab, init_crctab).

// code[0..215] -> byte value written to file
export const code = new Uint8Array(216);
// decode[byte] -> 0..215, or 255 if not a valid code byte
export const decodeTab = new Uint8Array(256);
// 16-bit CRC table (DC4OX; same polynomial as CCITT-16)
export const crctab = new Uint16Array(256);

(function initCode() {
  let j = 0;
  for (let i = 0x21; i < 0x2a; i++) code[j++] = i;   // 9
  for (let i = 0x2b; i < 0x7f; i++) code[j++] = i;   // 84
  for (let i = 0x80; i < 0x91; i++) code[j++] = i;   // 17
  code[j++] = 0x92;                                  // 1
  for (let i = 0x94; i < 0xfd; i++) code[j++] = i;   // 105
  // total = 9 + 84 + 17 + 1 + 105 = 216
  if (j !== 216) throw new Error(`code table length ${j} != 216`);
})();

(function initDecode() {
  decodeTab.fill(255);
  let j = 0;
  for (let i = 0x21; i < 0x2a; i++) decodeTab[i] = j++;
  for (let i = 0x2b; i < 0x7f; i++) decodeTab[i] = j++;
  for (let i = 0x80; i < 0x91; i++) decodeTab[i] = j++;
  decodeTab[0x92] = j++;
  for (let i = 0x94; i < 0xfd; i++) decodeTab[i] = j++;
})();

(function initCrc() {
  // Per-bit remainders (from utils.c init_crctab).
  const bitrmdrs = [0x9188, 0x48c4, 0x2462, 0x1231, 0x8108, 0x4084, 0x2042, 0x1021];
  for (let n = 0; n < 256; n++) {
    let r = 0;
    let mask = 0x80;
    for (let m = 0; m < 8; m++, mask >>= 1) {
      if (n & mask) r ^= bitrmdrs[m]!;
    }
    crctab[n] = r & 0xffff;
  }
})();
