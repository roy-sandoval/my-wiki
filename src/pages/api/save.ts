import type { APIRoute } from "astro";
import { writePage } from "@/lib/wiki";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();

    if (typeof body.slug !== "string" || typeof body.markdown !== "string") {
      return new Response("Expected slug and markdown.", { status: 400 });
    }

    const page = await writePage(body.slug, body.markdown);
    return Response.json({ ok: true, page });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save page.";
    return new Response(message, { status: 400 });
  }
};
