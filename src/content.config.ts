import { defineCollection, z } from "astro:content";

const pages = defineCollection({
  schema: z.object({}).passthrough(),
});

export const collections = { pages };
