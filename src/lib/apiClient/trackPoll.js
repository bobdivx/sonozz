import { loadKeys } from "../keys/storage.js";
import { request, sleep, formatElapsed, shortModelLabel, toAbortSignal } from "./core.js";

/** Traduit les stages bruts ACE / Studio en labels FR courts. */
function humanizeAceStage(stage, fallback = "") {
  const s = String(stage || "").trim().toLowerCase();
  if (!s) return fallback;
  if (/queue|pending|waiting|file/.test(s)) return "En file GPU\u2026";
  if (/load|switch|download|init|warm/.test(s)) return "Chargement DiT\u2026";
  if (/style|caption|prompt/.test(s)) return "Preparation style\u2026";
  if (/infer|sampl|denois|generat|diffus|step/.test(s)) return "Inference audio\u2026";
  if (/decode|vocoder|render|export|encode|write|save/.test(s)) return "Rendu / export\u2026";
  if (/upload|transfer/.test(s)) return "Transfert audio\u2026";
  if (s.length < 64 && !/^https?:/i.test(s)) {
    return stage.charAt(0).toUpperCase() + stage.slice(1);
  }
  return fallback || "Generation\u2026";
}

function formatTrackProgress(tick = {}) {
  let percent = Number(tick.progress);
  if (!Number.isFinite(percent)) percent = 0;
  percent = Math.max(0, Math.min(100, percent));
  const elapsed = Number(tick.elapsedSeconds) || 0;
  const estimated = Number(tick.estimatedSeconds) || 0;
  const msg = String(tick.message || "").trim();
  const status = String(tick.status || "processing");
  const modelLabel = shortModelLabel(tick.model || tick.quality);
  const stage = String(tick.stage || "").trim();
  if (status === "processing" && percent >= 30 && percent < 95 && estimated > 0 && elapsed > 0) {
    const timePct = 35 + Math.min(55, (elapsed / estimated) * 55);
    percent = Math.max(percent, Math.min(95, Math.round(timePct)));
  } else if (status === "processing" && percent < 5 && elapsed > 5) {
    percent = Math.min(30, 5 + Math.floor(elapsed / 4));
  }
  let message = msg || (status === "pending" ? "En file\u2026" : "Generation\u2026");
  if (!msg && stage) message = humanizeAceStage(stage, message);
  else if (msg && stage && msg === stage) message = humanizeAceStage(stage, msg);
  if (elapsed > 0) {
    const eta = estimated > elapsed ? ` \u00b7 reste ~${formatElapsed(estimated - elapsed)}` : estimated > 0 ? " \u00b7 finalisation\u2026" : "";
    message = `${message} (${formatElapsed(elapsed)}${eta})`;
  }
  return { percent: Math.max(0, Math.min(99, Math.round(percent))), message, status, stage: stage || null, model: tick.model || null, modelLabel: modelLabel || null, gpu: tick.gpu || null, phase: tick.phase || "generating", elapsedSeconds: elapsed, estimatedSeconds: estimated, musicKind: tick.musicKind || null };
}

async function awaitAceStartWithPhases(startPromise, onProgress, baseProgress = {}, signal) {
  const startedAt = Date.now();
  const schedule = [
    { at: 0, percent: 12, phase: "style", message: "Style caption (IA)\u2026" },
    { at: 2500, percent: 14, phase: "gpu-queue", message: "File GPU \u00b7 liberation VRAM\u2026" },
    { at: 7000, percent: 16, phase: "loading-model", message: "Chargement modele DiT\u2026" },
    { at: 20000, percent: 18, phase: "loading-model", message: "Chargement DiT encore en cours\u2026" },
    { at: 60000, percent: 20, phase: "loading-model", message: "SFT long \u2014 patiente encore\u2026" },
  ];
  let idx = 0;
  const emit = () => {
    const elapsed = Date.now() - startedAt;
    while (idx + 1 < schedule.length && elapsed >= schedule[idx + 1].at) idx += 1;
    const step = schedule[idx];
    onProgress?.({ ...baseProgress, percent: step.percent, phase: step.phase, musicKind: "acestep", message: `${step.message} ${formatElapsed(Math.round(elapsed / 1000))}` });
  };
  emit();
  const timer = setInterval(emit, 1200);
  try { return await startPromise; } finally { clearInterval(timer); }
}

async function prepareAceStepClient(payload, onProgress, signal) {
  const keys = loadKeys();
  const provider = String(keys?.musicProvider || "").trim();
  if (provider !== "acestep") return null;
  if (!keys || String(keys.aceStepEnabled || "1") === "0") return null;
  const throwIfAborted = () => { if (signal?.aborted) { const err = new Error("Generation audio annulee"); err.name = "AbortError"; throw err; } };
  onProgress?.({ percent: 3, phase: "probe", musicKind: "acestep", message: "Connexion ACE-Step \u00b7 lecture VRAM\u2026" });
  throwIfAborted();
  let probe;
  try { probe = await request("/api/track", { action: "probe-acestep" }, { signal }); }
  catch (e) { if (e?.name === "AbortError") throw e; onProgress?.({ percent: 4, phase: "probe", musicKind: "acestep", message: `ACE-Step : ${String(e.message || e).slice(0, 120)}` }); return null; }
  const targetId = String(payload?.forceAceModelId || "").trim() || String(keys.aceStepPreferredModel || "").trim() || String(probe?.pickedModel || "").trim() || String(probe?.activeModel || "").trim();
  const active = String(probe?.activeModel || "").trim();
  const gpu = probe?.gpu || null;
  const targetLabel = shortModelLabel(targetId) || "auto";
  onProgress?.({ percent: 5, phase: "probe", musicKind: "acestep", model: active || targetId || null, modelLabel: shortModelLabel(active || targetId) || null, gpu, message: "Studio joignable" });
  if (!targetId || (active && active === targetId)) return { probe, model: active || targetId, gpu };
  onProgress?.({ percent: 6, phase: "loading-model", musicKind: "acestep", model: targetId, modelLabel: targetLabel, gpu, message: "Chargement du modele\u2026 (plusieurs minutes possibles)" });
  const switchPromise = request("/api/track", { action: "switch-acestep-model", modelId: targetId }, { signal }).then((r) => ({ ok: true, result: r })).catch((e) => ({ ok: false, error: e }));
  const startedAt = Date.now();
  while (true) {
    throwIfAborted();
    const settled = await Promise.race([switchPromise.then((r) => ({ type: "switch", ...r })), sleep(4000, signal).then(() => ({ type: "tick" }))]);
    let latest = probe;
    try { latest = await request("/api/track", { action: "probe-acestep" }, { signal }); } catch {}
    const nowActive = String(latest?.activeModel || "").trim();
    const nowGpu = latest?.gpu || gpu;
    const secs = Math.round((Date.now() - startedAt) / 1000);
    onProgress?.({ percent: Math.min(11, 6 + Math.floor(secs / 30)), phase: "loading-model", musicKind: "acestep", model: targetId, modelLabel: targetLabel, gpu: nowGpu, message: nowActive === targetId ? "Modele pret" : `Chargement en cours\u2026 ${formatElapsed(secs)}` });
    if (nowActive === targetId) { await switchPromise.catch(() => {}); return { probe: latest, model: targetId, gpu: nowGpu }; }
    if (settled.type === "switch") { if (!settled.ok && settled.error?.name === "AbortError") throw settled.error; onProgress?.({ percent: 10, phase: "loading-model", musicKind: "acestep", model: targetId, modelLabel: targetLabel, gpu: nowGpu, message: settled.ok ? "Modele charge" : "Chargement encore en cours cote Studio" }); return { probe: latest, model: targetId, gpu: nowGpu }; }
    if (secs > 360) return { probe: latest, model: targetId, gpu: nowGpu };
  }
}

export async function trackWithPoll(payload = {}, onProgress, opts = {}) {
  const signal = opts.signal;
  const throwIfAborted = () => { if (signal?.aborted) { const err = new Error("Generation audio annulee"); err.name = "AbortError"; throw err; } };
  throwIfAborted();
  const isPreview = Boolean(payload?.preview);
  onProgress?.({ percent: 5, phase: "starting", message: isPreview ? "Demarrage extrait audio\u2026" : "Demarrage generation audio\u2026" });
  let prepared = null;
  if (!opts.generationId) { try { prepared = await prepareAceStepClient(payload, onProgress, signal); } catch (e) { if (e?.name === "AbortError") throw e; console.warn("[track] prepare ACE ignore:", e?.message || e); } }
  let started;
  if (opts.generationId && opts.musicKind) { started = { pollNeeded: true, generationId: opts.generationId, musicKind: opts.musicKind, draft: opts.draft }; }
  else {
    const baseProgress = { model: prepared?.model || null, modelLabel: shortModelLabel(prepared?.model) || null, gpu: prepared?.gpu || null };
    const startReq = request("/api/track", { ...payload, action: "start" }, { signal });
    const provider = String(loadKeys()?.musicProvider || "").trim();
    if (provider === "acestep" || prepared) { started = await awaitAceStartWithPhases(startReq, onProgress, baseProgress, signal); }
    else { onProgress?.({ percent: 11, phase: "starting", ...baseProgress, message: isPreview ? `Lancement extrait${prepared?.model ? ` \u00b7 ${shortModelLabel(prepared.model)}` : ""}\u2026` : `Lancement generation${prepared?.model ? ` \u00b7 ${shortModelLabel(prepared.model)}` : ""}\u2026` }); started = await startReq; }
    throwIfAborted();
    opts.onStarted?.(started);
  }
  throwIfAborted();
  if (!started?.pollNeeded) { const { pollNeeded: _p, musicKind: _m, generationId: _g, draft, ...rest } = started || {}; if (draft && typeof draft === "object") return { ...draft, ...rest }; return rest; }
  const startedModel = started.model || started.draft?.aceStepModel || prepared?.model || null;
  const startedGpu = started.gpu || prepared?.gpu || null;
  onProgress?.({ percent: 22, phase: "generating", model: startedModel, modelLabel: shortModelLabel(startedModel) || started.quality || null, gpu: startedGpu, message: started.musicKind === "acestep" ? (isPreview ? "Extrait ACE-Step \u2014 generation GPU\u2026" : "ACE-Step \u2014 generation GPU\u2026") : started.musicKind === "songgen" ? (isPreview ? "Extrait SongGen \u2014 attente GPU\u2026" : "SongGen demarre \u2014 attente GPU\u2026") : (isPreview ? "Extrait MiniMax \u2014 attente Replicate\u2026" : "MiniMax demarre \u2014 attente Replicate\u2026"), musicKind: started.musicKind });
  const isLocalGpu = started.musicKind === "songgen" || started.musicKind === "acestep";
  const maxPolls = isLocalGpu ? (isPreview ? 200 : 400) : 180;
  const intervalMs = isLocalGpu ? 3000 : 2500;
  try {
    for (let i = 0; i < maxPolls; i++) {
      throwIfAborted();
      await sleep(intervalMs, signal);
      throwIfAborted();
      let tick;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { tick = await request("/api/track", { action: "poll", generationId: started.generationId, musicKind: started.musicKind, draft: started.draft }, { signal }); break; }
        catch (e) { if (e?.name === "AbortError") throw e; const msg = String(e?.message || ""); const transient = /404|pas encore|injoignable|timeout|ECONNRESET|fetch failed|HTTP 5\d\d/i.test(msg); if (!transient || attempt === 2) throw e; await sleep(1500, signal); }
      }
      if (tick?.done && tick.track) { onProgress?.({ percent: 100, phase: "done", model: startedModel, musicKind: started.musicKind, message: isPreview || tick.track.isPreview ? "Extrait pret" : "Audio pret" }); return tick.track; }
      onProgress?.(formatTrackProgress({ ...tick, musicKind: started.musicKind, model: tick?.model || startedModel, gpu: tick?.gpu || startedGpu, phase: "generating" }));
    }
    throw new Error(started.musicKind === "acestep" ? (isPreview ? "Timeout extrait ACE-Step \u2014 reessaie ou lance le complet." : "Timeout ACE-Step Studio (~20 min) \u2014 SFT = plus long.") : started.musicKind === "songgen" ? (isPreview ? "Timeout extrait SongGen \u2014 reessaie ou lance le complet." : "Timeout SongGeneration Studio (~20 min) \u2014 modele Large = plus long sur 3090.") : "Timeout MiniMax Replicate (~7 min).");
  } catch (e) {
    if (e?.name === "AbortError" && started?.generationId) { void request("/api/track", { action: "cancel", generationId: started.generationId, musicKind: started.musicKind }).catch(() => {}); throw e; }
    if (started?.musicKind === "acestep" && !payload?.skipStyleReference && /ACE_REF_UNUSABLE|invalid, unreadable, or silent|rejete l.audio de reference/i.test(String(e?.message || ""))) {
      onProgress?.({ percent: 8, phase: "retry", message: "Reference audio refusee \u2014 relance sans cover\u2026" });
      return trackWithPoll({ ...payload, skipStyleReference: true }, onProgress, { ...opts, generationId: undefined, musicKind: undefined, draft: undefined });
    }
    if (started?.musicKind === "acestep" && !payload?.aceLightRetry && /ACE_NAN_LATENTS|ACE_NOISE_WALL|VRAM insuffisante|NaN or Inf latents|out of memory|mur de bruit/i.test(String(e?.message || ""))) {
      onProgress?.({ percent: 8, phase: "retry", model: "marcorez8/acestep-v15-xl-turbo-bf16", modelLabel: "XL Turbo BF16", message: /ACE_NOISE_WALL|mur de bruit/i.test(String(e?.message || "")) ? "SFT mur de bruit \u2014 relance en Turbo BF16\u2026" : "GPU sature / NaN \u2014 relance en Turbo BF16 (leger)\u2026" });
      return trackWithPoll({ ...payload, skipStyleReference: true, aceLightRetry: true, forceAceModelId: "marcorez8/acestep-v15-xl-turbo-bf16" }, onProgress, { ...opts, generationId: undefined, musicKind: undefined, draft: undefined });
    }
    throw e;
  }
}
