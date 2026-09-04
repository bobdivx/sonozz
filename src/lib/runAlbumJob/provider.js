import { api } from "../apiClient.js";
import { loadKeys } from "../keys.js";

export async function probeMusicProvider() {
  const keys = loadKeys();
  const provider = String(keys.musicProvider || "").trim();
  if (provider === "acestep") return api.probeAceStep();
  if (provider === "songgen") return api.probeSongGen();
  return { ok: true };
}

export function providerDownError(probe) {
  const err = new Error(probe?.message || "Studio audio injoignable");
  err.name = "ProviderDownError";
  return err;
}
