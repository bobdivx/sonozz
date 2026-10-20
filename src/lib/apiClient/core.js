import { loadKeys } from "../keys/storage.js";

export function toAbortSignal(signal) {
  if (!signal) return undefined;
  if (typeof AbortSignal !== "undefined" && signal instanceof AbortSignal) return signal;
  if (typeof signal.aborted !== "boolean") return undefined;
  const ac = new AbortController();
  if (signal.aborted) {
    ac.abort();
    return ac.signal;
  }
  const iv = setInterval(() => {
    if (signal.aborted) {
      clearInterval(iv);
      ac.abort();
    }
  }, 200);
  ac.signal.addEventListener("abort", () => clearInterval(iv), { once: true });
  return ac.signal;
}

export async function request(path, body = {}, opts = {}) {
  const keys = loadKeys();
  const signal = toAbortSignal(opts.signal);
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, ...body }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || opts.signal?.aborted) {
      const err = new Error("Génération audio annulée");
      err.name = "AbortError";
      throw err;
    }
    throw e;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erreur API ${res.status}`);
  }
  return data;
}

/**
 * POST long (LLM multi-passes…) : le serveur répond `{ pending, jobId }` après quelques secondes,
 * on poll jusqu'au résultat — jamais de requête tenue au-delà du timeout proxy (499/502/524).
 */
export async function requestJob(path, body = {}, opts = {}) {
  const maxMs = Number(opts.maxMs) || 15 * 60_000;
  const t0 = Date.now();
  let data = await request(path, { ...body, asyncOk: true }, opts);
  while (data && data.pending && data.jobId) {
    if (Date.now() - t0 > maxMs) throw new Error("Délai dépassé — réessaie.");
    await sleep(1500, opts.signal);
    const jobId = data.jobId;
    for (let attempt = 0; ; attempt++) {
      try {
        data = await request(path, { jobPoll: jobId }, opts);
        break;
      } catch (e) {
        if (e?.name === "AbortError" || attempt >= 2) throw e;
        if (!/Erreur API (499|502|503|504|524)|fetch failed|NetworkError|Failed to fetch/i.test(String(e?.message || ""))) throw e;
        await sleep(2000, opts.signal);
      }
    }
  }
  return data;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const fail = () => {
      const err = new Error("Génération audio annulée");
      err.name = "AbortError";
      reject(err);
    };
    if (signal?.aborted) {
      fail();
      return;
    }
    let iv;
    const t = setTimeout(() => {
      clearInterval(iv);
      resolve();
    }, ms);
    iv = setInterval(() => {
      if (signal?.aborted) {
        clearTimeout(t);
        clearInterval(iv);
        fail();
      }
    }, 200);
  });
}

export function formatElapsed(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m${String(r).padStart(2, "0")}s` : `${r}s`;
}

export function shortModelLabel(modelId) {
  const id = String(modelId || "").trim();
  if (!id) return "";
  if (/xl-sft$/i.test(id) && !/merge/i.test(id)) return "XL SFT";
  if (/turbo-bf16/i.test(id)) return "XL Turbo BF16";
  if (/merge-sft-turbo/i.test(id)) return "XL Merge";
  if (/xl-turbo/i.test(id)) return "XL Turbo";
  return id.replace(/^.*\//, "");
}
