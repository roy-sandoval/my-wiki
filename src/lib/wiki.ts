import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const pagesDir = path.join(process.cwd(), "src", "content", "pages");

export type WikiPage = {
  title: string;
  slug: string;
  markdown: string;
  exists: boolean;
};

export function slugifyTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeSlug(input: string) {
  const slug = slugifyTitle(input);
  if (!slug) {
    throw new Error("A page title or slug is required.");
  }
  return slug;
}

export function pagePathForSlug(slug: string) {
  const normalized = normalizeSlug(slug);
  const filePath = path.join(pagesDir, `${normalized}.md`);
  const relative = path.relative(pagesDir, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid page path.");
  }

  return filePath;
}

export function extractTitle(markdown: string, fallback: string) {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || fallback;
}

export function readPage(slugInput: string): WikiPage {
  const slug = normalizeSlug(slugInput);
  const filePath = pagePathForSlug(slug);
  const fallbackTitle = titleFromSlug(slug);

  if (!existsSync(filePath)) {
    return {
      title: fallbackTitle,
      slug,
      markdown: `# ${fallbackTitle}\n`,
      exists: false,
    };
  }

  const markdown = readFileSync(filePath, "utf8");
  return {
    title: extractTitle(markdown, fallbackTitle),
    slug,
    markdown,
    exists: true,
  };
}

export function readAllPages() {
  if (!existsSync(pagesDir)) {
    return [];
  }

  return readdirSync(pagesDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => readPage(file.replace(/\.md$/, "")));
}

export async function writePage(slugInput: string, markdown: string) {
  const slug = normalizeSlug(slugInput);
  await mkdir(pagesDir, { recursive: true });
  writeFileSync(pagePathForSlug(slug), markdown, "utf8");
  return readPage(slug);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderInline(value: string, pagesBySlug: Map<string, WikiPage>) {
  const escaped = escapeHtml(value);

  return escaped
    .replace(/"([^"]+)"/g, "&ldquo;$1&rdquo;")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[\[([^\]]+)\]\]/g, (_, rawTitle: string) => {
      const title = rawTitle.trim();
      const slug = slugifyTitle(title);
      const page = pagesBySlug.get(slug);
      const preview = page
        ? excerptFromMarkdown(page.markdown)
        : `${title} has not been written yet.`;

      return `<a class="wiki-link" href="/${slug}" data-preview-title="${escapeHtml(title)}" data-preview="${escapeHtml(preview)}">${escapeHtml(title)}</a>`;
    });
}

export function excerptFromMarkdown(markdown: string) {
  return markdown
    .replace(/^#\s+.+$/gm, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[*_`>#-]/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 160)
    .trim();
}

export function renderMarkdown(markdown: string, pages: WikiPage[]) {
  const pagesBySlug = new Map(pages.map((page) => [page.slug, page]));
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(" "), pagesBySlug)}</p>`);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      html.push("<hr />");
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2], pagesBySlug)}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      html.push(`<blockquote>${renderInline(trimmed.replace(/^>\s?/, ""), pagesBySlug)}</blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushParagraph();
  return html.join("\n");
}
