import { json, error, readBody } from "../../../server/http.js";
import { restoreAudioFromOnceRelease } from "../../../server/onceAudioRestore.js";
import { persistAudioFileBuffer } from "../../../server/audioPersist.js";
import { getProject, saveProject } from "../../../server/db.js";

export const prerender = false;

/**
 * POST JSON { keys, releaseId, projectId }
 *   → tente download ONCE (souvent 401) puis met à jour le projet si OK
 * POST multipart { audio, projectId, keys?, releaseId? }
 *   → sans releaseId : import générique (FLAC / WAV / MP3)
 *   → avec releaseId : master ONCE (WAV téléchargé depuis l’UI)
 */
export async function POST({ request }) {
  try {
    const ctype = request.headers.get("content-type") || "";

    if (ctype.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("audio") || form.get("file");
      const releaseId = String(form.get("releaseId") || "").trim();
      const projectId = String(form.get("projectId") || "").trim();
      const token =
        String(form.get("onceApiToken") || "").trim() ||
        (() => {
          try {
            return JSON.parse(String(form.get("keys") || "{}")).onceApiToken?.trim() || "";
          } catch {
            return "";
          }
        })();

      if (!file || typeof file.arrayBuffer !== "function") {
        return error("Fichier audio manquant (champ audio)", 400);
      }
      if (!projectId) return error("projectId manquant", 400);

      const buffer = Buffer.from(await file.arrayBuffer());
      const mimeType = String(file.type || form.get("mimeType") || "");
      const fileName = String(file.name || form.get("fileName") || "");

      if (!releaseId) {
        const uploaded = await persistAudioFileBuffer(buffer, {
          projectId,
          mimeHint: mimeType,
          fileName,
        });
        await patchProjectTrack(projectId, {
          audioUrl: uploaded.audioUrl,
          s3Key: uploaded.s3Key,
          mimeType: uploaded.mimeType,
          fileName,
          via: "upload",
        });
        return json({ ok: true, ...uploaded, via: "upload" });
      }

      const restored = await restoreAudioFromOnceRelease({
        token: token || "unused-when-buffer",
        releaseId,
        projectId,
        audioBuffer: buffer,
        mimeType: mimeType || "audio/wav",
        fileName,
      });

      await patchProjectTrack(projectId, restored, { once: true });
      return json({ ok: true, ...restored });
    }

    const body = await readBody(request);
    const token = body.keys?.onceApiToken?.trim() || body.onceApiToken?.trim();
    const releaseId = String(body.releaseId || "").trim();
    const projectId = String(body.projectId || "").trim();
    if (!token) return error("Token ONCE manquant (Paramètres)", 400);
    if (!releaseId) return error("releaseId manquant", 400);
    if (!projectId) return error("projectId manquant", 400);

    try {
      const restored = await restoreAudioFromOnceRelease({ token, releaseId, projectId });
      await patchProjectTrack(projectId, restored, { once: true });
      return json({ ok: true, ...restored });
    } catch (e) {
      if (e.code === "ONCE_FILE_AUTH") {
        return json(
          {
            ok: false,
            code: "ONCE_FILE_AUTH",
            error: e.message,
            releaseId: e.releaseId,
            audioPath: e.audioPath,
            dashboardUrl: e.dashboardUrl,
            hint: "Télécharge le WAV sur la page ONCE (connecté), puis réimporte-le ici.",
          },
          409,
        );
      }
      throw e;
    }
  } catch (e) {
    return error(e.message || "Import audio impossible", 500);
  }
}

async function patchProjectTrack(projectId, restored, { once = false } = {}) {
  const saved = await getProject(projectId);
  if (!saved?.project) throw new Error("Projet introuvable");
  const project = structuredClone(saved.project);
  if (once) {
    project.track = {
      ...(project.track || {}),
      title: restored.title || project.track?.title,
      audioUrl: restored.audioUrl,
      audioS3Key: restored.s3Key,
      audioEphemeral: false,
      status: "audio-ready",
      provider: "once-original",
      warning: undefined,
      assetMissingReason: undefined,
      note: `Audio ORIGINAL ONCE (${restored.releaseId}) · ${restored.via}`,
      restoredAt: new Date().toISOString(),
      restoredFrom: `once:${restored.releaseId}`,
      duration: restored.durationSec
        ? `~${Math.round(restored.durationSec / 60)}:${String(restored.durationSec % 60).padStart(2, "0")}`
        : project.track?.duration,
    };
    project.distrokid = {
      ...(project.distrokid || {}),
      releaseId: restored.releaseId,
      dashboardUrl: restored.dashboardUrl,
    };
  } else {
    project.track = {
      ...(project.track || {}),
      audioUrl: restored.audioUrl,
      audioS3Key: restored.s3Key,
      audioEphemeral: false,
      status: "audio-ready",
      provider: "import-file",
      warning: undefined,
      assetMissingReason: undefined,
      note: restored.fileName
        ? `Audio importé · ${restored.fileName}`
        : `Audio importé${restored.mimeType ? ` · ${restored.mimeType}` : ""}`,
      restoredAt: new Date().toISOString(),
      restoredFrom: undefined,
    };
  }
  await saveProject({
    id: projectId,
    project,
    seed: saved.seed || {},
    event: {
      eventType: once ? "audio-restore-once" : "audio-import-file",
      stepKey: "track",
      message: once ? "Audio original ONCE restauré" : "Audio importé",
    },
  });
}
