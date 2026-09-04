import { isUsableRasterImage } from "../imagePersist.js";
import {
  connectClient,
  hasQueueApi,
  listNamedEndpoints,
  resolveWan2gpBaseUrl,
} from "./client.js";
import { buildWan2gpPrompt } from "./prompt.js";
import { runGradioGeneration } from "./queue.js";

const jobs = new Map();

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
