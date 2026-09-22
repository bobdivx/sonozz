# SONOZZ

Studio Astro + Preact pour créer un artiste, générer des titres et les publier. Le lecteur `/play` reste public.

## Parcours

1. Créer un compte et un artiste (identité, style, voix).
2. Lancer un titre dans le studio : paroles, audio, jaquette, puis ONCE, clip et réseaux.
3. Écouter le catalogue sur `/play`.

L’accueil connecté redirige vers `/studio`. Auto A → Z enchaîne paroles, audio et jaquette.

## Stack

- Astro 7 (server / Node)
- Preact + Tailwind CSS 4 + DaisyUI 5
- Lucide Preact
- Turso (libSQL), S3 (audio et visuels), Stripe
- Gemini · ACE-Step / SongGen · ONCE · TikTok · YouTube

## Démarrage

```bash
npm install
cp .env.example .env   # TURSO_*, AUTH_*, puis S3 / Stripe si besoin
npm run dev
```

Ouvre l’app, connecte-toi, puis crée un artiste avant le premier titre.

## Scripts

```bash
npm run dev
npm run build
npm start
npm test
```

`npm test` lance les tests unitaires de `tests/`. `tests/albums.test.js` écrit dans Turso : le lancer seulement contre une base de test.

## Étapes studio

Stats → Paroles → Morceaux → Jaquettes → ONCE → Clips → Réseaux.

Le studio ne charge que le code de l’étape affichée. L’étape suivante est préchargée.
