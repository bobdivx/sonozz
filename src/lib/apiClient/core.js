import { loadKeys } from "../keys.js";

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
