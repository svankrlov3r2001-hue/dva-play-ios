/**
 * Lightweight pure-TypeScript QR Code matrix generator (ISO/IEC 18004, Byte mode, ECC Level M, Versions 1..8).
 * Produces an N x N boolean matrix (true = dark module) with zero native dependencies.
 */

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data: number[], ecLen: number): number[] {
  const gen = rsGeneratorPoly(ecLen);
  const res = new Array<number>(data.length + ecLen).fill(0);
  for (let i = 0; i < data.length; i++) res[i] = data[i];
  for (let i = 0; i < data.length; i++) {
    const coef = res[i];
    if (coef !== 0) {
      for (let j = 1; j < gen.length; j++) {
        res[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return res.slice(data.length);
}

// Level M specs for Versions 1..8: [totalDataCodewords, ecPerBlock, g1Blocks, g1Data, g2Blocks, g2Data, alignCenters]
interface VersionSpec {
  version: number;
  dataCodewords: number;
  ecPerBlock: number;
  blocks: [number, number][];
  align: number[];
}

const VERSION_SPECS_M: VersionSpec[] = [
  { version: 1, dataCodewords: 16, ecPerBlock: 10, blocks: [[1, 16]], align: [] },
  { version: 2, dataCodewords: 28, ecPerBlock: 16, blocks: [[1, 28]], align: [6, 18] },
  { version: 3, dataCodewords: 44, ecPerBlock: 26, blocks: [[1, 44]], align: [6, 22] },
  { version: 4, dataCodewords: 64, ecPerBlock: 18, blocks: [[2, 32]], align: [6, 26] },
  { version: 5, dataCodewords: 86, ecPerBlock: 24, blocks: [[2, 43]], align: [6, 30] },
  { version: 6, dataCodewords: 108, ecPerBlock: 16, blocks: [[4, 27]], align: [6, 34] },
  { version: 7, dataCodewords: 124, ecPerBlock: 18, blocks: [[4, 31]], align: [6, 22, 38] },
  { version: 8, dataCodewords: 154, ecPerBlock: 22, blocks: [[2, 38], [2, 39]], align: [6, 24, 42] },
];

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);
    if (code < 0x80) {
      out.push(code);
    } else if (code < 0x800) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(++i);
      const cp = 0x10000 + (((code & 0x3ff) << 10) | (next & 0x3ff));
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    } else {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return out;
}

function bchFormatInfo(maskPattern: number): number {
  // ECC Level M = 00
  const data = (0b00 << 3) | (maskPattern & 7);
  let d = data << 10;
  const poly = 0b10100110111;
  while (bitLength(d) >= 11) {
    d ^= poly << (bitLength(d) - 11);
  }
  return ((data << 10) | d) ^ 0b101010000010010;
}

function bchVersionInfo(version: number): number {
  let d = version << 12;
  const poly = 0b1111100100101;
  while (bitLength(d) >= 13) {
    d ^= poly << (bitLength(d) - 13);
  }
  return (version << 12) | d;
}

function bitLength(n: number): number {
  let len = 0;
  let v = n;
  while (v > 0) {
    len++;
    v >>>= 1;
  }
  return len;
}

function evaluatePenalty(mat: boolean[][]): number {
  const n = mat.length;
  let score = 0;

  // Rule 1: runs of 5+ same-color modules
  for (let r = 0; r < n; r++) {
    let run = 1;
    for (let c = 1; c < n; c++) {
      if (mat[r][c] === mat[r][c - 1]) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }
  for (let c = 0; c < n; c++) {
    let run = 1;
    for (let r = 1; r < n; r++) {
      if (mat[r][c] === mat[r - 1][c]) {
        run++;
      } else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    if (run >= 5) score += 3 + (run - 5);
  }

  // Rule 2: 2x2 blocks
  for (let r = 0; r < n - 1; r++) {
    for (let c = 0; c < n - 1; c++) {
      const v = mat[r][c];
      if (v === mat[r][c + 1] && v === mat[r + 1][c] && v === mat[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 4: dark ratio
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (mat[r][c]) dark++;
    }
  }
  const pct = (dark * 100) / (n * n);
  const k = Math.floor(Math.abs(pct - 50) / 5);
  score += k * 10;

  return score;
}

function maskCondition(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
  }
}

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = utf8Bytes(text);
  const spec = VERSION_SPECS_M.find((s) => bytes.length + 2 <= s.dataCodewords);
  if (!spec) {
    throw new Error('QR payload exceeds supported length');
  }

  // Build bit stream: Byte mode (0100) + 8-bit length + payload + terminator
  const bits: number[] = [];
  const pushBits = (val: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) pushBits(b, 8);

  const maxDataBits = spec.dataCodewords * 8;
  const term = Math.min(4, maxDataBits - bits.length);
  for (let i = 0; i < term; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8; j++) val = (val << 1) | bits[i + j];
    dataBytes.push(val);
  }
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataBytes.length < spec.dataCodewords) {
    dataBytes.push(padBytes[padIdx++ % 2]);
  }

  // Split into blocks & interleave data + ECC
  const dataBlocks: number[][] = [];
  const eccBlocks: number[][] = [];
  let offset = 0;
  for (const [count, len] of spec.blocks) {
    for (let b = 0; b < count; b++) {
      const slice = dataBytes.slice(offset, offset + len);
      offset += len;
      dataBlocks.push(slice);
      eccBlocks.push(rsComputeEcc(slice, spec.ecPerBlock));
    }
  }

  const finalBytes: number[] = [];
  const maxDataBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxDataBlockLen; i++) {
    for (const blk of dataBlocks) {
      if (i < blk.length) finalBytes.push(blk[i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (const blk of eccBlocks) {
      if (i < blk.length) finalBytes.push(blk[i]);
    }
  }

  const finalBits: number[] = [];
  for (const b of finalBytes) {
    for (let i = 7; i >= 0; i--) finalBits.push((b >> i) & 1);
  }

  const size = 17 + spec.version * 4;
  const baseMat: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array<boolean | null>(size).fill(null)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false)
  );

  const setFixed = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    baseMat[r][c] = dark;
    reserved[r][c] = true;
  };

  const placeFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
          setFixed(r, c, false);
        } else {
          const isBorder = dr === 0 || dr === 6 || dc === 0 || dc === 6;
          const isCenter = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
          setFixed(r, c, isBorder || isCenter);
        }
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns
  const centers = spec.align;
  for (const ar of centers) {
    for (const ac of centers) {
      if (reserved[ar][ac]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isEdge = Math.abs(dr) === 2 || Math.abs(dc) === 2;
          const isCenter = dr === 0 && dc === 0;
          setFixed(ar + dr, ac + dc, isEdge || isCenter);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0;
    if (!reserved[6][i]) setFixed(6, i, dark);
    if (!reserved[i][6]) setFixed(i, 6, dark);
  }

  // Dark module
  setFixed(4 * spec.version + 9, 8, true);

  // Reserve format info cells
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      reserved[8][i] = true;
      reserved[i][8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
  }
  for (let i = 0; i < 7; i++) {
    reserved[size - 1 - i][8] = true;
  }

  // Version info for V7+
  if (spec.version >= 7) {
    const vInfo = bchVersionInfo(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vInfo >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      setFixed(a, b, bit);
      setFixed(b, a, bit);
    }
  }

  // Place data bits in zig-zag
  let bitIdx = 0;
  let dirUp = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let step = 0; step < size; step++) {
      const r = dirUp ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = col - dc;
        if (!reserved[r][c]) {
          baseMat[r][c] = bitIdx < finalBits.length ? finalBits[bitIdx] === 1 : false;
          bitIdx++;
        }
      }
    }
    dirUp = !dirUp;
  }

  // Try all 8 masks and pick lowest penalty
  let bestMat: boolean[][] | null = null;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate: boolean[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => {
        const val = Boolean(baseMat[r][c]);
        if (reserved[r][c]) return val;
        return maskCondition(mask, r, c) ? !val : val;
      })
    );

    const fmt = bchFormatInfo(mask);
    // Horizontal format strip
    for (let i = 0; i < 6; i++) candidate[8][i] = ((fmt >> (14 - i)) & 1) === 1;
    candidate[8][7] = ((fmt >> 8) & 1) === 1;
    candidate[8][8] = ((fmt >> 7) & 1) === 1;
    candidate[7][8] = ((fmt >> 6) & 1) === 1;
    for (let i = 0; i < 6; i++) candidate[5 - i][8] = ((fmt >> (5 - i)) & 1) === 1;

    // Vertical + right format strip
    for (let i = 0; i < 7; i++) candidate[size - 1 - i][8] = ((fmt >> (14 - i)) & 1) === 1;
    for (let i = 0; i < 8; i++) candidate[8][size - 8 + i] = ((fmt >> (7 - i)) & 1) === 1;

    const score = evaluatePenalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      bestMat = candidate;
    }
  }

  return bestMat || (baseMat as boolean[][]);
}
