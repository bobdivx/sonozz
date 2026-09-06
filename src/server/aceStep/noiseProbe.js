/**
 * Détection rapide mur de bruit ACE (SFT OK HTTP mais audio inutilisable).
 * Utilise Gemini flash sur un extrait (~15 s) — sans clé → skip (null).
 */

const PROBE_BYTES = 900_000; // ~22 s @ 320 kbps

/**
 * @param {object} keys
 * @param {string} audioUrl
 * @returns {Promise<{ noiseWall: boolean, reason?: string }|null>}
 */
export async function probeAceNoiseWall(keys, audioUrl) {
  const apiKey = String(keys?.geminiApiKey || "").trim();
  const url = String(audioUrl || "").trim();
  if (!apiKey || !/^https?:\/\//i.test(url)) return null;

  let buf;
  try {
    const res = await fetch(url, {
      headers: { Range: `bytes=0-${PROBE_BYTES - 1}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok && res.status !== 206) {
      const full = await fetch(url, { signal: AbortSignal.timeout(25_000) });
      if (!full.ok) return null;
      const all = Buffer.from(await full.arrayBuffer());
      buf = all.subarray(0, Math.min(PROBE_BYTES, all.length));
    } else {
      buf = Buffer.from(await res.arrayBuffer());
    }
  } catch {
    return null;
  }
  if (!buf?.length || buf.length < 8_000) return null;

  const b64 = buf.toString("base64");
  const models = ["gemini-2.5-flash-lite", "gemini-2.0-flash"].filter(
    (m, i, a) => a.indexOf(m) === i,
  );

  const prompt = `Listen to this music excerpt (first ~15–20s). Reply JSON only:
{"noiseWall":boolean,"reason":"short"}
noiseWall=true ONLY if digital noise wall / extreme digital distortion / unintelligible hash with no music.
noiseWall=false if any recognizable music, vocals, beat, or melody (even mediocre).`;

  for (const m of models) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { inlineData: { mimeType: "audio/mpeg", data: b64 } },
                  { text: prompt },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              temperature: 0,
            },
          }),
          signal: AbortSignal.timeout(45_000),
        },
      );
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) continue;
      const text =
        payload?.candidates?.[0]?.content?.parts?.map((p) => p.text).filter(Boolean).join("") ||
        "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) continue;
      const parsed = JSON.parse(match[0]);
      return {
        noiseWall: Boolean(parsed.noiseWall),
        reason: String(parsed.reason || "").slice(0, 160) || undefined,
      };
    } catch {
      /* try next model */
    }
  }
  return null;
}
