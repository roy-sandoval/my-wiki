import type { APIRoute } from "astro";
import { listPageHistory } from "@/lib/git-history";

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url);
    const slug = url.searchParams.get("slug");

    if (!slug) {
      return new Response("Expected slug.", { status: 400 });
    }

    const commits = await listPageHistory(slug);
    return Response.json({ ok: true, commits });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load history.";
    return new Response(message, { status: 400 });
  }
};
