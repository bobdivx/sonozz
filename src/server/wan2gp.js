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
    `Animate from the reference start image — keep the same person / wardrobe continuity when visible.`,
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

function pickGenerateEndpoint(endpoints) {
  const preferred = [
    "/generate",
    "/process",
    "/generate_video",
    "/run",
    "/i2v",
    "/image_to_video",
  ];
  for (const want of preferred) {
    const hit = endpoints.find((e) => e.name === want || e.name?.endsWith(want));
    if (hit) return hit;
  }
  const fuzzy = endpoints.find((e) =>
    /generat|process|video|i2v|infer/i.test(String(e.name || "")),
  );
  return fuzzy || endpoints[0] || null;
}

function paramName(p) {
  return String(p?.parameter_name || p?.label || p?.python_type?.type || "").trim();
}

function buildGradioPayload(endpointInfo, { prompt, imageHandle, resolution = "768x1280" }) {
  const params = Array.isArray(endpointInfo?.parameters) ? endpointInfo.parameters : [];
  if (!params.length) {
    // Endpoint sans schéma : payload minimal nommé
    return {
      prompt,
      image_start: imageHandle,
    };
  }

  const data = {};
  let setPrompt = false;
  let setImage = false;

  for (const p of params) {
    const n = paramName(p);
    if (!n) continue;
    const lower = n.toLowerCase();

    if (
      !setPrompt &&
      (/^prompt$/.test(lower) ||
        lower === "text_prompt" ||
        lower === "prompt_text" ||
        lower === "positive_prompt" ||
        lower.includes("prompt") && !lower.includes("image") && !lower.includes("enhanc"))
    ) {
      data[n] = prompt;
      setPrompt = true;
      continue;
    }

    if (
      !setImage &&
      (lower === "image_start" ||
        lower === "start_image" ||
        lower === "image_prompt" ||
        lower === "input_image" ||
        lower === "image" ||
        lower === "img" ||
        (lower.includes("image") && lower.includes("start")))
    ) {
      data[n] = imageHandle;
      setImage = true;
      continue;
    }

    if (lower === "resolution" || lower === "size" || lower === "video_resolution") {
      data[n] = resolution;
      continue;
    }

    if (lower === "video_length" || lower === "num_frames" || lower === "frames") {
      const def = p.parameter_default;
      data[n] = typeof def === "number" ? def : 49;
      continue;
    }

    if (p.parameter_default !== undefined && p.parameter_default !== null) {
      data[n] = p.parameter_default;
    }
  }

  if (!setPrompt) {
    // dernier recours : premier param string-like
    const first = params.find((p) => /str|text/i.test(String(p?.python_type?.type || p?.type || "")));
    if (first) data[paramName(first)] = prompt;
  }
  if (!setImage && imageHandle) {
    const imgP = params.find((p) => /image|file/i.test(paramName(p)));
    if (imgP) data[paramName(imgP)] = imageHandle;
  }

  return data;
}

function extractVideoUrl(data, baseUrl) {
  const stack = [data];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur == null || seen.has(cur)) continue;
    if (typeof cur === "object") seen.add(cur);

    if (typeof cur === "string") {
      if (/\.(mp4|webm|mov)(\?|$)/i.test(cur) || /\/file[=/]/i.test(cur) || /gradio_api\/file/i.test(cur)) {
        if (/^https?:\/\//i.test(cur)) return cur;
        if (cur.startsWith("/")) return `${baseUrl}${cur}`;
        return `${baseUrl}/${cur.replace(/^\.\//, "")}`;
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
      if (typeof cur.name === "string" && /\.(mp4|webm)/i.test(cur.name) && cur.url) {
        stack.push(cur.url);
      }
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return null;
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

async function runGradioGeneration({ baseUrl, prompt, imageUrl, projectId }) {
  const client = await connectClient(baseUrl);
  const api = await client.view_api();
  const endpoints = listNamedEndpoints(api);
  if (!endpoints.length) {
    throw new Error(
      "Wan2GP Gradio sans endpoints API — ouvre l’UI, vérifie « Use via API », ou mets à jour Wan2GP.",
    );
  }
  const endpoint = pickGenerateEndpoint(endpoints);
  if (!endpoint) throw new Error("Aucun endpoint de génération trouvé sur Wan2GP");

  const imageHandle = handle_file(imageUrl);
  const payload = buildGradioPayload(endpoint.info, {
    prompt,
    imageHandle,
    resolution: "768x1280",
  });

  console.info("[wan2gp] submit", endpoint.name, Object.keys(payload));

  const submission = client.submit(endpoint.name, payload);
  let lastData = null;
  let lastError = null;

  for await (const event of submission) {
    if (event?.type === "data" || event?.type === "complete") {
      lastData = event.data ?? event;
    }
    if (event?.type === "unexpected_error" || event?.type === "error") {
      lastError = event?.message || event?.data || "Erreur Gradio";
    }
    if (event?.type === "complete") break;
  }

  if (lastError) throw new Error(String(lastError).slice(0, 300));

  const videoUrl = extractVideoUrl(lastData, baseUrl);
  if (!videoUrl) {
    throw new Error(
      `Wan2GP a terminé sans fichier vidéo (endpoint ${endpoint.name}). Vérifie le modèle I2V chargé dans l’UI.`,
    );
  }

  const saved = await persistVideoIfPossible(videoUrl, projectId);
  return { videoUrl: saved.url, s3Key: saved.s3Key, endpoint: endpoint.name, rawUrl: videoUrl };
}

export async function testWan2gp(keys) {
  const base = resolveWan2gpBaseUrl(keys);
  const client = await connectClient(base);
  const api = await client.view_api();
  const endpoints = listNamedEndpoints(api).map((e) => e.name);
  const gen = pickGenerateEndpoint(listNamedEndpoints(api));
  return {
    base,
    endpoints: endpoints.slice(0, 12),
    generateEndpoint: gen?.name || null,
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

  // Timeout soft (~20 min)
  if (Date.now() - (job.createdAt || 0) > 20 * 60 * 1000) {
    throw new Error("Timeout Wan2GP (~20 min) — vérifie GPU / queue Gradio sur Demeter.");
  }

  return { done: false, status: job.status || "processing" };
}

export function isWan2gpVideoProvider(keys) {
  return String(keys?.videoProvider || "").trim() === "wan2gp";
}
