import type { APIRoute } from "astro";
import { readPageRevision } from "@/lib/git-history";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");
    const revision = url.searchParams.get("revision");

    if (!slug || !revision) {
      return new Response("Expected slug and revision.", { status: 400 });
    }

    const version = await readPageRevision(slug, revision);
    return Response.json({ ok: true, version });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load version.";
    return new Response(message, { status: 400 });
  }
};
