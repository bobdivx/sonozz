/**
 * Client Wan2GP (Pinokio / Demeter) via Gradio HTTP.
 * Génération image→vidéo (portrait artiste) puis mux audio côté ClipStep.
 * @see https://github.com/deepbeepmeep/Wan2GP
 */

export { resolveWan2gpBaseUrl } from "./client.js";
export { buildWan2gpPrompt } from "./prompt.js";
export {
  testWan2gp,
  startWan2gpShot,
  finishWan2gpShot,
  isWan2gpVideoProvider,
} from "./generate.js";
