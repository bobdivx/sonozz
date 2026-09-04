import { api } from "../apiClient.js";
import { sleep } from "./helpers.js";
import { VEO_MAX_POLLS, SEEDANCE_MAX_POLLS, WAN2GP_MAX_POLLS } from "./state.js";

export async function pollVeo(operationName, { onTick, startFrom = 0 } = {}) {
  const from = Math.max(0, Math.min(VEO_MAX_POLLS - 1, Number(startFrom) || 0));
  for (let i = from; i < VEO_MAX_POLLS; i++) {
    if (!(from > 0 && i === from)) await sleep(10_000);
    onTick?.(i);
    const poll = await api.veoShortPoll(operationName);
    if (poll?.done) return poll;
  }
  throw new Error("Timeout Veo (~10 min)");
}

export async function pollSeedance(predictionId, { onTick, startFrom = 0 } = {}) {
  const from = Math.max(0, Math.min(SEEDANCE_MAX_POLLS - 1, Number(startFrom) || 0));
  for (let i = from; i < SEEDANCE_MAX_POLLS; i++) {
    if (!(from > 0 && i === from)) await sleep(8_000);
    onTick?.(i);
    const poll = await api.seedancePoll(predictionId);
    if (poll?.done && poll.videoUrl) return poll;
  }
  throw new Error("Timeout Seedance (~12 min)");
}

export async function pollWan2gp(predictionId, { onTick, startFrom = 0 } = {}) {
  const from = Math.max(0, Math.min(WAN2GP_MAX_POLLS - 1, Number(startFrom) || 0));
  for (let i = from; i < WAN2GP_MAX_POLLS; i++) {
    if (!(from > 0 && i === from)) await sleep(8_000);
    onTick?.(i);
    const poll = await api.wan2gpPoll(predictionId);
    if (poll?.done && poll.videoUrl) return poll;
    if (poll?.status === "failed") {
      throw new Error(poll.error || "Wan2GP a échoué");
    }
  }
  throw new Error("Timeout Wan2GP (~3 h) — gen locale trop longue ou GPU bloqué sur Demeter.");
}
