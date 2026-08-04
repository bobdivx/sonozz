/**
 * Client Wan2GP (Pinokio / Demeter) via Gradio HTTP.
 * Génération image→vidéo (portrait artiste) puis mux audio côté ClipStep.
 * @see https://github.com/deepbeepmeep/Wan2GP
 */

import { Client, handle_file } from "@gradio/client";
import { isS3Configured, uploadClipBuffer } from "./s3.js";
import { isUsableRasterImage } from "./imagePersist.js";

const DEFAULT_BASE = "http://127.0.0.1:7860";
const jobs = new Map();

export function resolveWan2gpBaseUrl(keys) {
  const raw = keys?.wan2gpBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

function errText(err) {
  return String(err?.message || err || "");
}

export function buildWan2gpPrompt({
  artist,
  track,
  social,
  lyrics,
  audioBrief,
  shotIndex = 0,
  shotBrief,
} = {}) {
  const vi = artist?.visualIdentity || {};
  const mood = audioBrief?.mood || track?.mood || artist?.mood || "emotional";
  const energy = audioBrief?.energy || "mid";
  const genre = audioBrief?.genreFeel || track?.style || artist?.genre || "pop";
  const title = String(track?.title || lyrics?.title || "single").slice(0, 60);

  const focus = shotBrief
    ? [
        `SHORT CLIP ${Number(shotBrief.index || shotIndex) + 1} only — one musical phrase.`,
        `Framing: ${shotBrief.shotType || "cinematic mid shot"}.`,
        shotBrief.lyricPhrase
          ? `Illustrate this lyric moment as imagery only (no captions): "${String(shotBrief.lyricPhrase).slice(0, 120)}".`
          : "",
        shotBrief.sceneHint ? `Director beat: ${String(shotBrief.sceneHint).slice(0, 160)}.` : "",
      ]
        .filter(Boolean)
        .join(" ")
    : (() => {
        const beat =
          (Array.isArray(audioBrief?.visualBeats) && audioBrief.visualBeats[shotIndex]) ||
          (social?.scenes || [])[shotIndex] ||
          "wide cinematic establishing shot — lyric metaphor, no singing face";
        return `Scene beat: ${String(beat).slice(0, 160)}.`;
      })();

  return [
    `Photorealistic live-action music video B-roll, vertical 9:16 TikTok, full bleed, no letterboxing.`,
    `Energy: ${genre}, ${mood}, ${energy}. Song "${title}".`,
    focus,
    `Look: ${vi.look || mood}; wardrobe ${vi.wardrobe || "contemporary stage outfit"}; ${vi.photographyStyle || "shallow depth of field, film grain"}.`,
    `CRITICAL: NO lip-sync, NO singing mouth, NO karaoke face, NO on-screen text, NO logos, NO watermarks.`,
    `Prefer cutaways, silhouette, hands, atmosphere, profile — cinematic motion, subtle camera move.`,
  ].join(" ");
}

async function connectClient(baseUrl) {
  try {
    return await Client.connect(baseUrl);
  } catch (e) {
    throw new Error(
      `Wan2GP injoignable (${baseUrl}). Start Wan2GP dans Pinokio (Home Server) et colle l’URL LAN. ${errText(e).slice(0, 140)}`,
    );
  }
}

function listNamedEndpoints(api) {
  const named = api?.named_endpoints || {};
  return Object.entries(named).map(([name, info]) => ({ name, info }));
}

function paramName(p) {
  return String(p?.parameter_name || p?.label || "").trim();
}

function paramType(p) {
  return String(p?.python_type?.type || p?.type || "");
}

/** Null sûr pour champs média Gradio requis (vidéo / image / filepath). */
function emptyMediaValue(typeStr = "") {
  const t = String(typeStr);
  if (/dict\(video:/i.test(t)) return null;
  if (/filepath/i.test(t) && !/dict\(/i.test(t)) return null;
  if (/dict\(background:/i.test(t)) return null; // image_mask_guide
  if (/dict\(path:/i.test(t)) return null; // FileData image
  if (/Literal\[\]/.test(t)) return null;
  if (/^list\[/i.test(t)) return [];
  return null;
}

/**
 * Payload nommé pour /save_inputs.
 * - Inclut tous les params nommés (Gradio exige ceux sans default, ex. image_mask_guide).
 * - Omet les State (parameter_name null).
 * - Clear explicite Start Image (sinon queue vide).
 * - Ne force PAS resolution / video_length (casse validate_settings selon le modèle).
 */
function buildSaveInputsArgs(endpointInfo, { prompt, imageHandle, clientId }) {
  const params = Array.isArray(endpointInfo?.parameters) ? endpointInfo.parameters : [];
  const hasImage = Boolean(imageHandle);
  const overrides = {
    target: "state",
    prompt: sanitizeWan2gpPrompt(prompt),
    client_id: clientId || `sonozz_${Date.now().toString(36)}`,
    image_prompt_type: hasImage ? "S" : "",
    image_start: hasImage ? [{ image: imageHandle, caption: null }] : [],
    image_end: [],
    image_refs: [],
    video_prompt_type: "",
    mode: "",
    image_mode: 0,
    multi_prompts_gen_type: "G",
  };

  const payload = {};
  for (const p of params) {
    const n = p.parameter_name;
    if (!n) continue;
    if (Object.prototype.hasOwnProperty.call(overrides, n)) {
      payload[n] = overrides[n];
    } else if (p.parameter_has_default) {
      payload[n] = p.parameter_default;
    } else {
      payload[n] = emptyMediaValue(paramType(p));
    }
  }
  return payload;
}

/** Évite caractères qui cassent parfois le prompt_parser Wan2GP. */
function sanitizeWan2gpPrompt(prompt) {
  return String(prompt || "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);
}

function resolveModelChoice(api, modelChoice) {
  const fromKey = String(modelChoice || "").trim();
  if (fromKey) return fromKey;
  const add = api?.named_endpoints?.["/process_prompt_and_add_tasks"];
  const p = (add?.parameters || []).find((x) => x.parameter_name === "model_choice");
  return String(p?.parameter_default || "t2v").trim() || "t2v";
}

/** Named kwargs only — ne jamais envoyer state=null. */
async function validateWizardPrompt(client, api, prompt) {
  const validateInfo = api.named_endpoints["/validate_wizard_prompt"];
  if (!validateInfo) return;
  const text = sanitizeWan2gpPrompt(prompt);
  const vNamed = {};
  for (const p of validateInfo.parameters || []) {
    const n = p.parameter_name;
    if (!n) continue;
    if (n === "wizard_prompt_activated") vNamed[n] = "off";
    else if (n === "wizard_variables_names") vNamed[n] = "";
    else if (n === "prompt" || n === "wizard_prompt") vNamed[n] = text;
    else if (p.parameter_has_default) vNamed[n] = p.parameter_default;
    else vNamed[n] = "";
  }
  await predictSafe(client, "/validate_wizard_prompt", vNamed);
}

/** Télécharge le portrait côté sonozz puis le pousse à Gradio (Demeter ne voit pas localhost). */
async function uploadImageForGradio(imageUrl) {
  if (!imageUrl) return null;
  try {
    const res = await fetch(imageUrl, {
      headers: { Accept: "image/*,*/*" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error("image trop petite");
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim().toLowerCase();
    let ext = "jpg";
    let mime = "image/jpeg";
    if (/png/.test(ct) || /\.png(\?|$)/i.test(imageUrl)) {
      ext = "png";
      mime = "image/png";
    } else if (/webp/.test(ct) || /\.webp(\?|$)/i.test(imageUrl)) {
      ext = "webp";
      mime = "image/webp";
    } else if (/gif/.test(ct)) {
      ext = "gif";
      mime = "image/gif";
    }
    // Gradio exige une extension reconnue dans le nom de fichier
    const file = new File([buf], `portrait.${ext}`, { type: mime });
    return handle_file(file);
  } catch (e) {
    console.warn("[wan2gp] download portrait failed:", e.message);
    return null;
  }
}

function hasQueueApi(api) {
  const named = api?.named_endpoints || {};
  return Boolean(named["/save_inputs"] && named["/process_prompt_and_add_tasks"]);
}

function absolutizeMediaUrl(raw, baseUrl) {
  const s = String(raw || "").trim();
  if (!s || /\s/.test(s) || /<[^>]+>/.test(s) || s.length > 800) return null;
  if (/\.(svg|png|jpe?g|gif|webp|ico)(\?|$)/i.test(s)) return null;
  if (/\/icons\//i.test(s)) return null;
  if (!/\.(mp4|webm|mov)(\?|$)/i.test(s) && !/\/file[=/][^\s"'<>]+\.(mp4|webm|mov)/i.test(s)) {
    return null;
  }
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return `${baseUrl}${s}`;
  return `${baseUrl}/${s.replace(/^\.\//, "")}`;
}

function collectVideoUrls(data, baseUrl) {
  const found = [];
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || seen.has(cur)) continue;
    if (typeof cur === "object") seen.add(cur);

    if (typeof cur === "string") {
      // Extraire les URLs vidéo d’un blob (évite de prendre tout le HTML queue pour une URL)
      const re =
        /(?:https?:\/\/[^\s"'<>]+|(?:\/gradio_api)?\/file(?:=|\/)[^\s"'<>]+|\.?\/?[^\s"'<>]+)\.(?:mp4|webm|mov)(?:\?[^\s"'<>]*)?/gi;
      const hits = cur.match(re) || [];
      if (hits.length) {
        for (const h of hits) {
          const url = absolutizeMediaUrl(h, baseUrl);
          if (url && !found.includes(url)) found.push(url);
        }
      } else {
        const url = absolutizeMediaUrl(cur, baseUrl);
        if (url && !found.includes(url)) found.push(url);
      }
      continue;
    }
    if (Array.isArray(cur)) {
      for (const x of cur) stack.push(x);
      continue;
    }
    if (typeof cur === "object") {
      if (typeof cur.url === "string") stack.push(cur.url);
      if (typeof cur.path === "string") stack.push(cur.path);
      if (typeof cur.video === "object") stack.push(cur.video);
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return found;
}

function extractVideoUrl(data, baseUrl) {
  const urls = collectVideoUrls(data, baseUrl);
  return urls[0] || null;
}

async function persistVideoIfPossible(videoUrl, projectId) {
  if (!isS3Configured()) return { url: videoUrl };
  try {
    const res = await fetch(videoUrl, {
      headers: { Accept: "video/*,application/octet-stream,*/*" },
    });
    if (!res.ok) return { url: videoUrl };
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1000) return { url: videoUrl };
    const uploaded = await uploadClipBuffer(buffer, {
      projectId: projectId || "wan2gp",
      mimeType: "video/mp4",
      key: `tmp/wan2gp/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
    });
    return { url: uploaded.url, s3Key: uploaded.key };
  } catch {
    return { url: videoUrl };
  }
}

async function predictSafe(client, endpoint, data = {}) {
  try {
    return await client.predict(endpoint, data);
  } catch (e) {
    const detail =
      e?.message ||
      e?.error ||
      e?.detail ||
      (typeof e === "string" ? e : "") ||
      errText(e);
    // Gradio enveloppe souvent { type, message, ... }
    const nested =
      e?.data?.error ||
      e?.data?.message ||
      (Array.isArray(e?.data) ? e.data.map((x) => x?.message || x).join("; ") : "");
    throw new Error(`Wan2GP ${endpoint}: ${String(nested || detail || "erreur").slice(0, 400)}`);
  }
}

async function pollGalleryForNewVideo(
  client,
  baseUrl,
  { beforeUrls = [], maxPolls = 900, emptyQueueFailAfter = 30 } = {},
) {
  const before = new Set(beforeUrls);
  let emptyStreak = 0;
  let sawQueuedWork = false;
  for (let i = 0; i < maxPolls; i++) {
    let statusText = "";
    try {
      const st = await predictSafe(client, "/refresh_status_async", {});
      statusText = String(st?.data?.[0] ?? st?.data ?? "");
    } catch {
      /* status optionnel */
    }

    let galleryData = null;
    try {
      const gal = await predictSafe(client, "/refresh_gallery", {});
      galleryData = gal?.data ?? gal;
    } catch (e) {
      if (i === 0) console.warn("[wan2gp] refresh_gallery:", e.message);
    }

    const urls = collectVideoUrls(galleryData, baseUrl);
    const fresh = urls.find((u) => !before.has(u));
    if (fresh) return { videoUrl: fresh, statusText, urls };

    const galStr = JSON.stringify(galleryData ?? "");
    if (/queue-scroll-container/i.test(galStr) && !/Queue is empty/i.test(galStr)) {
      sawQueuedWork = true;
      emptyStreak = 0;
    } else if (
      sawQueuedWork &&
      /Queue is empty/i.test(galStr) &&
      !/processing|generat|pending|queued|loading|download/i.test(statusText)
    ) {
      emptyStreak += 1;
      if (emptyStreak >= emptyQueueFailAfter) {
        throw new Error(
          "Queue Wan2GP vidée sans vidéo — la génération a peut‑être échoué (VRAM / toasts Demeter).",
        );
      }
    } else {
      emptyStreak = 0;
    }

    if (/fail|error|abort/i.test(statusText) && !/queued|pending|generat|process|load/i.test(statusText)) {
      throw new Error(`Wan2GP status: ${statusText.slice(0, 200)}`);
    }

    if (i % 5 === 0) {
      console.info("[wan2gp] poll gallery", i, statusText.slice(0, 80) || "(no status)", `videos=${urls.length}`);
    }
    await new Promise((r) => setTimeout(r, 8_000));
  }
  throw new Error("Timeout Wan2GP gallery (~2 h) — vérifie GPU / queue Gradio sur Demeter.");
}

function isQueueEmptyPayload(data) {
  const s = JSON.stringify(data ?? "");
  if (/Queue is empty/i.test(s)) return true;
  // Réponse vide Gradio (validate_settings a échoué silencieusement)
  if (/^\[(\{"__type__":"update"\},?)+\]$/.test(s.replace(/\s/g, ""))) return true;
  return false;
}

function isQueueSuccessPayload(data) {
  const s = JSON.stringify(data ?? "");
  return /queue-scroll-container/i.test(s) && !/Queue is empty/i.test(s);
}

/**
 * Flux officiel Wan2GP Gradio :
 * save_inputs → process_prompt_and_add_tasks → process_tasks → refresh_gallery
 */
async function runGradioGeneration({ baseUrl, prompt, imageUrl, projectId, modelChoice = "t2v" }) {
  const client = await connectClient(baseUrl);
  const api = await client.view_api();

  if (!hasQueueApi(api)) {
    throw new Error(
      "Wan2GP sans /save_inputs — version incompatible. Mets à jour Wan2GP (Morpheus / deepbeepmeep).",
    );
  }

  const saveInfo = api.named_endpoints["/save_inputs"];
  // T2V uniquement : Start Image (I2V) est refusé par le modèle t2v Demeter.
  // Le portrait reste utile dans le prompt / UI ; pas envoyé comme image_start.
  const modes = [{ label: "t2v", imageHandle: null }];

  let beforeUrls = [];
  try {
    const gal0 = await predictSafe(client, "/refresh_gallery", {});
    beforeUrls = collectVideoUrls(gal0?.data ?? gal0, baseUrl);
  } catch {
    /* ignore */
  }

  const model = resolveModelChoice(api, modelChoice);

  // Nettoyage session (edit lock / gen coincé) AVANT d’ajouter à la queue
  for (const ep of ["/silent_cancel_edit", "/cancel_edit", "/abort_generation"]) {
    if (api.named_endpoints[ep]) {
      try {
        await predictSafe(client, ep, {});
      } catch {
        /* ignore */
      }
    }
  }

  let queued = false;
  let lastQueueErr = null;
  let usedMode = "t2v";

  for (const mode of modes) {
    console.info("[wan2gp] mode", mode.label, { model });

    // Jusqu’à 3 essais : 1er save souvent no-op (ignore_save_form) + validate_success
    for (let attempt = 1; attempt <= 3; attempt++) {
      const clientId = `sonozz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const payload = buildSaveInputsArgs(saveInfo, {
        prompt,
        imageHandle: mode.imageHandle,
        clientId,
      });

      try {
        await validateWizardPrompt(client, api, prompt);
        await predictSafe(client, "/save_inputs", payload);
        await predictSafe(client, "/save_inputs", payload);
        // Re-valider APRÈS save (validate_success doit être 1 au moment de add_tasks)
        await validateWizardPrompt(client, api, prompt);

        console.info("[wan2gp] queue try", mode.label, model, `attempt=${attempt}`);
        const queuedRes = await predictSafe(client, "/process_prompt_and_add_tasks", {
          current_gallery_tab: 0,
          model_choice: model,
        });
        const ok = isQueueSuccessPayload(queuedRes?.data) && !isQueueEmptyPayload(queuedRes?.data);
        console.info(
          "[wan2gp] queue resp",
          ok ? "OK" : "EMPTY",
          JSON.stringify(queuedRes?.data).slice(0, 160),
        );
        if (ok) {
          queued = true;
          usedMode = mode.label;
          break;
        }
        lastQueueErr = new Error(
          `Queue vide (${mode.label}/${model}) — attempt ${attempt}/3.`,
        );
      } catch (e) {
        lastQueueErr = e;
        console.warn("[wan2gp] attempt", attempt, e.message);
        if (/Webform can not be used|refresh the page/i.test(e.message || "")) {
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    if (queued) break;
  }

  if (!queued) {
    throw (
      lastQueueErr ||
      new Error(
        "Wan2GP n’a pas mis la tâche en queue. Dans l’UI Demeter : charge un modèle vidéo (t2v), génère un test manuel, puis réessaie.",
      )
    );
  }

  console.info("[wan2gp] queued via", usedMode);

  // Chaîne UI Wan2GP : prepare → activate_status → process_tasks → finalize
  if (api.named_endpoints["/prepare_generate_media"]) {
    try {
      await validateWizardPrompt(client, api, prompt);
      await predictSafe(client, "/prepare_generate_media", {});
    } catch (e) {
      console.warn("[wan2gp] prepare_generate_media:", e.message);
    }
  }
  if (api.named_endpoints["/activate_status"]) {
    try {
      await predictSafe(client, "/activate_status", {});
    } catch (e) {
      console.warn("[wan2gp] activate_status:", e.message);
    }
  }

  if (api.named_endpoints["/process_tasks"]) {
    const submission = client.submit("/process_tasks", {});
    const processDone = (async () => {
      try {
        for await (const ev of submission) {
          if (ev?.type === "status" || ev?.type === "log") {
            const msg = JSON.stringify(ev?.data ?? ev?.message ?? "").slice(0, 160);
            if (msg && msg !== "null") console.info("[wan2gp] process_tasks", ev.type, msg);
          }
          if (ev?.type === "error") {
            throw new Error(String(ev?.message || ev?.data || "process_tasks error").slice(0, 300));
          }
          if (ev?.type === "complete") break;
        }
      } catch (e) {
        console.warn("[wan2gp] process_tasks:", e.message);
        throw e;
      }
    })();

    let processErr = null;
    processDone.catch((e) => {
      processErr = e;
    });

    try {
      const { videoUrl } = await pollGalleryForNewVideo(client, baseUrl, {
        beforeUrls,
        maxPolls: 900, // ~2 h @ 8s
        emptyQueueFailAfter: 30,
      });
      if (videoUrl) {
        try {
          if (api.named_endpoints["/finalize_generation"]) {
            await predictSafe(client, "/finalize_generation", {});
          }
        } catch {
          /* ignore */
        }
        const saved = await persistVideoIfPossible(videoUrl, projectId);
        return {
          videoUrl: saved.url,
          s3Key: saved.s3Key,
          endpoint: `/save_inputs(${usedMode})+/process_tasks`,
          rawUrl: videoUrl,
        };
      }
    } catch (e) {
      if (processErr) {
        throw new Error(`${e.message} | process: ${processErr.message}`);
      }
      throw e;
    }

    // process_tasks fini sans vidéo détectée — dernier check gallery
    try {
      await processDone;
    } catch {
      /* already logged */
    }
    if (api.named_endpoints["/finalize_generation"]) {
      try {
        await predictSafe(client, "/finalize_generation", {});
      } catch {
        /* ignore */
      }
    }
    const gal = await predictSafe(client, "/refresh_gallery", {});
    const urls = collectVideoUrls(gal?.data ?? gal, baseUrl);
    const fresh = urls.find((u) => !beforeUrls.includes(u));
    if (fresh) {
      const saved = await persistVideoIfPossible(fresh, projectId);
      return {
        videoUrl: saved.url,
        s3Key: saved.s3Key,
        endpoint: `/save_inputs(${usedMode})+/process_tasks`,
        rawUrl: fresh,
      };
    }
    throw new Error(
      processErr?.message ||
        "Wan2GP terminé sans fichier vidéo dans la gallery (vérifie les logs GPU Demeter).",
    );
  }

  if (api.named_endpoints["/init_process_queue_if_any"]) {
    await predictSafe(client, "/init_process_queue_if_any", {});
  }

  const { videoUrl } = await pollGalleryForNewVideo(client, baseUrl, {
    beforeUrls,
    maxPolls: 900,
    emptyQueueFailAfter: 30,
  });
  if (!videoUrl) {
    throw new Error("Wan2GP terminé sans fichier vidéo dans la gallery.");
  }

  const saved = await persistVideoIfPossible(videoUrl, projectId);
  return {
    videoUrl: saved.url,
    s3Key: saved.s3Key,
    endpoint: `/save_inputs(${usedMode})+/process_tasks`,
    rawUrl: videoUrl,
  };
}

export async function testWan2gp(keys) {
  const base = resolveWan2gpBaseUrl(keys);
  const client = await connectClient(base);
  const api = await client.view_api();
  const endpoints = listNamedEndpoints(api).map((e) => e.name);
  const queueOk = hasQueueApi(api);
  return {
    base,
    endpoints: endpoints.filter((n) =>
      /save_inputs$|process_prompt_and_add_tasks$|process_tasks$|refresh_gallery$/.test(n),
    ),
    generateEndpoint: queueOk ? "/save_inputs→queue" : null,
    queueOk,
  };
}

/**
 * Lance une génération async (job mémoire processus Node).
 * @returns {{ predictionId: string, status: string, prompt: string, shotIndex: number }}
 */
export async function startWan2gpShot({
  keys,
  artist,
  track,
  social,
  lyrics,
  audioBrief,
  shotIndex = 0,
  shotBrief = null,
  projectId,
} = {}) {
  const base = resolveWan2gpBaseUrl(keys);
  const portrait = artist?.imageUrl;
  if (!isUsableRasterImage(portrait)) {
    throw new Error("Portrait artiste photo requis pour Wan2GP (image→vidéo).");
  }

  const prompt = buildWan2gpPrompt({
    artist,
    track,
    social,
    lyrics,
    audioBrief,
    shotIndex,
    shotBrief,
  });

  const predictionId = `wan2gp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(predictionId, {
    status: "starting",
    prompt,
    shotIndex,
    createdAt: Date.now(),
  });

  console.info(`[wan2gp] start shot ${shotIndex} → ${base}`);

  // Fire-and-forget (évite timeout proxy HTTP)
  (async () => {
    try {
      jobs.set(predictionId, { ...jobs.get(predictionId), status: "processing" });
      const result = await runGradioGeneration({
        baseUrl: base,
        prompt,
        imageUrl: portrait,
        projectId,
        modelChoice: keys?.wan2gpModel?.trim() || "t2v",
      });
      jobs.set(predictionId, {
        status: "succeeded",
        prompt,
        shotIndex,
        videoUrl: result.videoUrl,
        s3Key: result.s3Key,
        endpoint: result.endpoint,
        completedAt: Date.now(),
      });
      console.info("[wan2gp] OK", predictionId, result.videoUrl);
    } catch (e) {
      console.error("[wan2gp] fail", predictionId, e.message);
      jobs.set(predictionId, {
        status: "failed",
        prompt,
        shotIndex,
        error: e.message || String(e),
        completedAt: Date.now(),
      });
    }
  })();

  return {
    predictionId,
    status: "starting",
    prompt,
    shotIndex,
    shotBrief: shotBrief || null,
    model: "wan2gp",
    baseUrl: base,
  };
}

export async function finishWan2gpShot({ predictionId } = {}) {
  if (!predictionId) throw new Error("predictionId manquant");
  const job = jobs.get(predictionId);
  if (!job) {
    throw new Error("Job Wan2GP introuvable (serveur Astro redémarré ?) — relance la génération.");
  }

  if (job.status === "failed") {
    throw new Error(job.error || "Génération Wan2GP échouée");
  }

  if (job.status === "succeeded") {
    return {
      done: true,
      videoUrl: job.videoUrl,
      status: "succeeded",
      s3Key: job.s3Key,
      prompt: job.prompt,
      endpoint: job.endpoint,
    };
  }

  // Pas de timeout court : gen locale (chargement modèle + steps) peut dépasser 1–2 h.
  // Le client jobRunner coupe vers ~3 h ; ici on laisse tourner tant que le job vit.
  if (Date.now() - (job.createdAt || 0) > 3 * 60 * 60 * 1000) {
    throw new Error("Timeout Wan2GP (~3 h) — vérifie GPU / queue Gradio sur Demeter.");
  }

  return { done: false, status: job.status || "processing" };
}

export function isWan2gpVideoProvider(keys) {
  return String(keys?.videoProvider || "").trim() === "wan2gp";
}
