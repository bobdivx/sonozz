/**
 * Diagnostic Gemini d’un take ACE (Fake God / duo).
 * Usage: node scripts/analyze-ace-take.mjs [projectId]
 */
import { createClient } from "@libsql/client";
import { readFileSync, writeFileSync } from "fs";

const projectId = process.argv[2] || "proj_mtmzs3c0_fhnhm9";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const db = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

function parseKeys(raw) {
  if (!raw) return {};
  try {
    return typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return {};
  }
}

const keysRow = await db.execute({
  sql: `SELECT value FROM app_meta WHERE key = ? LIMIT 1`,
  args: ["user_api_keys"],
});
let keys = parseKeys(keysRow.rows[0]?.value);
if (!keys.geminiApiKey) {
  keys.geminiApiKey = env.GEMINI_API_KEY || env.GOOGLE_GENERATIVE_AI_API_KEY || "";
}
const geminiKey = String(keys.geminiApiKey || "").trim();
if (!geminiKey) {
  console.error("Pas de clé Gemini (Turso user_api_keys / .env)");
  process.exit(1);
}
console.log("Gemini key OK · llmProvider=", keys.llmProvider || "?");

const full = await db.execute({
  sql: `SELECT project_json FROM projects WHERE id = ?`,
  args: [projectId],
});
if (!full.rows[0]) {
  console.error("Projet introuvable", projectId);
  process.exit(1);
}
const p = JSON.parse(full.rows[0].project_json);
const t = p.track || {};
const url = t.audioUrl;
if (!url) {
  console.error("Pas d’audioUrl sur le projet");
  process.exit(1);
}

console.log("Téléchargement…", String(url).slice(0, 80));
const res = await fetch(url);
if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);
const buf = Buffer.from(await res.arrayBuffer());
writeFileSync("tmp-fake-god-analyze.mp3", buf);
console.log("Audio", buf.length, "octets ·", res.headers.get("content-type"));

// Limite Gemini inline ~20 Mo ; on tronque à ~90s si trop gros via slice bytes approx
const maxBytes = 12_000_000;
const audioBuf = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
const b64 = audioBuf.toString("base64");
const mime = (res.headers.get("content-type") || "audio/mpeg").split(";")[0];

const context = {
  title: p.lyrics?.title || t.title,
  artists: `${p.artist?.name || ""} feat. ${p.featArtist?.name || p.artist?.featArtist?.name || ""}`,
  model: t.aceStepModel || t.quality,
  bpm: t.bpm,
  provider: t.provider,
  intent: "Duo hip-hop (male rap) × gospel (male), coherent song",
};

const prompt = `Tu es un ingénieur son / QA audio. Écoute UNIQUEMENT le fichier audio (ignore toute spéculation hors écoute).

Contexte minimal: ${JSON.stringify(context)}

Décris ce que tu ENTENDS vraiment. JSON strict:
{
  "verdict": "ok" | "degraded" | "unusable",
  "symptoms": ["..."],
  "likelyCauses": [
    { "cause": "...", "confidence": 0-1, "evidence": "ce que tu entends (pas ce que tu suppose)" }
  ],
  "structureHeard": "...",
  "voices": {
    "count": number,
    "distinct": boolean,
    "blendOrMush": boolean,
    "description": "..."
  },
  "production": {
    "muddy": boolean,
    "noiseWall": boolean,
    "distortionDominant": boolean,
    "twoSongsGlued": boolean,
    "instrumentation": "..."
  },
  "lyricsAudible": boolean,
  "recommendations": ["..."],
  "summary": "2-3 phrases"
}`;

const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
let lastErr = "";
for (const model of models) {
  console.log("Gemini", model, "…");
  const apiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mime, data: b64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  const data = await apiRes.json().catch(() => ({}));
  if (!apiRes.ok) {
    lastErr = data?.error?.message || `HTTP ${apiRes.status}`;
    console.warn("fail", lastErr);
    continue;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((x) => x.text).join("") || "";
  writeFileSync("tmp-fake-god-analyze.json", text);
  console.log(text);
  process.exit(0);
}
console.error("Gemini KO:", lastErr);
process.exit(1);
