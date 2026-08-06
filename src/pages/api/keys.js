import { json, error, readBody } from "../../server/http.js";
import { getUserKeys, saveUserKeys } from "../../server/db.js";
import { applyRecordLabelToAllArtists } from "../../server/artists.js";

export const prerender = false;

export async function GET() {
  try {
    const keys = await getUserKeys();
    return json({
      keys: keys || null,
      source: keys ? "turso" : "empty",
    });
  } catch (e) {
    return error(e.message || "Lecture clés Turso impossible", 500);
  }
}

/** Enregistre (ou migre) le blob de clés vers Turso. */
export async function POST(context) {
  try {
    const body = await readBody(context.request);
    const keys = body?.keys;
    if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
      return error("Body { keys } requis", 400);
    }
    const result = await saveUserKeys(keys);

    let labelSync = null;
    const label = String(keys.distrokidLabel || "").trim();
    if (label) {
      try {
        labelSync = await applyRecordLabelToAllArtists(label);
      } catch (e) {
        labelSync = { error: e.message || "Sync label artistes KO" };
      }
    }

    return json({ ok: true, ...result, source: "turso", labelSync });
  } catch (e) {
    return error(e.message || "Écriture clés Turso impossible", 500);
  }
}

export async function PUT(context) {
  return POST(context);
}
