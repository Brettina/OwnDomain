import { promises as fs } from "fs";
import path from "path";

const ROOT = process.cwd();
const BLOG_DIR = path.join(ROOT, "assets", "blog");
const PROJECTS_DIR = path.join(ROOT, "assets", "projects");

const OUT_ACTIVITIES = path.join(ROOT, "assets", "activities.json");

// optional: write rendered fulltext html here (for blogs and optionally projects)
const OUT_CONTENT_DIR = path.join(ROOT, "assets", "content");

const IMG_RE = /\.(png|jpe?g|webp)$/i;
const TXT_RE = /\.txt$/i;
const HTML_RE = /\.html?$/i;
const MD_RE = /\.md$/i;

// Ignore these (and anything else not matched)
const IGNORE_RE = /\.(odt|docx?|pdf|psd|ai)$/i;

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function listSubdirs(dir) {
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter(e => e.isDirectory()).map(e => e.name);
}

async function readJsonIfExists(p) {
  if (!(await exists(p))) return null;
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}

async function readText(p) {
  return (await fs.readFile(p, "utf8")).trim();
}

async function folderMTimeISO(folderPath) {
  const stat = await fs.stat(folderPath);
  const d = new Date(stat.mtimeMs);
  return d.toISOString().slice(0, 10);
}

function webPathFor(type, slug, filename) {
  const base = type === "blog" ? "/assets/blog" : "/assets/projects";
  return `${base}/${slug}/${filename}`;
}

function defaultUrlFor(type, slug) {
  return type === "blog"
    ? `/webpages/blog/${slug}/`
    : `/webpages/projects/${slug}/`;
}

async function pickFiles(folderPath) {
  const entries = await fs.readdir(folderPath, { withFileTypes: true });
  const files = entries
    .filter(e => e.isFile())
    .map(e => e.name)
    .filter(name => !IGNORE_RE.test(name));

  // cover image: first image
  const cover = files.find(f => IMG_RE.test(f)) || "";

  // excerpt: prefer excerpt.txt, otherwise first .txt
  const excerptFile =
    files.find(f => f.toLowerCase() === "excerpt.txt") ||
    files.find(f => TXT_RE.test(f)) ||
    "";

  // content: prefer .html, else .md (any filename)
  const htmlFile = files.find(f => HTML_RE.test(f)) || "";
  const mdFile = files.find(f => MD_RE.test(f)) || "";
  const contentFile = htmlFile || mdFile || "";

  return { files, cover, excerptFile, contentFile };
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Very light markdown -> HTML:
 * - paragraphs
 * - headings #, ##, ###
 * - unordered lists with leading "- "
 * This is intentionally simple and robust (won’t choke).
 */
function mdToHtml(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let inList = false;

  const flushList = () => {
    if (inList) {
      html += "</ul>\n";
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (!line.trim()) {
      flushList();
      continue;
    }

    const hMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch) {
      flushList();
      const level = hMatch[1].length;
      html += `<h${level}>${escapeHtml(hMatch[2])}</h${level}>\n`;
      continue;
    }

    const liMatch = line.match(/^\-\s+(.*)$/);
    if (liMatch) {
      if (!inList) {
        html += "<ul>\n";
        inList = true;
      }
      html += `<li>${escapeHtml(liMatch[1])}</li>\n`;
      continue;
    }

    flushList();
    html += `<p>${escapeHtml(line)}</p>\n`;
  }

  flushList();
  return html.trim();
}

async function writeContentHtml(type, slug, title, coverUrl, bodyHtml) {
  const outDir = path.join(OUT_CONTENT_DIR, type);
  await fs.mkdir(outDir, { recursive: true });

  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/assets/styles.css" />
  <meta name="color-scheme" content="light dark" />
</head>
<body class="page-content">
  <main class="container">
    <article class="section">
      <h1>${escapeHtml(title)}</h1>
      ${coverUrl ? `<img src="${coverUrl}" alt="" style="width:100%;height:auto;border-radius:16px;margin:14px 0;" />` : ""}
      <div class="prose">
        ${bodyHtml}
      </div>
    </article>
  </main>
</body>
</html>`;

  const outFile = path.join(outDir, `${slug}.html`);
  await fs.writeFile(outFile, html, "utf8");
  return `/assets/content/${type}/${slug}.html`;
}

async function buildItem(type, baseDir, slug) {
  const folderPath = path.join(baseDir, slug);
  const meta = await readJsonIfExists(path.join(folderPath, "meta.json"));

  const { cover, excerptFile, contentFile } = await pickFiles(folderPath);

  const updated = (meta && meta.updated) ? meta.updated : await folderMTimeISO(folderPath);
  const title = (meta && meta.title) ? meta.title : slug;
  const url = (meta && meta.url) ? meta.url : defaultUrlFor(type, slug);

  const image = cover ? webPathFor(type, slug, cover) : "";

  let excerpt = "";
  if (excerptFile) excerpt = await readText(path.join(folderPath, excerptFile));

  // Full content handling:
  // - blog: require md/html; generate content html
  // - project: optional; if no content, we just don't create contentUrl
  let contentUrl = "";
  if (contentFile) {
    const fullPath = path.join(folderPath, contentFile);
    const raw = await readText(fullPath);

    let bodyHtml = "";
    if (HTML_RE.test(contentFile)) {
      // treat as already-HTML body (but keep it inside our wrapper)
      bodyHtml = raw;
    } else if (MD_RE.test(contentFile)) {
      bodyHtml = mdToHtml(raw);
    }

    if (bodyHtml) {
      contentUrl = await writeContentHtml(type, slug, title, image, bodyHtml);
    }
  }

  return {
    type,
    slug,
    title,
    updated,
    image,
    excerpt,
    url,
    contentUrl // may be "" for projects or if no content file found
  };
}

async function main() {
  const blogSlugs = await listSubdirs(BLOG_DIR);
  const projectSlugs = await listSubdirs(PROJECTS_DIR);

  const items = [];

  for (const slug of blogSlugs) {
    items.push(await buildItem("blog", BLOG_DIR, slug));
  }

  for (const slug of projectSlugs) {
    items.push(await buildItem("project", PROJECTS_DIR, slug));
  }

  items.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));

  await fs.writeFile(OUT_ACTIVITIES, JSON.stringify({ items }, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT_ACTIVITIES} (${items.length} items)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
