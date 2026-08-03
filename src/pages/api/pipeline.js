import { error, readBody } from "../../server/http.js";
import { PIPELINE_STEPS, runFullPipeline } from "../../server/pipeline.js";

function ndjsonLine(obj) {
  return `${JSON.stringify(obj)}\n`;
}

export async function POST({ request }) {
  let body;
  try {
    body = await readBody(request);
  } catch {
    return error("Corps de requête invalide", 400);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj) => controller.enqueue(enc.encode(ndjsonLine(obj)));

      try {
        send({
          type: "meta",
          steps: PIPELINE_STEPS.map(({ key, label }) => ({ key, label })),
          total: PIPELINE_STEPS.length,
        });

        const data = await runFullPipeline({
          ...body,
          onProgress: (evt) => {
            send({ type: "progress", ...evt });
          },
        });

        send({ type: "result", ...data });
      } catch (e) {
        send({ type: "error", error: e.message || "Erreur pipeline" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const prerender = false;
