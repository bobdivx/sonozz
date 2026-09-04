const ACE_NAN_LATENTS_RE =
  /NaN or Inf latents|produced NaN|nan=\d+/i;
const ACE_VRAM_RE =
  /out of memory|CUDA out of memory|cuDNN.*OOM|insufficient.*VRAM|ran out of memory/i;

export function isAceNanLatentsError(err) {
  return ACE_NAN_LATENTS_RE.test(String(err?.message || err || ""));
}

export function isAceVramError(err) {
  const raw = String(err?.message || err || "");
  if (ACE_NAN_LATENTS_RE.test(raw)) return false;
  return ACE_VRAM_RE.test(raw);
}

/** Modèle de secours léger après NaN / OOM. */
export const ACE_FALLBACK_LIGHT_MODEL = "marcorez8/acestep-v15-xl-turbo-bf16";

const GRADIO_CACHE_ERROR_RE =
  /not uploaded by a user|check_in_upload_folder|InvalidPathError|gradio cache dir/i;

const ACE_INVALID_REF_RE =
  /reference audio is invalid|unreadable, or silent|invalid, unreadable|pas un fichier audio/i;

export function isGradioReferenceCacheError(err) {
  return GRADIO_CACHE_ERROR_RE.test(String(err?.message || err || ""));
}

/** Réf. cover inutilisable : Gradio cache OU fichier silent/HTML/S3 illisible. */
export function isUnusableAceReferenceError(err) {
  const raw = String(err?.message || err || "");
  return isGradioReferenceCacheError(raw) || ACE_INVALID_REF_RE.test(raw) || /ACE_REF_UNUSABLE/i.test(raw);
}

/** MP3 / WAV / OGG / M4A — pas une page HTML ni un XML S3. */
export function looksLikeAudioBuffer(buffer, mimeType = "") {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length < 4096) return false;
  const mime = String(mimeType || "");
  if (/html|json|xml|text\/plain/i.test(mime) && !/audio|mpeg|mp4|ogg|wav/i.test(mime)) {
    return false;
  }
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true;
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return true;
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
  if (
    bytes.length > 11 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    return true;
  }
  return false;
}
