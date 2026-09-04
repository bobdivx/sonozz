import { listenVoiceTimbreFromBytes, listenTrackLeadVocalTimbreFromBytes, resolveTrackAudioBytes } from "../musicListen.js";
import { isS3Configured, downloadClipBuffer } from "../s3.js";
import { getArtistHub } from "../artists.js";
import { getDb } from "../db.js";

export async function loadAudioBytesFromVoiceSample(voiceSample) {
  if (!voiceSample || typeof voiceSample !== "object") return null;
  if (voiceSample.s3Key && isS3Configured()) {
    try {
      const dl = await downloadClipBuffer(voiceSample.s3Key);
      return {
        buffer: dl.buffer,
        mimeType: dl.mimeType || voiceSample.mimeType || "audio/wav",
        source: "voice-sample-s3",
      };
    } catch (e) {
      console.warn("[timbre] S3 voice sample:", e.message);
    }
  }
  const url = String(voiceSample.url || "").trim();
  if (/^https?:\/\//i.test(url)) {
    const audio = await resolveTrackAudioBytes({
      audioUrl: url,
      mimeType: voiceSample.mimeType,
    });
    return {
      buffer: Buffer.from(audio.data, "base64"),
      mimeType: audio.mimeType,
      source: "voice-sample-url",
    };
  }
  if (typeof voiceSample.dataUrl === "string" && voiceSample.dataUrl.startsWith("data:")) {
    const raw = voiceSample.dataUrl.replace(/^data:[^;]+;base64,/, "");
    return {
      buffer: Buffer.from(raw, "base64"),
      mimeType: voiceSample.mimeType || "audio/wav",
      source: "voice-sample-data",
    };
  }
  return null;
}

export async function findLatestArtistAudioUrl(slug) {
  if (!slug) return null;
  try {
    const hub = await getArtistHub(slug);
    const releases = Array.isArray(hub?.releases) ? hub.releases : [];
    for (const r of releases) {
      const url = r?.audioUrl || r?.track?.audioUrl;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  } catch {
    /* hub optional */
  }

  const db = getDb();
  const projects = await db.execute({
    sql: `
      SELECT project_json FROM projects
      WHERE artist_slug = ?
      ORDER BY updated_at DESC
      LIMIT 12
    `,
    args: [slug],
  });
  for (const row of projects.rows || []) {
    try {
      const project = JSON.parse(row.project_json);
      const track = project?.track;
      const url = track?.audioUrl;
      if (url && /^https?:\/\//i.test(url) && !track?.isPreview) return url;
      if (url && /^https?:\/\//i.test(url)) return url;
      const versions = project?.trackVersions || [];
      for (let i = versions.length - 1; i >= 0; i--) {
        const vUrl = versions[i]?.audioUrl;
        if (vUrl && /^https?:\/\//i.test(vUrl)) return vUrl;
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export { listenVoiceTimbreFromBytes, listenTrackLeadVocalTimbreFromBytes, resolveTrackAudioBytes };
