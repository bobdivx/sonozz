import {
  resolveAceStepBaseUrl,
  aceStepModelLabel,
  aceStepDitSame,
  isAceStepSftModel,
  pickAceStepModel,
  ACE_FALLBACK_LIGHT_MODEL,
  ACE_TIMESTEP_SHIFT,
} from "./models.js";
import {
  POLL_MS,
  MAX_POLLS,
  aceFetch,
  withAuth,
  firstAudioUrl,
  resolveAceAudioUrl,
} from "./client.js";
import {
  buildAceStepBody,
  buildLabAceStepBody,
  snapshotAceGenParams,
} from "./body.js";
import { resolveAceStepStyleCaption } from "./styleCaption.js";
import {
  testAceStep,
  wakeAceStepPipeline,
  ensureAceGpuSlot,
  switchAceStepModel,
  waitForAceStepModel,
  waitForAceStepResidentVram,
  readAceStepGpu,
  ensureAceStepVram,
  isAceStepGhostLoad,
  aceStepMinResidentVramGb,
  aceStepVramHeadroomGb,
} from "./lifecycle.js";
import {
  isAceHostedAudioUrl,
  ensureAceStepStyleReference,
} from "./gradio.js";
import {
  isAceNanLatentsError,
  isAceVramError,
  isAceNoiseWallError,
  isUnusableAceReferenceError,
} from "./errors.js";
import { probeAceNoiseWall } from "./noiseProbe.js";
import {
  normalizeFeatArtist,
  vocalLockForArtist,
} from "../../lib/featArtist.js";

export async function startAceStep(keys, {
  prompt,
  lyrics,
  title,
  language,
  bpm,
  preview = false,
  referenceAudioUrl,
  referenceAudioTitle,
  styleLock,
  artist = null,
  audioCoverStrength,
  forceModelId = null,
  /** Lab : style/lyrics bruts, sans compose duo / DNA artiste. */
  labMode = false,
  durationSec = undefined,
  /** Lab : overrides optionnels (steps, CFG, noise…). null/undefined = auto DiT. */
  labOverrides = null,
} = {}) {
  const base = resolveAceStepBaseUrl(keys);
  let info = await testAceStep(keys);
  if (info.loading) {
    const target = info.loadingModel || String(keys?.aceStepPreferredModel || "").trim();
    console.info(
      `[acestep] attente fin de chargement (${aceStepModelLabel(target || "DiT")})…`,
    );
    if (target) await waitForAceStepModel(keys, target);
    info = await testAceStep(keys);
  }
  if (info.pipelineUp === false && !info.loading) {
    throw new Error(
      info.message ||
        `Moteur ACE-Step down (${base}). Pinokio : Stop puis Start (No LM si Sonozz).`,
    );
  }
  const catalog = { models: info.models, activeModel: info.activeModel };
  const featNorm = labMode ? null : normalizeFeatArtist(artist?.featArtist);
  const duo = Boolean(featNorm?.name);
  const leadLock = duo ? vocalLockForArtist(artist) : null;
  const featLock = duo ? vocalLockForArtist(featNorm) : null;
  const sameSexDuo = Boolean(
    leadLock?.genderCode &&
      featLock?.genderCode &&
      leadLock.genderCode === featLock.genderCode,
  );
  // Complet : SFT XL = mur de bruit récurrent sur ce GPU malgré params OK.
  // Préférence SFT ignorée en pipeline → Turbo. Lab / forceAceModelId pour forcer SFT.
  const preferredRaw = labMode
    ? null
    : String(keys?.aceStepPreferredModel || "").trim() || null;
  const skipSftPreferred =
    Boolean(preferredRaw) &&
    isAceStepSftModel(preferredRaw) &&
    !labMode &&
    !forceModelId &&
    !preview;
  if (skipSftPreferred) {
    console.warn(
      "[acestep] préférence SFT ignorée en Complet (mur de bruit récurrent) → Turbo. Lab pour tester SFT.",
    );
  }
  let pick = pickAceStepModel(catalog, {
    preferredId: skipSftPreferred ? null : preferredRaw,
    duo,
    sameSexDuo,
    preferTurbo: skipSftPreferred ? true : undefined,
    preview: Boolean(preview) && !labMode,
    forceModelId,
  });
  let pickReason = pick.reason;
  if (skipSftPreferred && /turbo/i.test(String(pick.modelId || ""))) {
    pickReason = `pipeline · ${aceStepModelLabel(pick.modelId)} (SFT contourné)`;
  }
  let active = String(catalog.activeModel || "").trim();
  let wantSft = isAceStepSftModel(pick.modelId) && !labMode;

  // Caption LLM AVANT l’arbiter SFT (qui stoppe LLM/Wan local).
  let styleCaption = null;
  if (!labMode) {
    styleCaption = await resolveAceStepStyleCaption(keys, {
      style: prompt,
      language,
      styleLock,
      artist,
      featArtist: artist?.featArtist,
      lyrics,
      preview,
      labMode: false,
    });
    console.info(
      "[acestep] style",
      styleCaption.source,
      `${styleCaption.style.length}c`,
      styleCaption.source === "llm"
        ? "compressed"
        : styleCaption.source === "cache"
          ? "hit"
          : "no-llm",
    );
  }

  // SFT : file d’attente arbitre + stop LLM/Wan pour libérer la VRAM avant le switch DiT.
  if (wantSft) {
    let slot = await ensureAceGpuSlot(keys, {
      timeoutMs: 300_000,
      exclusive: true,
    });
    if (slot.steam || /steam/i.test(String(slot.error || ""))) {
      throw new Error(
        slot.error ||
          "GPU prioritaire Steam — l’arbitre bloque ACE. Ferme le jeu puis réessaie.",
      );
    }
    // Arbiter down / skip : on continue en SFT (ACE souvent déjà up via tunnel).
    if (slot.arbiterDown || (slot.skipped && slot.ok)) {
      console.warn(
        "[acestep] SFT sans exclusif arbiter —",
        slot.data?.message || slot.error || "bypass",
        "· libération VRAM locale…",
      );
      try {
        await ensureAceStepVram(keys, { modelId: pick.modelId, skipSwitch: true });
      } catch (e) {
        console.warn("[acestep] libération VRAM:", e?.message || e);
      }
    } else if (!slot.ok && !slot.skipped) {
      console.warn("[acestep] acquire exclusif SFT (1/2):", slot.error || slot.data);
      await new Promise((r) => setTimeout(r, 4000));
      slot = await ensureAceGpuSlot(keys, {
        timeoutMs: 180_000,
        exclusive: true,
      });
      if (slot.arbiterDown || (slot.skipped && slot.ok)) {
        console.warn("[acestep] SFT sans exclusif arbiter (retry) — on continue");
      } else if (!slot.ok && !slot.skipped) {
        // Refus explicite arbiter (pas un réseau down) → erreur claire.
        throw new Error(
          `SFT : arbitre GPU a refusé l’exclusif (${String(slot.error || slot.data || "?").slice(0, 160)}). ` +
            `Libère Steam/LLM/Wan ou corrige l’arbiter. Pas de bascule Turbo.`,
        );
      } else {
        console.info(
          "[acestep] GPU arbiter SFT…",
          slot.data?.message || "ok",
          slot.data?.vram_used_mib != null ? `· ${slot.data.vram_used_mib} MiB` : "",
        );
      }
    } else {
      console.info(
        "[acestep] GPU arbiter SFT…",
        slot.data?.message || "ok",
        slot.data?.vram_used_mib != null ? `· ${slot.data.vram_used_mib} MiB` : "",
      );
    }

    // Avant switch : assez de free pour CHARGER SFT (≥14).
    // Si SFT déjà résident (~12 Go used) : seulement la marge diffusion (headroom).
    const loadFreeMin = 14;
    const residentMin = aceStepMinResidentVramGb(pick.modelId);
    const headroomMin = aceStepVramHeadroomGb(pick.modelId);
    let freeGb = null;
    let usedGb = null;
    for (let i = 0; i < 30; i++) {
      const g = await readAceStepGpu(keys);
      freeGb = g.freeGb;
      usedGb = g.usedGb;
      const resident = usedGb != null && usedGb >= residentMin;
      if (resident) {
        if (freeGb != null && freeGb >= headroomMin) break;
      } else if (freeGb != null && freeGb >= loadFreeMin) {
        break;
      }
      if (i === 10 || i === 20) {
        try {
          await ensureAceStepVram(keys, {
            modelId: pick.modelId,
            skipSwitch: true,
          });
        } catch (e) {
          console.warn("[acestep] libération VRAM SFT:", e?.message || e);
        }
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const resident = usedGb != null && usedGb >= residentMin;
    if (resident) {
      if (freeGb != null && freeGb < headroomMin) {
        throw new Error(
          `SFT : marge VRAM trop juste (libre ${freeGb} Go < ${headroomMin}). ` +
            `Stoppe LiteLLM / autres apps GPU sur https://gpu.briseteia.me puis relance.`,
        );
      }
    } else if (freeGb != null && freeGb < loadFreeMin) {
      throw new Error(
        `SFT refusé : seulement ${freeGb} Go libres pour charger (cible ≥${loadFreeMin}). ` +
          `Sur https://gpu.briseteia.me clique Release / stoppe LiteLLM, Pinokio No LM, puis relance.`,
      );
    }
  }

  // SFT déjà « actif » mais fantôme (offload) → forcer re-pin GPU.
  let forceRepin = false;
  if (wantSft && pick.modelId) {
    const g0 = await readAceStepGpu(keys);
    const st0 = await testAceStep(keys, { ensure: false }).catch(() => null);
    if (
      aceStepDitSame(active, pick.modelId) &&
      isAceStepGhostLoad(g0, pick.modelId, { offloadToCpu: st0?.offloadToCpu })
    ) {
      forceRepin = true;
      console.warn(
        `[acestep] SFT déjà actif mais fantôme (~${g0.usedGb} Go) — re-pin GPU…`,
      );
    }
  }

  const needSwitch =
    Boolean(pick.modelId && active && !aceStepDitSame(pick.modelId, active)) || forceRepin;
  if (needSwitch) {
    try {
      const probe = await testAceStep(keys);
      if (probe.pipelineUp === false) {
        throw new Error(
          "Moteur ACE-Step down (Gradio). Pinokio : Stop → Start (No LM), charge ton modèle, réessaie.",
        );
      }
      console.info(
        `[acestep] chargement ${aceStepModelLabel(pick.modelId)} (peut prendre plusieurs minutes)…`,
      );
      await switchAceStepModel(keys, pick.modelId, {
        offloadToCpu: false,
        offloadDitToCpu: false,
      });
    } catch (e) {
      // Timeout fréquent pendant load SFT : Studio mute mais continue côté GPU.
      console.warn("[acestep] switch-model:", e.message);
      if (/ne répond plus|ECONNREFUSED/i.test(e.message)) throw e;
      if (
        /Moteur ACE-Step down/i.test(e.message) &&
        !/délai dépassé|injoignable/i.test(e.message)
      ) {
        throw e;
      }
      const waited = await waitForAceStepModel(keys, pick.modelId);
      if (waited.ok) {
        console.info(`[acestep] ${aceStepModelLabel(pick.modelId)} Ready après attente`);
        active = waited.activeModel || pick.modelId;
      } else {
        throw new Error(
          `Modèle demandé « ${aceStepModelLabel(pick.modelId)} » pas chargé ` +
            `(actif : ${aceStepModelLabel(active) || "?"}). ` +
            `Gradio ignore ditModel à la génération — lancer avec un autre DiT produit de l’audio inaudible. ` +
            `Bascule le modèle dans le lab (ou ACE Studio) puis réessaie. ` +
            `(${String(waited.message || e.message).slice(0, 120)})`,
        );
      }
    }
    // Ready ≠ VRAM résidente — sans poids GPU = mur de bruit quasi sûr.
    if (wantSft) {
      const resident = await waitForAceStepResidentVram(keys, pick.modelId, {
        budgetMs: 180_000,
      });
      if (!resident.ok) {
        throw new Error(
          resident.message ||
            `SFT pas résident GPU (seuil ≥${aceStepMinResidentVramGb(pick.modelId)} Go). ` +
              `Relance ACE / Release sur l’arbitre, puis réessaie.`,
        );
      }
    }
  }

  // Re-probe : les steps / CFG doivent suivre le DiT ACTIF, pas la préférence seule.
  try {
    const after = await testAceStep(keys, { ensure: false });
    active = String(after?.activeModel || active || "").trim();
  } catch {
    /* keep active */
  }
  if (pick.modelId && active && !aceStepDitSame(pick.modelId, active)) {
    throw new Error(
      `DiT demandé « ${aceStepModelLabel(pick.modelId)} » mais ACE a « ${aceStepModelLabel(active)} ». ` +
        `Refuse de générer (évite 50 steps SFT sur poids Turbo → bouillie). ` +
        `Clique « Charger ce modèle » dans /lab/ace et attends Ready.`,
    );
  }
  let effectiveModelId = active || pick.modelId;

  // Préflight VRAM + porte SFT : fantôme → erreur claire (plus de fallback Turbo silencieux).
  try {
    const vram = await ensureAceStepVram(keys, {
      modelId: effectiveModelId,
      skipSwitch: true,
    });
    if (vram.ghost) {
      throw new Error(
        vram.message ||
          `DiT ACE en offload CPU (~${vram.gpu?.usedGb ?? "?"} Go). ` +
            `Pas de fallback Turbo — charge ${aceStepModelLabel(effectiveModelId)} en GPU ` +
            `(ACESTEP_OFFLOAD_TO_CPU=0, seuil ≥${aceStepMinResidentVramGb(effectiveModelId)} Go).`,
      );
    }
    if (vram.message) console.warn("[acestep]", vram.message);
  } catch (e) {
    if (/offload CPU|modèle fantôme|pas résident|ACESTEP_OFFLOAD/i.test(String(e?.message || e))) {
      throw e;
    }
    console.warn("[acestep] préflight VRAM ignoré:", e?.message || e);
  }

  if (duo) {
    console.info("[acestep] duo — modèle", effectiveModelId, pickReason);
  } else {
    console.info("[acestep] modèle", effectiveModelId, pickReason);
  }

  let refUrl = String(referenceAudioUrl || "").trim();
  if (isAceHostedAudioUrl(base, refUrl)) refUrl = "";
  if (/^https?:\/\//i.test(refUrl)) {
    try {
      refUrl = (await ensureAceStepStyleReference(keys, refUrl)) || "";
    } catch (e) {
      console.warn("[acestep] preview référence ignoré:", e.message);
      refUrl = "";
    }
  } else {
    refUrl = "";
  }
  if (isAceHostedAudioUrl(base, refUrl)) refUrl = "";

  let body;
  if (labMode) {
    body = buildLabAceStepBody({
      title,
      style: prompt,
      lyrics,
      language,
      bpm,
      preview,
      durationSec,
      referenceAudioUrl: refUrl,
      referenceAudioTitle,
      audioCoverStrength,
      modelId: effectiveModelId,
      overrides: labOverrides,
    });
  } else {
    const caption =
      styleCaption ||
      (await resolveAceStepStyleCaption(keys, {
        style: prompt,
        language,
        styleLock,
        artist,
        featArtist: artist?.featArtist,
        lyrics,
        preview,
        labMode: false,
      }));
    body = buildAceStepBody({
      title,
      style: prompt,
      lyrics,
      language,
      bpm,
      durationSec: preview ? 30 : undefined,
      modelId: effectiveModelId,
      preview,
      referenceAudioUrl: refUrl,
      referenceAudioTitle,
      audioCoverStrength,
      studioBase: base,
      styleLock,
      artist,
      featArtist: artist?.featArtist,
      styleOverride: caption.style,
    });
    if (body && typeof body === "object") {
      body._styleSource = caption.source;
    }
    if (!styleCaption) {
      console.info(
        "[acestep] style",
        caption.source,
        `${caption.style.length}c`,
        caption.source === "llm"
          ? "compressed"
          : caption.source === "cache"
            ? "hit"
            : "no-llm",
      );
    }
  }

  console.info(
    "[acestep] start…",
    base,
    body.title,
    preview ? "PREVIEW" : "FULL",
    labMode ? "LAB" : "pipeline",
    `model=${effectiveModelId}`,
    `pick=${pickReason}`,
    `active=${active || "?"}`,
    `steps=${body.inferenceSteps}`,
    `cfg=${body.guidanceScale}`,
    `shift=${body.shift ?? ACE_TIMESTEP_SHIFT}`,
    `lang=${body.vocalLanguage}`,
    `dur=${body.duration}s`,
    `bpm=${body.bpm || "?"}`,
    `task=${body.taskType || "text2music"}`,
    `str=${body.audioCoverStrength ?? "-"}`,
    body.sourceAudioUrl ? "src=ON" : "src=OFF",
    refUrl ? `ref=${String(referenceAudioTitle || "").slice(0, 40) || "audio"}` : "ref=OFF",
    `caption=${String(body.style || "").slice(0, 120).replace(/\s+/g, " ")}…`,
  );

  let created;
  try {
    created = await withAuth(base, (token) =>
      aceFetch(base, "/api/generate", { method: "POST", token, body, timeoutMs: 90_000 }),
    );
  } catch (e) {
    const msg = String(e?.message || e);
    const code = Number(e?.status) || 0;
    // Arbiter /ensure pouvait restart ACE mid-POST → 502/503. Un retry après Ready.
    if (code === 502 || code === 503 || /HTTP 502|HTTP 503|Bad Gateway/i.test(msg)) {
      console.warn("[acestep] generate", code || "5xx", "— attente ACE + retry…");
      await wakeAceStepPipeline(keys, { budgetMs: 90_000 }).catch(() => null);
      await new Promise((r) => setTimeout(r, 4000));
      const again = await testAceStep(keys, { ensure: false }).catch(() => null);
      if (again?.pipelineUp === false) throw e;
      created = await withAuth(base, (token) =>
        aceFetch(base, "/api/generate", { method: "POST", token, body, timeoutMs: 90_000 }),
      );
    } else {
      throw e;
    }
  }
  const jobId = created?.jobId || created?.job_id;
  if (!jobId) throw new Error("ACE-Step n’a pas renvoyé de jobId");
  const gpu = await readAceStepGpu(keys).catch(() => null);
  const aceGen = snapshotAceGenParams(body, {
    modelId: effectiveModelId,
    pickReason,
    gpu,
    lab: labMode,
    duo,
    styleSource: body._styleSource || null,
  });
  return {
    generationId: jobId,
    provider: "acestep-studio",
    base,
    model: effectiveModelId,
    quality: aceStepModelLabel(effectiveModelId),
    pickReason,
    gpu: gpu?.freeGb != null ? gpu : null,
    usedReference: Boolean(body.referenceAudioUrl),
    referenceAudioTitle: body.referenceAudioTitle || null,
    aceGen,
  };
}

function durationLabelFrom(secs) {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `~${Math.round(n / 60)}:${String(Math.round(n % 60)).padStart(2, "0")}`;
}

export async function pollAceStep(keys, generationId) {
  const base = resolveAceStepBaseUrl(keys);
  const jobId = String(generationId || "").trim();
  if (!jobId) throw new Error("generationId ACE-Step manquant");

  let status;
  try {
    status = await withAuth(base, (token) =>
      aceFetch(base, `/api/generate/status/${encodeURIComponent(jobId)}`, { token }),
    );
  } catch (e) {
    const code = Number(e?.status) || 0;
    const msg = String(e?.message || "");
    if (
      code === 404 ||
      code === 409 ||
      /HTTP 404|not found|unknown job|no such job/i.test(msg)
    ) {
      return {
        done: false,
        status: "queued",
        message: "Job ACE-Step pas encore visible — on réessaie…",
        generationId: jobId,
      };
    }
    throw e;
  }
  const st = String(status?.status || "").toLowerCase();
  if (st === "succeeded" || st === "completed" || st === "success") {
    const rawUrl = firstAudioUrl(status?.result);
    const url = resolveAceAudioUrl(base, rawUrl);
    if (!url) throw new Error("ACE-Step terminé sans URL audio");
    const secs = Number(status?.result?.duration);
    const durationLabel = durationLabelFrom(secs) || "~2–4 min";
    console.info("[acestep] OK", jobId, url);
    try {
      const probe = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      if (!probe.ok) {
        const get = await fetch(url, {
          headers: { Range: "bytes=0-64" },
          signal: AbortSignal.timeout(8000),
        });
        if (!get.ok) throw new Error(`Audio ACE-Step HTTP ${get.status} — fichier pas encore prêt ?`);
      }
    } catch (e) {
      if (/Audio ACE-Step/i.test(String(e?.message || ""))) throw e;
      console.warn("[acestep] probe audio:", e?.message || e);
    }
    return {
      done: true,
      status: st,
      url,
      provider: "acestep-studio",
      durationLabel,
      hasVocals: true,
      generationId: jobId,
    };
  }
  if (st === "failed" || st === "cancelled" || st === "canceled" || st === "error") {
    const raw = String(status?.error || status?.message || `Génération ACE-Step ${st}`);
    if (isAceNanLatentsError(raw)) {
      throw new Error(
        `ACE_NAN_LATENTS: Génération NaN (souvent XL SFT corrompu / offload foireux / VRAM saturée). Relance en Turbo BF16. Détail: ${raw.slice(0, 220)}`,
      );
    }
    if (isAceVramError(raw)) {
      throw new Error(`VRAM insuffisante — ${raw.slice(0, 280)}`);
    }
    if (isUnusableAceReferenceError(raw)) {
      throw new Error(
        "ACE_REF_UNUSABLE: ACE-Step a rejeté l’audio de référence (invalide, illisible ou silencieux). Relance sans cover.",
      );
    }
    throw new Error(raw);
  }
  const eta = Number(status?.etaSeconds);
  const gpu = await readAceStepGpu(keys).catch(() => null);
  const stage = status?.stage || null;
  const rawMsg = status?.stage || status?.message || "";
  return {
    done: false,
    status: st || "processing",
    progress: status?.progress,
    message: rawMsg,
    stage,
    gpu: gpu?.freeGb != null ? gpu : null,
    elapsedSeconds: 0,
    estimatedSeconds: Number.isFinite(eta) ? eta : 0,
    generationId: jobId,
  };
}

export async function cancelAceStep(keys, generationId) {
  const base = resolveAceStepBaseUrl(keys);
  const jobId = String(generationId || "").trim();
  if (!jobId) return { ok: false, skipped: true };
  try {
    await withAuth(base, (token) =>
      aceFetch(base, `/api/generate/cancel/${encodeURIComponent(jobId)}`, {
        method: "POST",
        token,
      }),
    );
    return { ok: true, skipped: false };
  } catch (e) {
    return { ok: false, skipped: true, message: e.message };
  }
}

export async function generateMusicWithAceStep(keys, opts = {}) {
  const run = (extra = {}) => generateMusicWithAceStepOnce(keys, { ...opts, ...extra });
  try {
    return await run();
  } catch (e) {
    if (isUnusableAceReferenceError(e) && opts.referenceAudioUrl) {
      console.warn("[acestep] réf. rejetée — retry sans cover");
      return run({ referenceAudioUrl: "" });
    }
    if (
      (isAceNanLatentsError(e) || isAceVramError(e) || isAceNoiseWallError(e)) &&
      String(opts.forceModelId || "") !== ACE_FALLBACK_LIGHT_MODEL
    ) {
      console.warn(
        "[acestep]",
        isAceNoiseWallError(e) ? "mur de bruit SFT" : "NaN/VRAM",
        "— retry Turbo BF16:",
        e.message,
      );
      try {
        await switchAceStepModel(keys, ACE_FALLBACK_LIGHT_MODEL);
      } catch (sw) {
        console.warn("[acestep] switch Turbo BF16:", sw.message);
      }
      return run({
        forceModelId: ACE_FALLBACK_LIGHT_MODEL,
        referenceAudioUrl: "",
        skipNoiseProbe: true,
      });
    }
    throw e;
  }
}

async function generateMusicWithAceStepOnce(keys, opts = {}) {
  const started = await startAceStep(keys, opts);
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const tick = await pollAceStep(keys, started.generationId);
    if (tick.done) {
      const usedSft =
        isAceStepSftModel(started.model) && !opts.labMode && !opts.skipNoiseProbe;
      if (usedSft && tick.url) {
        try {
          const probe = await probeAceNoiseWall(keys, tick.url);
          if (probe?.noiseWall) {
            console.warn(
              "[acestep] probe mur de bruit SFT:",
              probe.reason || "noiseWall=true",
            );
            throw new Error(
              `ACE_NOISE_WALL: SFT a renvoyé un mur de bruit (${probe.reason || "inutilisable"}). Retry Turbo BF16.`,
            );
          }
          if (probe) {
            console.info("[acestep] probe audio OK (pas de mur de bruit)");
          }
        } catch (e) {
          if (isAceNoiseWallError(e)) throw e;
          console.warn("[acestep] probe audio ignoré:", e?.message || e);
        }
      }
      return {
        url: tick.url,
        provider: tick.provider,
        durationLabel: tick.durationLabel || "~2–4 min",
        hasVocals: Boolean(tick.hasVocals),
        generationId: started.generationId,
        aceGen: started.aceGen || null,
        model: started.model || null,
      };
    }
    if (i % 10 === 0) {
      console.info("[acestep] poll", started.generationId, tick.status, tick.progress ?? "?", tick.message || "");
    }
  }
  throw new Error("Timeout ACE-Step Studio (~20 min) — vérifie GPU / Pinokio.");
}
