import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RAW_DIR = path.resolve('.raw_textures');
const OUT_DIR = path.resolve('public/textures/pbr');
fs.mkdirSync(OUT_DIR, { recursive: true });

const MATERIALS = [
  { name: 'asphalt', normalStrength: 2.2, baseRough: 0.78, roughContrast: 0.25 },
  { name: 'cobblestone', normalStrength: 4.2, baseRough: 0.68, roughContrast: 0.35 },
  { name: 'stonewall', normalStrength: 4.5, baseRough: 0.76, roughContrast: 0.30 },
  { name: 'rooftiles', normalStrength: 4.8, baseRough: 0.62, roughContrast: 0.32 },
  { name: 'cliffrock', normalStrength: 5.0, baseRough: 0.82, roughContrast: 0.28 },
  { name: 'gravel', normalStrength: 3.4, baseRough: 0.86, roughContrast: 0.22 },
  { name: 'grass_lush', normalStrength: 2.0, baseRough: 0.84, roughContrast: 0.18 },
  { name: 'forest_floor', normalStrength: 3.0, baseRough: 0.88, roughContrast: 0.20 },
  { name: 'plaster', normalStrength: 1.8, baseRough: 0.74, roughContrast: 0.18 },
  { name: 'farmland', normalStrength: 2.4, baseRough: 0.85, roughContrast: 0.20 },
];

const SIZE = 1024;
const BLEND = 160; // Overlap margin for cosine seamless toroidal tiling

function makeSeamlessRGB(src, srcW, srcH, outSize, blend) {
  // Sample center crop of size (outSize + blend) and blend opposite borders toroidally
  const W = outSize;
  const out = Buffer.alloc(W * W * 3);

  // First compute coarse 8x8 illumination grid to flatten any macro gradient
  const GRID = 8;
  const cellLum = new Float32Array(GRID * GRID);
  const cellCnt = new Int32Array(GRID * GRID);
  let totalLum = 0;
  for (let y = 0; y < srcH; y += 2) {
    const gy = Math.min(GRID - 1, Math.floor((y / srcH) * GRID));
    for (let x = 0; x < srcW; x += 2) {
      const gx = Math.min(GRID - 1, Math.floor((x / srcW) * GRID));
      const idx = (y * srcW + x) * 3;
      const lum = 0.299 * src[idx] + 0.587 * src[idx + 1] + 0.114 * src[idx + 2];
      cellLum[gy * GRID + gx] += lum;
      cellCnt[gy * GRID + gx]++;
      totalLum += lum;
    }
  }
  const avgLum = totalLum / Math.max(1, (srcW / 2) * (srcH / 2));
  for (let i = 0; i < GRID * GRID; i++) {
    cellLum[i] = cellCnt[i] > 0 ? cellLum[i] / cellCnt[i] : avgLum;
  }

  const sampleFlattened = (u, v, ch) => {
    const px = Math.max(0, Math.min(srcW - 1, Math.floor(u * (srcW - 1))));
    const py = Math.max(0, Math.min(srcH - 1, Math.floor(v * (srcH - 1))));
    const gx = Math.min(GRID - 1.001, Math.max(0, u * (GRID - 1)));
    const gy = Math.min(GRID - 1.001, Math.max(0, v * (GRID - 1)));
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const x1 = Math.min(GRID - 1, x0 + 1), y1 = Math.min(GRID - 1, y0 + 1);
    const localLum =
      cellLum[y0 * GRID + x0] * (1 - fx) * (1 - fy) +
      cellLum[y0 * GRID + x1] * fx * (1 - fy) +
      cellLum[y1 * GRID + x0] * (1 - fx) * fy +
      cellLum[y1 * GRID + x1] * fx * fy;
    const scale = avgLum / Math.max(24, localLum);
    // Gentle 75% illumination equalization so macro shadows disappear
    const adj = 1.0 + (scale - 1.0) * 0.75;
    return Math.max(0, Math.min(255, src[(py * srcW + px) * 3 + ch] * adj));
  };

  // Dual-offset Wang/Quilez toroidal cross-blend
  for (let y = 0; y < W; y++) {
    const ty = y / W;
    // Smooth cosine weight 0 at border (0 or 1), 1 at center (0.5)
    const wy = 0.5 - 0.5 * Math.cos(2 * Math.PI * ty);
    for (let x = 0; x < W; x++) {
      const tx = x / W;
      const wx = 0.5 - 0.5 * Math.cos(2 * Math.PI * tx);

      const uA = 0.04 + tx * 0.92;
      const vA = 0.04 + ty * 0.92;
      const uB = 0.04 + ((tx + 0.5) % 1.0) * 0.92;
      const vB = 0.04 + ((ty + 0.5) % 1.0) * 0.92;

      const w00 = wx * wy;
      const w10 = (1 - wx) * wy;
      const w01 = wx * (1 - wy);
      const w11 = (1 - wx) * (1 - wy);
      // Variance-preserving blend reinforcement
      const oIdx = (y * W + x) * 3;
      for (let c = 0; c < 3; c++) {
        const s00 = sampleFlattened(uA, vA, c);
        const s10 = sampleFlattened(uB, vA, c);
        const s01 = sampleFlattened(uA, vB, c);
        const s11 = sampleFlattened(uB, vB, c);
        const val = s00 * w00 + s10 * w10 + s01 * w01 + s11 * w11;
        out[oIdx + c] = Math.max(0, Math.min(255, Math.round(val)));
      }
    }
  }
  return out;
}

function buildNormalAndRoughness(rgb, W, strength, baseRough, roughContrast) {
  const height = new Float32Array(W * W);
  for (let i = 0; i < W * W; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    height[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Multi-scale height (micro + medium) for crisp normals
  const blurH = new Float32Array(W * W);
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        const yy = (y + dy + W) % W;
        for (let dx = -2; dx <= 2; dx++) {
          const xx = (x + dx + W) % W;
          sum += height[yy * W + xx];
        }
      }
      blurH[y * W + x] = sum / 25.0;
    }
  }

  const normalBuf = Buffer.alloc(W * W * 3);
  const roughBuf = Buffer.alloc(W * W);

  const hAt = (x, y) => {
    const xx = (x + W) % W;
    const yy = (y + W) % W;
    const idx = yy * W + xx;
    return height[idx] * 0.65 + blurH[idx] * 0.35;
  };

  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const tl = hAt(x - 1, y - 1);
      const t  = hAt(x,     y - 1);
      const tr = hAt(x + 1, y - 1);
      const l  = hAt(x - 1, y);
      const r  = hAt(x + 1, y);
      const bl = hAt(x - 1, y + 1);
      const b  = hAt(x,     y + 1);
      const br = hAt(x + 1, y + 1);

      const dX = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dY = (bl + 2 * b + br) - (tl + 2 * t + tr);

      // OpenGL convention: +X right, +Y up (invert image Y), +Z out
      let nx = -dX * strength;
      let ny = dY * strength;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      const idx = y * W + x;
      normalBuf[idx * 3]     = Math.round((nx * 0.5 + 0.5) * 255);
      normalBuf[idx * 3 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      normalBuf[idx * 3 + 2] = Math.round((nz * 0.5 + 0.5) * 255);

      // Crevices (darker height) are rougher; high points slightly smoother
      const h = height[idx];
      const rough = Math.max(0.15, Math.min(0.98, baseRough + (0.5 - h) * roughContrast));
      roughBuf[idx] = Math.round(rough * 255);
    }
  }

  return { normalBuf, roughBuf };
}

for (const mat of MATERIALS) {
  const inFile = path.join(RAW_DIR, `${mat.name}.jpg`);
  const { data, info } = await sharp(inFile)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const seamlessRGB = makeSeamlessRGB(data, info.width, info.height, SIZE, BLEND);
  const { normalBuf, roughBuf } = buildNormalAndRoughness(
    seamlessRGB,
    SIZE,
    mat.normalStrength,
    mat.baseRough,
    mat.roughContrast
  );

  await sharp(seamlessRGB, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .jpeg({ quality: 88, chromaSubsampling: '4:4:4' })
    .toFile(path.join(OUT_DIR, `${mat.name}_color.jpg`));

  await sharp(normalBuf, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .jpeg({ quality: 86 })
    .toFile(path.join(OUT_DIR, `${mat.name}_normal.jpg`));

  await sharp(roughBuf, { raw: { width: SIZE, height: SIZE, channels: 1 } })
    .jpeg({ quality: 84 })
    .toFile(path.join(OUT_DIR, `${mat.name}_roughness.jpg`));

  console.log(`Baked seamless PBR set: ${mat.name} (1024x1024 color/normal/roughness)`);
}
