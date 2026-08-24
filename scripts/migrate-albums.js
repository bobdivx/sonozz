#!/usr/bin/env node
/**
 * Script de migration des albums depuis project_json.album vers la table albums.
 */

import { migrateAlbumsFromProjects } from "../src/server/albums.js";

async function main() {
  console.log("🔄 Début de la migration des albums...\n");

  try {
    const result = await migrateAlbumsFromProjects();

    console.log(`✅ Migration terminée avec succès !`);
    console.log(`   - ${result.migrated.length} album(s) migré(s)`);
    
    if (result.migrated.length > 0) {
      console.log("\n📦 Albums migrés :");
      for (const { projectId, albumId, artistSlug } of result.migrated) {
        console.log(`   - Album ${albumId} (projet ${projectId}, artiste ${artistSlug})`);
      }
    }

    if (result.errors.length > 0) {
      console.log(`\n⚠️  ${result.errors.length} erreur(s) :`);
      for (const { projectId, error } of result.errors) {
        console.log(`   - Projet ${projectId}: ${error}`);
      }
    }

    console.log("\n✨ Migration terminée !");
    process.exit(0);
  } catch (error) {
    console.error("❌ Erreur lors de la migration :", error);
    process.exit(1);
  }
}

main();
