/**
 * Mesures audio d'une prise (pur JS) : voix (sur la piste voix séparée), style/mix, défauts.
 * Les valeurs ne cherchent pas à reproduire demucs/AST au chiffre près : elles sont comparées à un
 * PROFIL CIBLE calculé avec CE MÊME code sur l'extrait de référence de l'artiste.
 */
import { fftRadix2, hann } from "./fft.js";

const median = (a) => {
  const v = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : 0.5 * (v[m - 1] + v[m]);
};
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const round = (x, d = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null);

/** Spectre de puissance [T][F] (n_fft puissance de 2). */
export function powerSpec(x, { nFft = 4096, hop = 1024 } = {}) {
  const w = hann(nFft);
  const bins = (nFft >> 1) + 1;
  const frames = Math.max(0, 1 + Math.floor((x.length - nFft) / hop));
  const P = new Float32Array(frames * bins);
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  for (let t = 0; t < frames; t++) {
    const s = t * hop;
    for (let i = 0; i < nFft; i++) {
      re[i] = x[s + i] * w[i];
      im[i] = 0;
    }
    fftRadix2(re, im, false);
    for (let f = 0; f < bins; f++) P[t * bins + f] = re[f] * re[f] + im[f] * im[f];
  }
  return { P, frames, bins, nFft, hop };
}

function median17(buf, n) {
  // tri par insertion (n ≤ 17)
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) { buf[j + 1] = buf[j]; j--; }
    buf[j + 1] = v;
  }
  return buf[n >> 1];
}

/** HPSS (Fitzgerald) : masques doux harmonique / percussif. Renvoie Ph, Pp. */
export function hpss(spec, { kT = 17, kF = 17, maxBin = spec.bins } = {}) {
  const { P, frames, bins } = spec;
  const H = new Float32Array(frames * bins);
  const Q = new Float32Array(frames * bins);
  const buf = new Float64Array(Math.max(kT, kF));
  const hT = kT >> 1;
  const hF = kF >> 1;
  for (let t = 0; t < frames; t++) {
    for (let f = 0; f < maxBin; f++) {
      let n = 0;
      for (let k = t - hT; k <= t + hT; k++) if (k >= 0 && k < frames) buf[n++] = P[k * bins + f];
      H[t * bins + f] = median17(buf, n);
      n = 0;
      for (let k = f - hF; k <= f + hF; k++) if (k >= 0 && k < maxBin) buf[n++] = P[t * bins + k];
      Q[t * bins + f] = median17(buf, n);
    }
  }
  const Ph = new Float32Array(frames * bins);
  const Pp = new Float32Array(frames * bins);
  for (let i = 0; i < P.length; i++) {
    const h2 = H[i] * H[i];
    const p2 = Q[i] * Q[i];
    const s = h2 + p2 + 1e-20;
    Ph[i] = (P[i] * h2) / s;
    Pp[i] = (P[i] * p2) / s;
  }
  return { Ph, Pp };
}

function bandSum(P, t, bins, f0, f1) {
  let s = 0;
  for (let f = f0; f < f1; f++) s += P[t * bins + f];
  return s;
}

/** Détection d'attaques dans une bande : flux positif du log, pic adaptatif. → attaques/s */
export function onsetRate(P, frames, bins, f0, f1, { hopSec, minGapSec = 0.1, k = 1.0 } = {}) {
  const env = new Float64Array(frames);
  let prev = 0;
  for (let t = 0; t < frames; t++) {
    const e = Math.log10(1e-10 + bandSum(P, t, bins, f0, f1));
    env[t] = t ? Math.max(0, e - prev) : 0;
    prev = e;
  }
  const W = Math.max(3, Math.round(0.75 / hopSec));
  const gap = Math.max(1, Math.round(minGapSec / hopSec));
  let count = 0;
  let last = -1e9;
  for (let t = 1; t < frames - 1; t++) {
    if (env[t] < env[t - 1] || env[t] < env[t + 1]) continue;
    let s = 0, s2 = 0, n = 0;
    for (let j = Math.max(0, t - W); j < Math.min(frames, t + W); j++) { s += env[j]; s2 += env[j] * env[j]; n++; }
    const m = s / n;
    const sd = Math.sqrt(Math.max(0, s2 / n - m * m));
    if (env[t] > m + k * sd && env[t] > 0.05 && t - last >= gap) { count++; last = t; }
  }
  return { rate: count / (frames * hopSec), env };
}

/**
 * Enveloppe d'attaque « à la librosa » : moyenne sur la bande du flux positif en dB (réf. max, plancher −80 dB).
 */
export function onsetEnvDb(P, frames, bins, f0, f1) {
  const env = new Float64Array(frames);
  let mx = 1e-20;
  for (let i = 0; i < P.length; i++) if (P[i] > mx) mx = P[i];
  const db = (v) => Math.max(10 * Math.log10(v / mx + 1e-20), -80);
  for (let t = 1; t < frames; t++) {
    let s = 0;
    for (let f = f0; f < f1; f++) s += Math.max(0, db(P[t * bins + f]) - db(P[(t - 1) * bins + f]));
    env[t] = s / Math.max(1, f1 - f0);
  }
  return env;
}

/** Pics d'attaque (max local ±30 ms, au-dessus de la moyenne ±100 ms + delta) → attaques/s. */
export function pickOnsetRate(env, hopSec, delta = 0.15) {
  let mn = Infinity, mx = -Infinity;
  for (const v of env) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
  const e = Array.from(env, (v) => (v - mn) / (mx - mn + 1e-12));
  const pm = Math.max(1, Math.round(0.03 / hopSec));
  const am = Math.max(1, Math.round(0.1 / hopSec));
  let c = 0, last = -1e9;
  for (let t = 0; t < e.length; t++) {
    let peak = true;
    for (let j = Math.max(0, t - pm); j <= Math.min(e.length - 1, t + pm); j++) if (e[j] > e[t]) { peak = false; break; }
    if (!peak) continue;
    let s = 0, n = 0;
    for (let j = Math.max(0, t - am); j <= Math.min(e.length - 1, t + am); j++) { s += e[j]; n++; }
    if (e[t] >= s / n + delta && t - last > pm) { c++; last = t; }
  }
  return c / (e.length * hopSec);
}

/** Tempo par autocorrélation de l'enveloppe d'attaques (60–180 BPM). */
export function tempoFromEnv(env, hopSec) {
  const n = env.length;
  const m = mean(Array.from(env));
  let best = 0, bestBpm = null;
  for (let bpm = 60; bpm <= 180; bpm += 1) {
    const lag = 60 / bpm / hopSec;
    const l0 = Math.floor(lag);
    const fr = lag - l0;
    let s = 0;
    for (let t = 0; t + l0 + 1 < n; t++) {
      const v = env[t + l0] * (1 - fr) + env[t + l0 + 1] * fr;
      s += (env[t] - m) * (v - m);
    }
    // légère préférence 80–140 (évite les octaves)
    const w = 1 - 0.15 * Math.abs(Math.log2(bpm / 110));
    if (s * w > best) { best = s * w; bestBpm = bpm; }
  }
  return bestBpm;
}

/** Décimation simple (filtre moyenneur fenêtré) par facteur entier. */
export function decimate(x, factor) {
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  const taps = factor * 4 + 1;
  const h = hann(taps, false);
  const hs = h.reduce((a, b) => a + b, 0);
  for (let i = 0; i < n; i++) {
    const c = i * factor;
    let s = 0;
    for (let k = 0; k < taps; k++) {
      const j = c + k - (taps >> 1);
      if (j >= 0 && j < x.length) s += x[j] * h[k];
    }
    out[i] = s / hs;
  }
  return out;
}

/**
 * Hauteur (YIN) + HNR (autocorrélation normalisée, façon Praat « cc ») par trame.
 * x : voix mono à `sr` (≈11 kHz). Renvoie trames voisées { t, f0, hnr, rmsDb }.
 */
export function pitchHnrTrack(x, sr, { fmin = 70, fmax = 700, frameSec = 0.046, hopSec = 0.023, thr = 0.15 } = {}) {
  const N = Math.round(frameSec * sr);
  const H = Math.round(hopSec * sr);
  const tauMin = Math.floor(sr / fmax);
  const tauMax = Math.ceil(sr / fmin);
  const out = [];
  const d = new Float64Array(tauMax + 1);
  for (let s = 0; s + N + tauMax < x.length; s += H) {
    let e = 0;
    for (let i = 0; i < N; i++) e += x[s + i] * x[s + i];
    const rmsDb = 10 * Math.log10(e / N + 1e-12);
    out.push({ t: s / sr, rmsDb, f0: null, hnr: null });
    if (rmsDb < -45) continue;
    d[0] = 1;
    let run = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let acc = 0;
      for (let i = 0; i < N; i++) {
        const v = x[s + i] - x[s + i + tau];
        acc += v * v;
      }
      run += acc;
      d[tau] = run > 0 ? (acc * tau) / run : 1;
    }
    let tauSel = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (d[tau] < thr) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        tauSel = tau;
        break;
      }
    }
    if (tauSel < 0) continue;
    const f0 = sr / tauSel;
    // autocorrélation normalisée au retard de la période → HNR
    let xy = 0, xx = 0, yy = 0;
    for (let i = 0; i < N; i++) {
      const a = x[s + i], b = x[s + i + tauSel];
      xy += a * b; xx += a * a; yy += b * b;
    }
    const r = Math.min(0.9999, Math.max(1e-4, xy / Math.sqrt(xx * yy + 1e-20)));
    out[out.length - 1].f0 = f0;
    out[out.length - 1].hnr = 10 * Math.log10(r / (1 - r));
  }
  return out;
}

/**
 * Style/mix sur les blocs (mono 44,1 kHz) + piste instrumentale (mix − voix).
 * @param {Array<{mix: Float32Array, vocal: Float32Array}>} blocks
 */
export function styleFeatures(blocks, sr = 44100) {
  const nFft = 4096;
  const hop = 1024;
  const hopSec = hop / sr;
  const binHz = sr / nFft;
  const b = (hz) => Math.min((nFft >> 1) + 1, Math.max(0, Math.round(hz / binHz)));
  const maxBin = b(11000);
  let tot = 0, perc = 0, sub = 0, harmInstr = 0, cNum = 0, cDen = 0, distNum = 0, distDen = 0;
  const kick = [], hat = [], tempos = [];
  let vocE = 0, mixE = 0;
  for (const blk of blocks) {
    const S = powerSpec(blk.mix, { nFft, hop });
    const inst = new Float32Array(blk.mix.length);
    for (let i = 0; i < inst.length; i++) inst[i] = blk.mix[i] - (blk.vocal ? blk.vocal[i] : 0);
    const SI = powerSpec(inst, { nFft, hop });
    const { Ph, Pp } = hpss(S, { maxBin });
    const HS = hpss(SI, { maxBin });
    const HI = HS.Ph;
    const PI = HS.Pp;
    const { P, frames, bins } = S;
    for (let t = 0; t < frames; t++) {
      for (let f = b(30); f < maxBin; f++) {
        const i = t * bins + f;
        tot += P[i]; perc += Pp[i];
        cNum += P[i] * f * binHz; cDen += P[i];
        if (f < b(60)) sub += P[i];
        if (f >= b(150)) harmInstr += HI[i];
      }
    }
    const k = onsetRate(PI, frames, bins, b(40), b(150), { hopSec, minGapSec: 0.12 });
    const h = onsetRate(PI, frames, bins, b(6000), b(11000), { hopSec, minGapSec: 0.06 });
    // densités kick / charley : instrumental, résolution 5,8 ms (validé : charley Spearman 0,63 vs stem batterie)
    const SF = powerSpec(inst, { nFft: 2048, hop: 256 });
    const fHz = sr / 2048;
    kick.push(pickOnsetRate(onsetEnvDb(SF.P, SF.frames, SF.bins, 1, Math.round(150 / fHz)), 256 / sr));
    hat.push(pickOnsetRate(onsetEnvDb(SF.P, SF.frames, SF.bins, Math.round(6000 / fHz), Math.round(11000 / fHz)), 256 / sr));
    // guitares saturées / médium dense : part 700 Hz–5 kHz de l'instrumental (Spearman 0,53 vs tags AST « metal/guitare »)
    for (let t = 0; t < SF.frames; t++) for (let f = 1; f < SF.bins; f++) {
      const v = SF.P[t * SF.bins + f];
      distDen += v;
      if (f >= Math.round(700 / fHz) && f < Math.round(5000 / fHz)) distNum += v;
    }
    const env = k.env.map((v, i) => v + h.env[i]);
    tempos.push(tempoFromEnv(env, hopSec));
    if (blk.vocal) for (let i = 0; i < blk.mix.length; i++) { vocE += blk.vocal[i] ** 2; mixE += blk.mix[i] ** 2; }
  }
  return {
    drumShare: round(perc / (tot + 1e-20)),
    subShare: round(sub / (tot + 1e-20), 4),
    melodicShare: round(harmInstr / (tot + 1e-20)),
    kickPerSec: round(median(kick), 2),
    hatPerSec: round(median(hat), 2),
    brightnessHz: round(cNum / (cDen + 1e-20), 0),
    distortion: round(distNum / (distDen + 1e-20), 4), // part médium instrumentale
    tempo: median(tempos.filter(Boolean)),
    vocalEnergyShare: mixE > 0 ? round(vocE / mixE) : null,
  };
}

/** Défauts sur la piste entière (mono, sr bas) : silence, saturation numérique, fin coupée. */
export function defectFeatures(x, sr, { requestedSec = null } = {}) {
  const win = Math.round(0.05 * sr);
  const rmsDb = [];
  let clip = 0;
  for (let s = 0; s + win <= x.length; s += win) {
    let e = 0;
    for (let i = 0; i < win; i++) {
      const v = x[s + i];
      e += v * v;
      if (Math.abs(v) >= 0.999) clip++;
    }
    rmsDb.push(10 * Math.log10(e / win + 1e-12));
  }
  const dur = x.length / sr;
  const med = median(rmsDb) ?? -99;
  const silentShare = rmsDb.filter((v) => v < -50).length / Math.max(1, rmsDb.length);
  // trou de silence long au milieu (> 2 s) hors intro/outro
  let gap = 0, maxGap = 0;
  const startI = Math.round(3 / 0.05), endI = rmsDb.length - Math.round(5 / 0.05);
  for (let i = startI; i < endI; i++) { if (rmsDb[i] < med - 30) { gap++; maxGap = Math.max(maxGap, gap); } else gap = 0; }
  const tail = rmsDb.slice(-6); // 300 ms
  const tailDb = tail.length ? mean(tail) : -99;
  const abruptEnd = tailDb > med - 6;
  const short = requestedSec ? dur < 0.85 * requestedSec : false;
  return {
    durationSec: round(dur, 1),
    silentShare: round(silentShare),
    midGapSec: round(maxGap * 0.05, 2),
    clipShare: round(clip / Math.max(1, x.length), 5),
    abruptEnd,
    // fin abrupte seule = info (ACE coupe souvent net à la durée demandée) ; défaut si prise trop courte
    cut: short,
    medianDb: round(med, 1),
  };
}


/**
 * Classifieur H/F par fenêtre de 3 s (régression logistique distillée depuis un modèle
 * wav2vec2 « gender recognition » sur 224 fenêtres de stems voix MDX ; CV groupée par clip :
 * 91 % des fenêtres, Spearman 0,80 sur la part de voix féminine par clip).
 * Entrées : log F0 (médiane, p10, p90), HNR médian, log centroïde, 16 bandes log 80 Hz–5 kHz.
 */
const GENDER_LR = {
  mean: [5.7523, 5.4456, 6.0732, 12.951, 6.6004, -5.501, -4.8774, -4.0498, -3.2698, -2.367, -1.6482, -1.3811, -1.0258, -0.91568, -1.0661, -1.4237, -1.687, -1.987, -2.264, -2.6677, -3.707],
  scale: [0.43049, 0.49819, 0.44209, 3.1067, 0.25752, 1.3999, 1.8667, 1.9561, 1.8453, 1.5024, 0.90555, 0.80306, 0.80021, 0.52276, 0.61493, 0.49944, 0.73656, 0.74917, 0.79844, 0.76579, 0.76024],
  coef: [0.20018, -0.50804, -0.39273, 0.38829, 0.3833, -0.33115, -0.81975, -0.47926, -1.0218, -0.020143, 0.14089, -0.29153, -0.51455, -0.10905, 0.35776, -0.64464, -0.39553, -0.34088, -0.51102, -0.062296, 1.3277],
  b: 1.3113,
};
const GENDER_EDGES = Array.from({ length: 17 }, (_, i) => 80 * Math.pow(5000 / 80, i / 16));

const quant = (arr, p) => {
  if (!arr.length) return null;
  const s = arr.slice().sort((x, y) => x - y);
  return s[Math.floor(p * (s.length - 1))];
};

/** Descripteurs d'une fenêtre voix (sr 11025) + probabilité « voix féminine ». */
export function genderWindow(seg, frames, sr) {
  const v = frames.filter((p) => p.f0);
  const voiced = frames.length ? v.length / frames.length : 0;
  let e = 0;
  for (const x of seg) e += x * x;
  const rms = Math.sqrt(e / Math.max(1, seg.length));
  if (!v.length) return { voiced, rms, f0: null, hnr: null, pFemale: null };
  const f0s = v.map((p) => p.f0);
  const f0 = quant(f0s, 0.5);
  const hnr = quant(v.map((p) => p.hnr), 0.5);
  const S = powerSpec(seg, { nFft: 1024, hop: 256 });
  const hz = sr / 1024;
  const bandE = new Float64Array(16);
  let cN = 0, cD = 0;
  for (let t = 0; t < S.frames; t++) for (let k = 1; k < S.bins; k++) {
    const p = S.P[t * S.bins + k], fq = k * hz;
    cN += p * fq; cD += p;
    for (let j = 0; j < 16; j++) if (fq >= GENDER_EDGES[j] && fq < GENDER_EDGES[j + 1]) { bandE[j] += p; break; }
  }
  const tot = bandE.reduce((s, x) => s + x, 0) + 1e-20;
  const x = [Math.log(f0), Math.log(quant(f0s, 0.1)), Math.log(quant(f0s, 0.9)), hnr || 0, Math.log(cN / (cD + 1e-20) + 1e-9),
    ...Array.from(bandE, (b) => Math.log10(b / tot + 1e-9))];
  let z = GENDER_LR.b;
  for (let i = 0; i < x.length; i++) z += GENDER_LR.coef[i] * (x[i] - GENDER_LR.mean[i]) / GENDER_LR.scale[i];
  return { voiced, rms, f0, hnr, pFemale: 1 / (1 + Math.exp(-z)) };
}

/**
 * Synthèse des fenêtres voix : part de voix masculine, F0 / HNR (grain) par voix.
 * Une fenêtre compte si elle est assez voisée et audible ; elle est « homme » si pFemale < 0,5.
 */
export function summarizeVoiceWindows(wins, { minVoiced = 0.2, minRms = 0.008 } = {}) {
  const ok = wins.filter((w) => w.pFemale != null && w.voiced >= minVoiced && w.rms >= minRms);
  const male = ok.filter((w) => w.pFemale < 0.5);
  const female = ok.filter((w) => w.pFemale >= 0.5);
  return {
    windows: ok.length,
    f0: round(median(ok.map((w) => w.f0)), 1),
    hnr: round(median(ok.map((w) => w.hnr)), 2),
    maleShare: ok.length ? round(male.length / ok.length) : null,
    maleF0: round(median(male.map((w) => w.f0)), 1),
    maleHnr: round(median(male.map((w) => w.hnr)), 2),
    femaleF0: round(median(female.map((w) => w.f0)), 1),
    femaleHnr: round(median(female.map((w) => w.hnr)), 2),
  };
}

/**
 * Voix : piste voix séparée (concaténation de blocs de `blockLen` échantillons, sr 11025).
 * Fenêtres de 3 s, pas 0,75 s, à l'intérieur de chaque bloc.
 */
export function voiceFeatures(vocal11k, sr, { blockLen = vocal11k.length, winSec = 3, hopSec = 0.75 } = {}) {
  const wins = [];
  let voicedN = 0, framesN = 0;
  for (let o = 0; o + sr <= vocal11k.length; o += blockLen) {
    const blk = vocal11k.subarray(o, Math.min(vocal11k.length, o + blockLen));
    const tr = pitchHnrTrack(blk, sr);
    framesN += tr.length;
    voicedN += tr.filter((p) => p.f0).length;
    const T = blk.length / sr;
    const w = Math.min(winSec, T);
    for (let a = 0; a + w <= T + 1e-6; a += hopSec) {
      const seg = blk.subarray(Math.round(a * sr), Math.round((a + w) * sr));
      wins.push({ t: o / sr + a, ...genderWindow(seg, tr.filter((p) => p.t >= a && p.t < a + w), sr) });
    }
  }
  return { voicedShare: framesN ? round(voicedN / framesN) : 0, ...summarizeVoiceWindows(wins) };
}
