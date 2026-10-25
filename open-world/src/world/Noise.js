// Deterministic PRNG & Multi-Octave Gradient Noise for 4x4 km Open World

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
const GRAD2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

(function initPerm() {
  const rng = mulberry32(20261024);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
})();

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function noise2D(x, y) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = PERM[PERM[X] + Y] & 7;
  const ab = PERM[PERM[X] + Y + 1] & 7;
  const ba = PERM[PERM[X + 1] + Y] & 7;
  const bb = PERM[PERM[X + 1] + Y + 1] & 7;

  const gAA = GRAD2[aa][0] * xf + GRAD2[aa][1] * yf;
  const gBA = GRAD2[ba][0] * (xf - 1) + GRAD2[ba][1] * yf;
  const gAB = GRAD2[ab][0] * xf + GRAD2[ab][1] * (yf - 1);
  const gBB = GRAD2[bb][0] * (xf - 1) + GRAD2[bb][1] * (yf - 1);

  const x1 = gAA + u * (gBA - gAA);
  const x2 = gAB + u * (gBB - gAB);
  return x1 + v * (x2 - x1); // approximately [-0.7, 0.7] -> scale to [-1, 1]
}

export function fbm2D(x, y, octaves = 5, lacunarity = 2.02, gain = 0.5) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1.0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2D(x * freq, y * freq) * 1.42 * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridged2D(x, y, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1.0;
  let prev = 1.0;
  for (let i = 0; i < octaves; i++) {
    let n = 1.0 - Math.abs(noise2D(x * freq, y * freq) * 1.42);
    n = Math.max(0, n);
    n = n * n;
    sum += n * amp * prev;
    prev = Math.min(1.2, Math.max(0.25, n * 1.8));
    freq *= 2.1;
    amp *= 0.5;
  }
  return sum;
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
