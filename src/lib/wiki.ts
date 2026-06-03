import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export const pagesDir = path.join(process.cwd(), "src", "content", "pages");

export type WikiPage = {
  title: string;
  slug: string;
  markdown: string;
  exists: boolean;
  createdAt?: Date;
  updatedAt?: Date;
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
  const stats = statSync(filePath);

  return {
    title: extractTitle(markdown, fallbackTitle),
    slug,
    markdown,
    exists: true,
    createdAt: stats.birthtime,
    updatedAt: stats.mtime,
  };
}

export function readAllPages() {
  if (!existsSync(pagesDir)) {
    return [];
  }

  return readdirSync(pagesDir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => readPage(file.replace(/\.md$/, "")))
    .sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0));
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

function renderInlinePlain(value: string, pagesBySlug: Map<string, WikiPage>) {
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
      const appleMusicPreview = page ? findAppleMusicEmbedSrc(page.markdown) : null;
      const youtubePreview = page ? findYoutubeEmbedSrc(page.markdown) : null;
      const appleMusicAttribute = appleMusicPreview
        ? ` data-preview-apple-music="${escapeHtml(appleMusicPreview)}"`
        : "";
      const youtubeAttribute = youtubePreview
        ? ` data-preview-youtube="${escapeHtml(youtubePreview)}"`
        : "";

      return `<a class="wiki-link" href="/${slug}" data-preview-title="${escapeHtml(title)}" data-preview="${escapeHtml(preview)}"${appleMusicAttribute}${youtubeAttribute}>${escapeHtml(title)}</a>`;
    });
}

function renderInline(value: string, pagesBySlug: Map<string, WikiPage>) {
  const notePattern = /\{\{note\s+([^|{}]+?)\s*\|\s*([^{}]+?)\s*\}\}/g;
  const html: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = notePattern.exec(value)) !== null) {
    const [source, rawText, rawNote] = match;
    const noteText = rawText.trim();
    const noteBody = rawNote.trim();

    html.push(renderInlinePlain(value.slice(lastIndex, match.index), pagesBySlug));
    html.push(
      `<span class="inline-note" role="button" tabindex="0" aria-label="Note: ${escapeHtml(noteBody)}" data-note-text="${escapeHtml(noteText)}" data-note-body="${escapeHtml(noteBody)}" data-note-source="${escapeHtml(source)}">${renderInlinePlain(noteText, pagesBySlug)}</span>`,
    );
    lastIndex = notePattern.lastIndex;
  }

  html.push(renderInlinePlain(value.slice(lastIndex), pagesBySlug));
  return html.join("");
}

function appleMusicEmbedSrc(value: string) {
  const match = value.match(/^\{\{apple-music\s+(.+?)\s*\}\}$/);
  if (!match) return null;

  try {
    const url = new URL(match[1]);
    if (!["music.apple.com", "embed.music.apple.com"].includes(url.hostname)) {
      return null;
    }

    url.hostname = "embed.music.apple.com";
    return url.toString();
  } catch {
    return null;
  }
}

function findAppleMusicEmbedSrc(markdown: string) {
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const embedSrc = appleMusicEmbedSrc(line.trim());
    if (embedSrc) return embedSrc;
  }

  return null;
}

function renderAppleMusicEmbed(value: string) {
  const embedSrc = appleMusicEmbedSrc(value);
  if (!embedSrc) return null;

  return `<iframe class="apple-music-embed" allow="autoplay *; encrypted-media *;" frameborder="0" height="175" loading="lazy" sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-top-navigation-by-user-activation" src="${escapeHtml(embedSrc)}"></iframe>`;
}

function youtubeEmbedSrc(value: string) {
  const match = value.match(/^\{\{youtube\s+(.+?)\s*\}\}$/);
  if (!match) return null;

  try {
    const url = new URL(match[1]);
    const hostname = url.hostname.replace(/^www\./, "");
    let videoId: string | null = null;

    if (hostname === "youtu.be") {
      videoId = url.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "youtube-nocookie.com") {
      const pathParts = url.pathname.split("/").filter(Boolean);
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v");
      } else if (pathParts[0] === "embed" || pathParts[0] === "shorts" || pathParts[0] === "live") {
        videoId = pathParts[1] || null;
      }
    }

    if (!videoId || !/^[a-zA-Z0-9_-]{6,}$/.test(videoId)) {
      return null;
    }

    const embedUrl = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
    const start = url.searchParams.get("start") || url.searchParams.get("t");
    if (start && /^\d+s?$/.test(start)) {
      embedUrl.searchParams.set("start", start.replace(/s$/, ""));
    }

    return embedUrl.toString();
  } catch {
    return null;
  }
}

function findYoutubeEmbedSrc(markdown: string) {
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const embedSrc = youtubeEmbedSrc(line.trim());
    if (embedSrc) return embedSrc;
  }

  return null;
}

function renderYoutubeEmbed(value: string) {
  const embedSrc = youtubeEmbedSrc(value);
  if (!embedSrc) return null;

  return `<iframe class="youtube-embed" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen frameborder="0" loading="lazy" sandbox="allow-forms allow-popups allow-presentation allow-same-origin allow-scripts allow-top-navigation-by-user-activation" src="${escapeHtml(embedSrc)}"></iframe>`;
}

function renderNoteParagraphs(value: string, pagesBySlug: Map<string, WikiPage>) {
  return value
    .split(/\n{2,}/)
    .map((paragraph) =>
      paragraph
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .map((paragraph) => `<p>${renderInline(paragraph, pagesBySlug)}</p>`)
    .join("\n");
}

function renderNote(value: string, pagesBySlug: Map<string, WikiPage>) {
  const noteHtml = renderNoteParagraphs(value, pagesBySlug);

  if (!noteHtml) {
    return null;
  }

  return `<aside class="self-note" aria-label="Note to self">${noteHtml}</aside>`;
}

export function excerptFromMarkdown(markdown: string) {
  return markdown
    .replace(/^#\s+.+$/gm, "")
    .replace(/^\{\{apple-music\s+.+?\s*\}\}$/gm, "")
    .replace(/^\{\{youtube\s+.+?\s*\}\}$/gm, "")
    .replace(/\{\{note\s+([^|{}]+?)\s*\|\s*([^{}]+?)\s*\}\}/g, "$1")
    .replace(/^\{\{note\s+(.+?)\s*\}\}$/gm, "$1")
    .replace(/^\{\{note\s*\n([\s\S]*?)\n\}\}$/gm, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/[{}*_`>#-]/g, "")
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
  let paragraphStartLineIndex: number | null = null;
  let list:
    | {
        type: "ul" | "ol";
        start?: number;
        items: string[];
      }
    | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const sourceAttribute =
      paragraphStartLineIndex === null ? "" : ` data-source-line-index="${paragraphStartLineIndex}"`;
    html.push(`<p${sourceAttribute}>${renderInline(paragraph.join(" "), pagesBySlug)}</p>`);
    paragraph = [];
    paragraphStartLineIndex = null;
  };

  const flushList = () => {
    if (!list) return;
    const startAttribute = list.type === "ol" && list.start && list.start !== 1 ? ` start="${list.start}"` : "";
    html.push(`<${list.type}${startAttribute}>\n${list.items.join("\n")}\n</${list.type}>`);
    list = null;
  };

  const pushListItem = (type: "ul" | "ol", itemHtml: string, start?: number) => {
    flushParagraph();

    if (!list || list.type !== type) {
      flushList();
      list = { type, start, items: [] };
    }

    list.items.push(itemHtml);
  };

  for (const [lineIndex, line] of lines.entries()) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr />");
      continue;
    }

    const appleMusicEmbed = renderAppleMusicEmbed(trimmed);
    if (appleMusicEmbed) {
      flushParagraph();
      flushList();
      html.push(appleMusicEmbed);
      continue;
    }

    const youtubeEmbed = renderYoutubeEmbed(trimmed);
    if (youtubeEmbed) {
      flushParagraph();
      flushList();
      html.push(youtubeEmbed);
      continue;
    }

    const inlineNote = trimmed.match(/^\{\{note\s+(.+?)\s*\}\}$/);
    if (inlineNote) {
      flushParagraph();
      flushList();
      const note = renderNote(inlineNote[1], pagesBySlug);
      if (note) html.push(note);
      continue;
    }

    if (trimmed === "{{note") {
      const noteLines: string[] = [];
      let closingLineIndex = -1;

      for (let nextLineIndex = lineIndex + 1; nextLineIndex < lines.length; nextLineIndex += 1) {
        if (lines[nextLineIndex].trim() === "}}") {
          closingLineIndex = nextLineIndex;
          break;
        }

        noteLines.push(lines[nextLineIndex]);
      }

      if (closingLineIndex > -1) {
        flushParagraph();
        flushList();
        const note = renderNote(noteLines.join("\n"), pagesBySlug);
        if (note) html.push(note);
        lines.splice(lineIndex + 1, closingLineIndex - lineIndex);
        continue;
      }
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level} data-source-line-index="${lineIndex}">${renderInline(heading[2], pagesBySlug)}</h${level}>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushList();
      html.push(
        `<blockquote data-source-line-index="${lineIndex}">${renderInline(trimmed.replace(/^>\s?/, ""), pagesBySlug)}</blockquote>`,
      );
      continue;
    }

    const taskItem = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.+)$/);
    if (taskItem) {
      const checked = taskItem[1].toLowerCase() === "x";
      const checkedAttribute = checked ? " checked" : "";
      pushListItem(
        "ul",
        `<li class="task-list-item" data-source-line-index="${lineIndex}"><label><input class="todo-checkbox" type="checkbox" data-line-index="${lineIndex}"${checkedAttribute} /> <span>${renderInline(taskItem[2], pagesBySlug)}</span></label></li>`,
      );
      continue;
    }

    const unorderedItem = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedItem) {
      pushListItem("ul", `<li data-source-line-index="${lineIndex}">${renderInline(unorderedItem[1], pagesBySlug)}</li>`);
      continue;
    }

    const orderedItem = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedItem) {
      pushListItem("ol", `<li data-source-line-index="${lineIndex}">${renderInline(orderedItem[2], pagesBySlug)}</li>`, Number(orderedItem[1]));
      continue;
    }

    flushList();
    paragraphStartLineIndex ??= lineIndex;
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushList();
  return html.join("\n");
}
