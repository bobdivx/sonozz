function errText(err) {
  return String(err?.cause?.code || err?.message || err || "");
}

function isLanOrLoopbackHost(hostname) {
  const h = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h || h === "localhost" || h.endsWith(".local")) return true;
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Astro public (Cloudflare) ne peut pas joindre une IP LAN Pinokio. */
export function songGenLanHint(baseUrl, requestHost) {
  let studioHost = "";
  try {
    studioHost = new URL(baseUrl).hostname;
  } catch {
    return "";
  }
  if (!isLanOrLoopbackHost(studioHost)) return "";
  const host = String(requestHost || "")
    .split(":")[0]
    .toLowerCase();
  if (host && !isLanOrLoopbackHost(host)) {
    return ` ${baseUrl} est une IP privée : le serveur public (${host}) ne peut pas l’atteindre. Lance SONOZZ en local (astro dev) sur ce PC, ou expose le studio via un tunnel (Cloudflare / Tailscale).`;
  }
  return "";
}

async function songGenFetch(
  baseUrl,
  path,
  { method = "GET", body, timeoutMs = method === "GET" ? 8000 : 60000 } = {},
) {
  const url = `${baseUrl}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
    throw new Error(
      `SongGeneration Studio injoignable (${baseUrl})${timedOut ? " — délai dépassé" : ""}. ${errText(e).slice(0, 120)}`,
    );
  }
  const ct = res.headers.get("content-type") || "";
  const data = /json/i.test(ct) ? await res.json().catch(() => ({})) : {};
  if (!res.ok) {
    const detail =
      typeof data?.detail === "string"
        ? data.detail
        : Array.isArray(data?.detail)
          ? data.detail.map((d) => d.msg || d).join("; ")
          : data?.message || data?.error || `HTTP ${res.status}`;
    throw new Error(`SongGen ${path}: ${detail}`);
  }
  return data;
}

function parseGpuFromHealth(health) {
  const g = health?.gpu?.gpu || health?.gpu || null;
  if (!g || typeof g !== "object") return { freeGb: null, totalGb: null, name: null };
  const freeGb = Number(g.free_gb);
  const totalGb = Number(g.total_gb);
  return {
    freeGb: Number.isFinite(freeGb) ? freeGb : null,
    totalGb: Number.isFinite(totalGb) ? totalGb : null,
    name: g.name ? String(g.name) : null,
    usedGb:
      Number.isFinite(Number(g.used_mb)) ? Math.round((Number(g.used_mb) / 1024) * 10) / 10 : null,
  };
}

export { errText, isLanOrLoopbackHost, songGenFetch, parseGpuFromHealth };
