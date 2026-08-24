# Migration des Albums

## Changements apportés

Ce PR résout le problème P0 où un artiste ne pouvait avoir qu'un seul album, et créer un nouvel album écrasait le précédent.

### Architecture

**Avant** : Les albums étaient stockés dans `project_json.album` (un seul album par artiste).

**Après** : Deux nouvelles tables Turso :
- `albums` : Contient les métadonnées d'album (titre, concept, statut, etc.)
- `album_tracks` : Référence les projets qui composent chaque album

### Modifications principales

1. **Base de données** (`src/server/db.js`) :
   - Table `albums` avec colonnes : id, artist_slug, title, concept, status, target_count, cover_url, job_id, live_json
   - Table `album_tracks` avec colonnes : id, album_id, project_id, role, index_position, working_title, theme, status, error
   - Fonctions CRUD : `createAlbum`, `getAlbum`, `updateAlbum`, `listAlbumsByArtist`, `addAlbumTrack`, etc.

2. **Logique métier** (`src/server/albums.js`) :
   - `migrateAlbumsFromProjects()` : Migre les albums depuis l'ancien format
   - `getArtistAlbumsWithDetails()` : Récupère tous les albums d'un artiste avec détails
   - `createAlbumFromLead()` : Crée un nouvel album à partir d'un projet lead
   - `organizeAlbumsFromReleases()` : Organise albums et singles pour l'affichage

3. **API** :
   - `/api/albums` (GET, POST) : Liste et création d'albums
   - `/api/albums/[id]` (GET, PATCH, DELETE) : CRUD sur un album
   - `/api/albums/tracks` (POST, PATCH, DELETE) : Gestion des tracks d'album

4. **Interface utilisateur** :
   - `AlbumCreationModal.jsx` : Modal pour créer un nouvel album
   - `albumsApi.js` : Client API pour les opérations albums
   - `ArtistHub.jsx` : Affiche plusieurs albums par artiste avec bouton "Nouvel album"
   - `organizeArtistReleases()` : Modifié pour utiliser les données de la table albums

5. **Migration** :
   - `scripts/migrate-albums.js` : Script CLI pour migrer les albums existants
   - Endpoint `/api/albums` avec `action: "migrate"` pour migration via API

## Comment migrer

### Option 1 : Via le script CLI
```bash
node scripts/migrate-albums.js
```

### Option 2 : Via l'API
```bash
curl -X POST http://localhost:4321/api/albums \
  -H "Content-Type: application/json" \
  -d '{"action":"migrate"}'
```

## Utilisation

1. **Créer un nouvel album** :
   - Aller sur la fiche artiste → Onglet "Albums"
   - Cliquer sur "Nouvel album"
   - Sélectionner un titre lead (avec paroles + audio)
   - Définir le titre, concept, et nombre de titres
   - Cliquer sur "Créer l'album"

2. **Affichage** :
   - L'onglet "Catalogue" affiche les albums dans la section "Albums" (avec leurs tracks)
   - Les singles restent dans la section "Singles"
   - Chaque album est indépendant et peut être géré séparément

3. **Garanties** :
   - ✅ Créer un nouvel album ne supprime JAMAIS les albums existants
   - ✅ Chaque album a son propre ID et ses propres tracks
   - ✅ Les données existantes sont préservées après migration
   - ✅ Un artiste peut avoir autant d'albums que souhaité

## Tests

Le fichier `tests/albums.test.js` contient des tests unitaires pour :
- Création d'albums
- Mise à jour d'albums
- Ajout/modification/suppression de tracks
- Organisation des albums et singles
- Non-écrasement lors de la création de plusieurs albums

Pour exécuter les tests (nécessite Turso configuré) :
```bash
node --test tests/albums.test.js
```

## Compatibilité

- Les albums existants dans `project_json.album` continuent de fonctionner
- La fonction `organizeArtistReleases()` gère les deux formats (ancien et nouveau)
- Après migration, l'ancien format n'est plus utilisé mais reste présent pour référence
