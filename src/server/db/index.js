export { getDb, ensureSchema, uid, testDb } from "./client.js";
export { listProjects, getProject, saveProject, deleteProject } from "./projects.js";
export {
  getAppMeta,
  setAppMeta,
  deleteAppMeta,
  USER_KEYS_META,
  getUserKeys,
  saveUserKeys,
} from "./meta.js";
export {
  createAlbum,
  getAlbum,
  updateAlbum,
  listAlbumsByArtist,
  addAlbumTrack,
  updateAlbumTrack,
  deleteAlbumTrack,
  deleteAlbum,
} from "./albums.js";
