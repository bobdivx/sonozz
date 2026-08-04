# SONOZZ

Studio automatisé Astro + Preact pour créer un artiste musical réaliste de A à Z.

## Stack

- Astro 7 (server / Node)
- Preact + Tailwind CSS 4 + DaisyUI 5
- Lucide Preact
- Gemini · Deezer · DistroKid → Spotify · Replicate (optionnel)

## Démarrage

```bash
npm install
cp .env.example .env   # puis renseigne TURSO_DATABASE_URL + TURSO_AUTH_TOKEN
npm run dev
```

Ouvre l’app → **Clés API** → colle au minimum ta clé **Gemini** → **Auto A → Z**.  
L’historique des créations est sauvegardé automatiquement sur **Turso (libSQL)**.

## Clés

| Clé | Rôle |
|---|---|
| Gemini API Key | Obligatoire — tendances, artiste, paroles, jaquettes, shorts |
| Replicate Token | Audio MusicGen (sinon prompt Suno) |
| Spotify Client ID/Secret | Contexte catalogue (optionnel) |
| ONCE Personal Access Token | Distribution auto vers Spotify (~1–2 $/titre) |
| DistroKid email / artiste / label | Secours manuel |
| TikTok | Publication Shorts (optionnel) |
| YouTube | Publication Shorts via Data API v3 (optionnel) |

Les clés sont stockées dans `localStorage` et envoyées uniquement à ton serveur local qui proxy les APIs.

> DistroKid n’a pas d’API publique d’upload. SONOZZ génère le package (métadonnées, checklist, exports) puis ouvre l’upload DistroKid pour coller les champs.

## Pipeline auto

1. Charts Deezer (+ Spotify) → analyse Gemini  
2. Profil artiste  
3. Paroles  
4. Morceau (Replicate ou brief Suno)  
5. Jaquette Gemini  
6. Package DistroKid → Spotify  
7. Pack shorts réseaux  

## Scripts

```bash
npm run dev
npm run build
npm start
```
