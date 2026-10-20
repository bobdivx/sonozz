/**
 * FFT minimal (radix-2 itératif + Bluestein pour les tailles quelconques, ex. 7680 du modèle MDX).
 * Pur JS, sans dépendance. Float64Array re/im en place.
 */

const radix2Cache = new Map();

function radix2Tables(n) {
  let t = radix2Cache.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0, x = i; b < bits; b++, x >>= 1) r = (r << 1) | (x & 1);
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  t = { rev, cos, sin };
  radix2Cache.set(n, t);
  return t;
}

/** FFT radix-2 en place. inverse=true → sans normalisation 1/n. */
export function fftRadix2(re, im, inverse = false) {
  const n = re.length;
  const { rev, cos, sin } = radix2Tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sgn = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k];
        const wi = sgn * sin[k];
        const a = i + j;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

const isPow2 = (n) => (n & (n - 1)) === 0;
const bluesteinCache = new Map();

function bluesteinTables(n) {
  let t = bluesteinCache.get(n);
  if (t) return t;
  let m = 1;
  while (m < 2 * n - 1) m <<= 1;
  const wr = new Float64Array(n);
  const wi = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    const a = (Math.PI * ((k * k) % (2 * n))) / n;
    wr[k] = Math.cos(a);
    wi[k] = Math.sin(a);
  }
  const br = new Float64Array(m);
  const bi = new Float64Array(m);
  br[0] = wr[0]; bi[0] = wi[0];
  for (let k = 1; k < n; k++) {
    br[k] = br[m - k] = wr[k];
    bi[k] = bi[m - k] = wi[k];
  }
  fftRadix2(br, bi, false);
  t = { m, wr, wi, br, bi, ar: new Float64Array(m), ai: new Float64Array(m) };
  bluesteinCache.set(n, t);
  return t;
}

/** FFT de taille quelconque (en place). inverse sans normalisation. */
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (isPow2(n)) return fftRadix2(re, im, inverse);
  if (inverse) {
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im, false);
    for (let i = 0; i < n; i++) im[i] = -im[i];
    return;
  }
  const { m, wr, wi, br, bi, ar, ai } = bluesteinTables(n);
  ar.fill(0); ai.fill(0);
  for (let k = 0; k < n; k++) {
    // a_k = x_k * conj(w_k)
    ar[k] = re[k] * wr[k] + im[k] * wi[k];
    ai[k] = im[k] * wr[k] - re[k] * wi[k];
  }
  fftRadix2(ar, ai, false);
  for (let i = 0; i < m; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const s = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r; ai[i] = s;
  }
  fftRadix2(ar, ai, true);
  for (let k = 0; k < n; k++) {
    const r = ar[k] / m;
    const s = ai[k] / m;
    re[k] = r * wr[k] + s * wi[k];
    im[k] = s * wr[k] - r * wi[k];
  }
}

export function hann(n, periodic = true) {
  const w = new Float64Array(n);
  const d = periodic ? n : n - 1;
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
  return w;
}

/**
 * STFT façon torch.stft(center=True, pad réflexion). Renvoie { re, im } de forme [frames][bins]
 * à plat : index = t * nBins + f. Ne garde que `keepBins` bins (défaut n/2+1).
 */
export function stft(x, { nFft, hop, window = hann(nFft), keepBins = (nFft >> 1) + 1 } = {}) {
  const pad = nFft >> 1;
  const len = x.length;
  const frames = 1 + Math.floor(len / hop);
  const re = new Float32Array(frames * keepBins);
  const im = new Float32Array(frames * keepBins);
  const fr = new Float64Array(nFft);
  const fi = new Float64Array(nFft);
  for (let t = 0; t < frames; t++) {
    const start = t * hop - pad;
    for (let i = 0; i < nFft; i++) {
      let j = start + i;
      if (j < 0) j = -j;
      if (j >= len) j = 2 * len - 2 - j;
      if (j < 0 || j >= len) j = 0;
      fr[i] = x[j] * window[i];
      fi[i] = 0;
    }
    fft(fr, fi, false);
    const o = t * keepBins;
    for (let f = 0; f < keepBins; f++) {
      re[o + f] = fr[f];
      im[o + f] = fi[f];
    }
  }
  return { re, im, frames, bins: keepBins };
}

/** ISTFT (overlap-add, fenêtre au carré normalisée) — inverse de stft() ; bins manquants = 0. */
export function istft(re, im, { nFft, hop, frames, bins, length, window = hann(nFft) }) {
  const pad = nFft >> 1;
  const outLen = (frames - 1) * hop + nFft;
  const y = new Float64Array(outLen);
  const wsum = new Float64Array(outLen);
  const fr = new Float64Array(nFft);
  const fi = new Float64Array(nFft);
  const half = nFft >> 1;
  for (let t = 0; t < frames; t++) {
    fr.fill(0); fi.fill(0);
    const o = t * bins;
    for (let f = 0; f < Math.min(bins, half + 1); f++) {
      fr[f] = re[o + f];
      fi[f] = im[o + f];
    }
    for (let f = 1; f < half; f++) {
      fr[nFft - f] = fr[f];
      fi[nFft - f] = -fi[f];
    }
    fft(fr, fi, true);
    const s = t * hop;
    for (let i = 0; i < nFft; i++) {
      y[s + i] += (fr[i] / nFft) * window[i];
      wsum[s + i] += window[i] * window[i];
    }
  }
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const j = i + pad;
    out[i] = wsum[j] > 1e-8 ? y[j] / wsum[j] : 0;
  }
  return out;
}
