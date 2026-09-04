import { KEY_FIELDS } from "./schema.js";
import { isFlagOn, MUSIC_PROVIDERS } from "./studios.js";

const RETIRED_GEMINI_MODELS = new Set([
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-latest",
  "gemini-2.0-flash",
  "gemini-2.0-flash-001",
  "gemini-2.0-flash-lite",
  "gemini-2.0-flash-lite-001",
]);

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_OLLAMA_BASE = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_SONGGEN_BASE = "http://127.0.0.1:7860";
const DEFAULT_ACESTEP_BASE = "https://ace.briseteia.me";
const DEFAULT_WAN2GP_BASE = "http://127.0.0.1:7860";

const ACE_STEP_MODELS = [
  "acestep-v15-xl-turbo",
  "acestep-v15-xl-sft",
  "acestep-v15-xl-turbo-bf16",
  "marcorez8/acestep-v15-xl-turbo-bf16",
];

export const EMPTY_KEYS = () => {
  const base = Object.fromEntries(KEY_FIELDS.flatMap((g) => g.items.map((i) => [i.id, ""])));
  base.llmProvider = "gemini";
  base.geminiModel = DEFAULT_GEMINI_MODEL;
  base.ollamaBaseUrl = DEFAULT_OLLAMA_BASE;
  base.ollamaModel = DEFAULT_OLLAMA_MODEL;
  base.musicProvider = "replicate";
  base.aceStepEnabled = "1";
  base.songGenEnabled = "1";
  base.replicateEnabled = "1";
  base.aceStepBaseUrl = DEFAULT_ACESTEP_BASE;
  base.aceStepPreferredModel = "";
  base.songGenBaseUrl = DEFAULT_SONGGEN_BASE;
  base.songGenPreferredModel = "";
  base.videoProvider = "cloud";
  base.wan2gpBaseUrl = DEFAULT_WAN2GP_BASE;
  base.tiktokPrivacyLevel = "SELF_ONLY";
  base.tiktokPostMode = "direct";
  base.youtubePrivacyStatus = "private";
  return base;
};

export function migrateKeys(keys) {
  const next = { ...keys };
  if (!next.llmProvider?.trim() || !["gemini", "ollama"].includes(next.llmProvider.trim())) {
    next.llmProvider = "gemini";
  }
  if (!next.geminiModel?.trim() || RETIRED_GEMINI_MODELS.has(next.geminiModel.trim())) {
    next.geminiModel = DEFAULT_GEMINI_MODEL;
  }
  if (!next.ollamaBaseUrl?.trim()) {
    next.ollamaBaseUrl = DEFAULT_OLLAMA_BASE;
  }
  if (!next.ollamaModel?.trim()) {
    next.ollamaModel = DEFAULT_OLLAMA_MODEL;
  }
  if (!next.musicProvider?.trim() || !MUSIC_PROVIDERS.includes(next.musicProvider.trim())) {
    next.musicProvider = "replicate";
  }
  next.aceStepEnabled = isFlagOn(next.aceStepEnabled, true) ? "1" : "0";
  next.songGenEnabled = isFlagOn(next.songGenEnabled, true) ? "1" : "0";
  next.replicateEnabled = isFlagOn(next.replicateEnabled, true) ? "1" : "0";
  if (!next.aceStepBaseUrl?.trim()) {
    next.aceStepBaseUrl = DEFAULT_ACESTEP_BASE;
  }
  const acePref = String(next.aceStepPreferredModel || "").trim();
  next.aceStepPreferredModel = ACE_STEP_MODELS.includes(acePref) ? acePref : "";
  if (!next.songGenBaseUrl?.trim()) {
    next.songGenBaseUrl = DEFAULT_SONGGEN_BASE;
  }
  const pref = String(next.songGenPreferredModel || "").trim();
  next.songGenPreferredModel = [
    "songgeneration_large",
    "songgeneration_base_full",
    "songgeneration_base_new",
    "songgeneration_base",
  ].includes(pref)
    ? pref
    : "";
  if (!next.videoProvider?.trim() || !["cloud", "wan2gp"].includes(next.videoProvider.trim())) {
    next.videoProvider = "cloud";
  }
  if (!next.wan2gpBaseUrl?.trim()) {
    next.wan2gpBaseUrl = DEFAULT_WAN2GP_BASE;
  }
  if (!next.tiktokPrivacyLevel?.trim()) {
    next.tiktokPrivacyLevel = "SELF_ONLY";
  }
  if (!next.tiktokPostMode?.trim() || next.tiktokPostMode === "auto") {
    // Auto brûlait le quota Inbox ; Direct = chemin principal
    next.tiktokPostMode = "direct";
  }
  if (!next.youtubePrivacyStatus?.trim()) {
    next.youtubePrivacyStatus = "private";
  }
  return next;
}
