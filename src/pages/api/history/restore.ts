import type { APIRoute } from "astro";
import { restorePageRevision } from "@/lib/git-history";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    if (typeof body.slug !== "string" || typeof body.revision !== "string") {
      return new Response("Expected slug and revision.", { status: 400 });
    }

    const result = await restorePageRevision(body.slug, body.revision);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not restore version.";
    return new Response(message, { status: 400 });
  }
};
