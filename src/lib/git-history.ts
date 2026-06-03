import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { extractTitle, pagePathForSlug, readAllPages, readPage, renderMarkdown, titleFromSlug, writePage } from "@/lib/wiki";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();

export type PageCommit = {
  hash: string;
  shortHash: string;
  authorDate: string;
  subject: string;
};

export type PageSaveResult = {
  page: ReturnType<typeof readPage>;
  commit: {
    created: boolean;
    hash?: string;
  };
};

let writeQueue = Promise.resolve();

function queueGitWrite<T>(task: () => Promise<T>) {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function pageRelativePath(slug: string) {
  const filePath = pagePathForSlug(slug);
  const relativePath = path.relative(repoRoot, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Invalid page path.");
  }

  return relativePath.split(path.sep).join("/");
}

function assertRevision(revision: string) {
  if (!/^[a-f0-9]{7,40}$/i.test(revision)) {
    throw new Error("Invalid revision.");
  }
}

function commitMessageFor(action: "Update" | "Restore", slug: string, revision?: string) {
  const title = titleFromSlug(slug);
  if (action === "Restore" && revision) {
    return `Restore ${title} to ${revision.slice(0, 7)}`;
  }

  return `Update ${title}`;
}

async function git(args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return String(stdout);
  } catch (error) {
    const err = error as { message?: string; stderr?: string };
    throw new Error(err.stderr?.trim() || err.message || "Git command failed.");
  }
}

async function gitResult(args: string[]) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, stdout: String(stdout) };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    };
  }
}

async function hasPageChanges(relativePath: string) {
  const status = await git(["status", "--porcelain", "--", relativePath]);
  return status.trim().length > 0;
}

async function isTracked(relativePath: string) {
  const result = await gitResult(["ls-files", "--error-unmatch", "--", relativePath]);
  return result.ok;
}

async function commitPage(slug: string, action: "Update" | "Restore", revision?: string) {
  const relativePath = pageRelativePath(slug);

  if (!(await hasPageChanges(relativePath))) {
    return { created: false };
  }

  if (!(await isTracked(relativePath))) {
    await git(["add", "--", relativePath]);
  }

  const message = commitMessageFor(action, slug, revision);
  await git(["commit", "-m", message, "--only", "--", relativePath]);
  const hash = (await git(["rev-parse", "HEAD"])).trim();

  return { created: true, hash };
}

export async function savePageVersion(slug: string, markdown: string): Promise<PageSaveResult> {
  return queueGitWrite(async () => {
    const savedPage = await writePage(slug, markdown);
    const commit = await commitPage(savedPage.slug, "Update");
    const page = readPage(savedPage.slug);

    return { page, commit };
  });
}

export async function listPageHistory(slug: string): Promise<PageCommit[]> {
  const relativePath = pageRelativePath(slug);
  const output = await git(["log", "--format=%H%x09%h%x09%aI%x09%s", "--", relativePath]);

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, authorDate, ...subjectParts] = line.split("\t");
      return {
        hash,
        shortHash,
        authorDate,
        subject: subjectParts.join("\t"),
      };
    });
}

export async function readPageRevision(slug: string, revision: string) {
  assertRevision(revision);
  const relativePath = pageRelativePath(slug);
  const markdown = await git(["show", `${revision}:${relativePath}`]);
  const normalizedSlug = readPage(slug).slug;
  const fallbackTitle = titleFromSlug(normalizedSlug);
  const pages = readAllPages();

  return {
    title: extractTitle(markdown, fallbackTitle),
    slug: normalizedSlug,
    revision,
    markdown,
    html: renderMarkdown(markdown, pages),
  };
}

export async function restorePageRevision(slug: string, revision: string): Promise<PageSaveResult> {
  assertRevision(revision);

  return queueGitWrite(async () => {
    const version = await readPageRevision(slug, revision);
    const restoredPage = await writePage(version.slug, version.markdown);
    const commit = await commitPage(restoredPage.slug, "Restore", revision);
    const page = readPage(restoredPage.slug);

    return { page, commit };
  });
}
