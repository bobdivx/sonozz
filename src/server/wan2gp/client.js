/**
 * Client Wan2GP (Pinokio / Demeter) via Gradio HTTP.
 * @see https://github.com/deepbeepmeep/Wan2GP
 */

import { Client } from "@gradio/client";

export const DEFAULT_BASE = "http://127.0.0.1:7860";

export function resolveWan2gpBaseUrl(keys) {
  const raw = keys?.wan2gpBaseUrl?.trim() || DEFAULT_BASE;
  return raw.replace(/\/+$/, "");
}

export function errText(err) {
  return String(err?.message || err || "");
}

export async function connectClient(baseUrl) {
  try {
    return await Client.connect(baseUrl);
  } catch (e) {
    throw new Error(
      `Wan2GP injoignable (${baseUrl}). Start Wan2GP dans Pinokio (Home Server) et colle l’URL LAN. ${errText(e).slice(0, 140)}`,
    );
  }
}

export function listNamedEndpoints(api) {
  const named = api?.named_endpoints || {};
  return Object.entries(named).map(([name, info]) => ({ name, info }));
}

export function hasQueueApi(api) {
  const named = api?.named_endpoints || {};
  return Boolean(named["/save_inputs"] && named["/process_prompt_and_add_tasks"]);
}

export async function predictSafe(client, endpoint, data = {}) {
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
