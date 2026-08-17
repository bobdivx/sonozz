/**
 * Parse le JSON renvoyé par un LLM (Gemini / Ollama).
 * Les paroles cassent souvent le JSON : \' (invalide), sauts de ligne bruts, fences markdown.
 */

function stripFence(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return s.trim();
}

function extractJsonBlob(s) {
  const obj = s.indexOf("{");
  const arr = s.indexOf("[");
  let start = -1;
  if (obj >= 0 && (arr < 0 || obj < arr)) start = obj;
  else if (arr >= 0) start = arr;
  if (start < 0) return s;
  return start === 0 ? s : s.slice(start);
}

/** Répare les séquences d’échappement hors RFC 8259 à l’intérieur des strings. */
export function repairJsonText(raw) {
  const s = extractJsonBlob(stripFence(raw));
  let out = "";
  let inString = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }

    if (c === "\\") {
      const n = s[i + 1];
      if (n == null) break;
      if ('"\\/bfnrt'.includes(n)) {
        out += `\\${n}`;
        i += 1;
        continue;
      }
      if (n === "u" && /^[0-9a-fA-F]{4}/.test(s.slice(i + 2, i + 6))) {
        out += s.slice(i, i + 6);
        i += 5;
        continue;
      }
      // \' \s \& etc. → on garde le caractère, on jette le backslash
      out += n;
      i += 1;
      continue;
    }

    if (c === '"') {
      inString = false;
      out += c;
      continue;
    }

    const code = c.charCodeAt(0);
    if (c === "\n") {
      out += "\\n";
      continue;
    }
    if (c === "\r") {
      out += "\\r";
      continue;
    }
    if (c === "\t") {
      out += "\\t";
      continue;
    }
    if (code < 32) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
      continue;
    }
    out += c;
  }

  return out;
}

export function parseLlmJson(text) {
  const stripped = stripFence(text);
  const attempts = [stripped, extractJsonBlob(stripped), repairJsonText(stripped)];
  const seen = new Set();
  let lastErr;

  for (const candidate of attempts) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      return JSON.parse(candidate);
    } catch (e) {
      lastErr = e;
    }
  }

  throw new Error(lastErr?.message || "Réponse LLM non JSON");
}
