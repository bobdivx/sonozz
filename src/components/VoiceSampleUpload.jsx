import { useEffect, useRef, useState } from "preact/hooks";
import { Mic2, Upload, Square, Trash2 } from "lucide-preact";
import {
  VOICE_SAMPLE_ACCEPT,
  VOICE_SAMPLE_MAX_SEC,
  DEFAULT_VOICE_GUIDE_MODE,
  normalizeVoiceBlobToWav,
  validateVoiceFile,
} from "../lib/voiceSample.js";
import { playableAudioSrc } from "../lib/audioResolve.js";
import { loadKeys } from "../lib/keys.js";

/**
 * Extrait vocal mode MOI — fichier ou micro → WAV ≤10s → S3.
 * @param {{
 *   value?: { url?: string, s3Key?: string, fileName?: string, mimeType?: string, durationSec?: number, guideMode?: string } | null,
 *   disabled?: boolean,
 *   projectId?: string,
 *   onChange?: (sample: object | null) => void,
 * }} props
 */
export default function VoiceSampleUpload({
  value = null,
  disabled = false,
  projectId = "voice",
  onChange,
}) {
  const fileRef = useRef(null);
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const [error, setError] = useState("");
  const [localPreview, setLocalPreview] = useState("");

  useEffect(() => {
    return () => {
      stopRecorder();
      if (localPreview) URL.revokeObjectURL(localPreview);
    };
  }, []);

  function stopRecorder() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const rec = mediaRef.current;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    mediaRef.current = null;
    rec?.stream?.getTracks?.().forEach((t) => t.stop());
  }

  function emitSample(next) {
    onChange?.(next);
  }

  async function uploadWav(wavBlob, fileName, durationSec) {
    const form = new FormData();
    form.append("audio", wavBlob, fileName || "voice-sample.wav");
    form.append("projectId", projectId);
    form.append("mimeType", "audio/wav");
    form.append("fileName", fileName || "voice-sample.wav");
    if (durationSec) form.append("durationSec", String(Math.round(durationSec)));

    loadKeys();
    const res = await fetch("/api/voice-sample", { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Upload HTTP ${res.status}`);
    return {
      url: data.url,
      s3Key: data.s3Key,
      mimeType: data.mimeType || "audio/wav",
      fileName: data.fileName || fileName || "voice-sample.wav",
      byteLength: data.byteLength,
      durationSec: data.durationSec || durationSec || null,
      guideMode: DEFAULT_VOICE_GUIDE_MODE,
    };
  }

  async function processBlob(rawBlob, suggestedName) {
    setBusy(true);
    setError("");
    try {
      validateVoiceFile(
        rawBlob instanceof File
          ? rawBlob
          : new File([rawBlob], suggestedName || "rec.webm", {
              type: rawBlob.type || "audio/webm",
            }),
      );
      const normalized = await normalizeVoiceBlobToWav(rawBlob, VOICE_SAMPLE_MAX_SEC);
      const sample = await uploadWav(
        normalized.blob,
        normalized.fileName,
        normalized.durationSec,
      );
      if (localPreview && localPreview.startsWith("blob:")) {
        URL.revokeObjectURL(localPreview);
      }
      const preview = URL.createObjectURL(normalized.blob);
      setLocalPreview(preview);
      emitSample(sample);
    } catch (e) {
      setError(e.message || "Import vocal impossible");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onFile(fileList) {
    if (!fileList?.length || disabled || busy) return;
    await processBlob(fileList[0], fileList[0].name);
  }

  async function startRecording() {
    if (disabled || busy || recording) return;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      chunksRef.current = [];
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      mediaRef.current = rec;
      rec.ondataavailable = (ev) => {
        if (ev.data?.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size < 500) {
          setError("Enregistrement trop court");
          return;
        }
        await processBlob(blob, "voice-mic.webm");
      };
      rec.start(200);
      setRecording(true);
      setRecSec(0);
      timerRef.current = setInterval(() => {
        setRecSec((s) => {
          const next = s + 1;
          if (next >= VOICE_SAMPLE_MAX_SEC) {
            stopRecorder();
          }
          return next;
        });
      }, 1000);
    } catch (e) {
      setError(
        /NotAllowed|Permission/i.test(String(e?.message || e))
          ? "Micro refusé — autorise l’accès ou importe un fichier."
          : e.message || "Micro indisponible",
      );
    }
  }

  function clearSample() {
    stopRecorder();
    setRecording(false);
    setRecSec(0);
    setError("");
    if (localPreview && localPreview.startsWith("blob:")) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview("");
    emitSample({ guideMode: DEFAULT_VOICE_GUIDE_MODE });
  }

  const hasSample = Boolean(value?.url || value?.s3Key);
  // Blob local juste après upload ; sinon proxy serveur (bucket Scaleway privé → 403 en URL directe)
  const previewSrc =
    (localPreview && localPreview.startsWith("blob:") ? localPreview : "") ||
    playableAudioSrc(value?.url, value?.s3Key) ||
    "";

  return (
    <div class="space-y-3">
      <div class="space-y-1">
        <span class="label-text mb-1 flex items-center gap-2 text-sm text-base-content/60">
          <Mic2 size={14} class="text-accent" />
          Ta voix (optionnel)
        </span>
        <p class="text-xs text-base-content/45">
          ~5–10 s de toi qui chantes — sert d’indice de timbre seulement. Le morceau est toujours
          généré en mix complet (voix + instruments).
        </p>
      </div>

      {hasSample ? (
        <div class="flex flex-col gap-2 rounded-lg border border-base-content/10 bg-base-200/40 p-3">
          <div class="flex flex-wrap items-center gap-2 text-sm">
            <span class="text-success">Extrait prêt</span>
            <span class="text-base-content/45">
              {value?.fileName || "voice-sample.wav"}
              {value?.durationSec ? ` · ~${Math.round(value.durationSec)}s` : ""}
            </span>
            <button
              type="button"
              class="btn btn-ghost btn-xs gap-1 ml-auto"
              disabled={disabled || busy}
              onClick={clearSample}
            >
              <Trash2 size={12} /> Retirer
            </button>
          </div>
          {previewSrc && (
            <audio controls preload="metadata" src={previewSrc} class="w-full" />
          )}
        </div>
      ) : (
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-sm btn-ghost border border-base-content/15 gap-2"
            disabled={disabled || busy || recording}
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={14} />
            {busy ? "Envoi…" : "Importer un fichier"}
          </button>
          {!recording ? (
            <button
              type="button"
              class="btn btn-sm btn-primary gap-2"
              disabled={disabled || busy}
              onClick={startRecording}
            >
              <Mic2 size={14} />
              Enregistrer
            </button>
          ) : (
            <button
              type="button"
              class="btn btn-sm btn-error gap-2"
              onClick={() => stopRecorder()}
            >
              <Square size={14} />
              Stop ({recSec}s / {VOICE_SAMPLE_MAX_SEC}s)
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={VOICE_SAMPLE_ACCEPT}
            class="hidden"
            disabled={disabled || busy}
            onChange={(e) => onFile(e.currentTarget.files)}
          />
        </div>
      )}

      {error && <p class="text-sm text-error">{error}</p>}
    </div>
  );
}
