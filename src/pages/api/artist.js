import { json, error, readBody } from "../../server/http.js";
import { runArtist } from "../../server/pipeline.js";
import { upsertArtistFromProject } from "../../server/artists.js";

export async function POST({ request }) {
  try {
    const body = await readBody(request);
    const data = await runArtist(body);
    let slug = body.slug || data.slug || null;
    if (body.persist !== false) {
      const saved = await upsertArtistFromProject(
        { ...data, slug: slug || data.slug },
        { preferredSlug: slug || undefined },
      );
      slug = saved?.slug || slug;
    }
    return json({ ...data, slug });
  } catch (e) {
    return error(e.message || "Erreur artiste", 500);
  }
}

export const prerender = false;
