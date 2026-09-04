import { statusHasStores } from "./normalize.js";

const BASE = "https://once.app/v1";

const MCP_BASE = "https://beta.once.app/api/mcp";

export async function onceFetch(token, path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-Once-Provenance": "SONOZZ",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      (typeof data?.message === "string" && data.message) ||
      (typeof data?.error === "string" && data.error) ||
      (typeof data?.detail === "string" && data.detail) ||
      null;
    const code = data?.code || data?.type || "";
    const msg = [detail || `ONCE HTTP ${res.status}`, code && code !== detail ? `(${code})` : ""]
      .filter(Boolean)
      .join(" ");
    const err = new Error(msg);
    err.status = res.status;
    err.code = data?.code || null;
    err.type = data?.type || null;
    err.path = path;
    throw err;
  }
  return data;
}

export async function onceMe(token) {
  return onceFetch(token, "/me");
}

export async function onceCredits(token) {
  return onceFetch(token, "/me/credits");
}

export async function onceReleaseStatus(token, releaseId) {
  let rest = null;
  let restError = null;
  try {
    rest = await onceFetch(token, `/releases/${encodeURIComponent(releaseId)}/status`);
  } catch (e) {
    restError = e;
  }

  if (statusHasStores(rest) && (rest.aggregateStatus || rest.status || rest.aggregate_status)) {
    return rest;
  }

  try {
    const mcp = await onceMcpCall(token, "get_release_status", { releaseId });
    if (mcp && typeof mcp === "object") {
      return {
        ...(rest && typeof rest === "object" ? rest : {}),
        ...mcp,
        storeStatuses:
          mcp.storeStatuses ||
          mcp.stores ||
          rest?.storeStatuses ||
          rest?.stores ||
          [],
        aggregateStatus:
          mcp.aggregateStatus ||
          mcp.status ||
          rest?.aggregateStatus ||
          rest?.status ||
          null,
      };
    }
  } catch {
    /* REST suffit si dispo */
  }

  if (restError && !rest) throw restError;
  return rest;
}

/** Métadonnées release (UPC, ISRC, tracks…). */
export async function onceReleaseMeta(token, releaseId) {
  return onceFetch(token, `/releases/${encodeURIComponent(releaseId)}`);
}

/**
 * Call an ONCE MCP tool via JSON-RPC (Bearer PAT / OAuth token).
 * Performance analytics live here — not on the REST /v1 surface.
 */
export async function onceMcpCall(token, name, args = {}) {
  const res = await fetch(MCP_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Once-Provenance": "SONOZZ",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const raw = await res.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    // Streamable HTTP may return SSE; extract first JSON-RPC payload
    const match = raw.match(/\{[\s\S]*"jsonrpc"[\s\S]*\}/);
    if (match) {
      try {
        data = JSON.parse(match[0]);
      } catch {
        data = {};
      }
    }
  }

  if (!res.ok) {
    const msg =
      data?.error?.message || data?.message || data?.error || `ONCE MCP HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (data.error) {
    throw new Error(data.error.message || data.error.code || "ONCE MCP error");
  }

  const text = data?.result?.content?.find((c) => c?.type === "text")?.text;
  if (text == null) return data?.result ?? data;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
