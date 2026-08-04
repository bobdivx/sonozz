/**
 * Migre les clés API depuis un JSON local (ou stdin) vers Turso app_meta.user_api_keys.
 *
 * Usage:
 *   node scripts/migrate-keys-to-turso.mjs
 *   node scripts/migrate-keys-to-turso.mjs path/to/keys.json
 *
 * Sans fichier : lit app_meta existant et affiche l’état (dry check).
 * Avec fichier JSON (objet clés) : upsert dans Turso.
 */
import { readFileSync } from "fs";
import { createClient } from "@libsql/client";

const META_KEY = "user_api_keys";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);

if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
  console.error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN manquants dans .env");
  process.exit(1);
}

const c = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

await c.execute(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`);

const file = process.argv[2];
const existing = await c.execute({
  sql: `SELECT value, updated_at FROM app_meta WHERE key = ? LIMIT 1`,
  args: [META_KEY],
});

if (!file) {
  if (existing.rows[0]) {
    let keys = {};
    try {
      keys = JSON.parse(existing.rows[0].value);
    } catch {
      keys = {};
    }
    const n = Object.values(keys).filter((v) => String(v || "").trim()).length;
    console.log(`Turso a déjà user_api_keys (${n} champ(s) non vides, updated ${existing.rows[0].updated_at})`);
    console.log("Pour écraser : node scripts/migrate-keys-to-turso.mjs keys.json");
  } else {
    console.log("Aucune clé dans Turso. Exporte localStorage sonozz.keys.v1 en JSON puis :");
    console.log("  node scripts/migrate-keys-to-turso.mjs keys.json");
    console.log("Ou ouvre Paramètres dans l’app — migration auto depuis le navigateur.");
  }
  process.exit(0);
}

const raw = readFileSync(file, "utf8");
const keys = JSON.parse(raw);
if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
  console.error("Le fichier doit contenir un objet JSON de clés");
  process.exit(1);
}

const now = new Date().toISOString();
await c.execute({
  sql: `
    INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `,
  args: [META_KEY, JSON.stringify(keys), now],
});

const n = Object.values(keys).filter((v) => String(v || "").trim()).length;
console.log(`OK — ${n} champ(s) écrits dans app_meta.${META_KEY} @ ${now}`);
