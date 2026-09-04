import {
  connectClient,
  hasQueueApi,
  predictSafe,
} from "./client.js";
import { sanitizeWan2gpPrompt } from "./prompt.js";
import {
  collectVideoUrls,
  emptyMediaValue,
  persistVideoIfPossible,
} from "./media.js";

function paramType(p) {
  return String(p?.python_type?.type || p?.type || "");
}

/**
 * Payload nommé pour /save_inputs.
 * - Inclut tous les params nommés (Gradio exige ceux sans default, ex. image_mask_guide).
 * - Omet les State (parameter_name null).
 * - Clear explicite Start Image (sinon queue vide).
 * - Ne force PAS resolution / video_length (casse validate_settings selon le modèle).
 */
export function buildSaveInputsArgs(endpointInfo, { prompt, imageHandle, clientId }) {
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

/** Named kwargs only — ne jamais envoyer state=null. */
export async function validateWizardPrompt(client, api, prompt) {
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

export function resolveModelChoice(api, modelChoice) {
  const fromKey = String(modelChoice || "").trim();
  if (fromKey) return fromKey;
  const add = api?.named_endpoints?.["/process_prompt_and_add_tasks"];
  const p = (add?.parameters || []).find((x) => x.parameter_name === "model_choice");
  return String(p?.parameter_default || "t2v").trim() || "t2v";
}

export async function pollGalleryForNewVideo(
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

export function isQueueEmptyPayload(data) {
  const s = JSON.stringify(data ?? "");
  if (/Queue is empty/i.test(s)) return true;
  // Réponse vide Gradio (validate_settings a échoué silencieusement)
  if (/^\[(\{"__type__":"update"\},?)+\]$/.test(s.replace(/\s/g, ""))) return true;
  return false;
}

export function isQueueSuccessPayload(data) {
  const s = JSON.stringify(data ?? "");
  return /queue-scroll-container/i.test(s) && !/Queue is empty/i.test(s);
}

/**
 * Flux officiel Wan2GP Gradio :
 * save_inputs → process_prompt_and_add_tasks → process_tasks → refresh_gallery
 */
export async function runGradioGeneration({ baseUrl, prompt, imageUrl, projectId, modelChoice = "t2v" }) {
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
