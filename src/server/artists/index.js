export { slugify } from "./schema.js";

export {
  upsertArtistFromProject,
  syncArtistsFromProjects,
  listArtists,
  getArtistBySlug,
  deleteArtist,
  collectS3KeysFromProject,
  linkProjectToArtist,
  backfillAllArtistProfiles,
} from "./crud.js";

export {
  listArtistReleases,
  listLibraryTracks,
  createArtistRelease,
  openArtistStyleEditor,
} from "./releases.js";

export {
  needsOnceEnrich,
  computeArtistStats,
  getArtistHub,
} from "./stats.js";

export {
  resolveArtistProfileForRelease,
  hydrateProjectArtistGender,
} from "./profile.js";

export { adviseArtistCareer } from "./career.js";

export {
  restyleArtistPortraits,
  applyRecordLabelToAllArtists,
} from "./portraits.js";
