import { json, error, readBody } from "../../server/http.js";
import { runLyrics } from "../../server/pipeline.js";
import { getSessionFromCookies } from "../../server/auth.js";
import { newJobId, startJob, getJob, deleteJob, settleWithin } from "../../server/asyncJobs.js";

/** Attente max dans la requête (plusieurs passes LLM possibles > timeout proxy ~100 s → 499). */
const LYRICS_WAIT_MS = 20_000;

function settled(job) {
  deleteJob(job.id);
  if (job.error) return error(job.error.message || "Erreur paroles", job.error.status || 500);
  return json(job.result);
}

export async function POST({ request, cookies }) {
  try {
    const body = await readBody(request);
    const owner = getSessionFromCookies(cookies)?.email || null;
    if (body?.jobPoll) {
      const job = getJob(body.jobPoll, { owner });
      if (!job) return error("Paroles introuvables (serveur redémarré ?) — relance.", 410);
      await settleWithin(job, LYRICS_WAIT_MS);
      if (!job.done) return json({ pending: true, jobId: job.id });
      return settled(job);
    }
    if (!body?.asyncOk) {
      // Ancien client (bundle en cache) : comportement synchrone historique.
      return json(await runLyrics(body));
    }
    const { asyncOk: _a, ...payload } = body;
    const job = startJob(newJobId("lyr"), () => runLyrics(payload), { owner });
    await settleWithin(job, LYRICS_WAIT_MS);
    if (!job.done) return json({ pending: true, jobId: job.id });
    return settled(job);
  } catch (e) {
    return error(e.message || "Erreur paroles", 500);
  }
}

export const prerender = false;
