// assets/tools/generate-indexes.mjs
// Generates:
// - assets/blog-index.json
// - assets/projects-index.json
// - assets/activities-index.json (merged newest first)
//
// How it decides files (by extension, not filename):
// Blog folder may contain:
//   - meta.json (required-ish, but we'll tolerate missing)
//   - article.html OR *.html (first html file found) OR *.md
//   - excerpt.txt (optional) OR any *.txt as excerpt fallback
//   - cover image: *.png|*.jpg|*.jpeg|*.webp|*.gif
//
// Project folder may contain:
//   - meta.json
//   - synopsis text: *.txt|*.md|*.html (optional)
//   - cover image: *.png|*.jpg|*.jpeg|*.webp|*.gif
//
// Ignores: .odt and everything else unless used as above.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd(); // run from project root (where assets/ lives)
const ASSETS = path.join(ROOT, "assets");

const BLOG_DIR = path.join(ASSETS, "blog");
const PROJECTS_DIR = path.join(ASSETS, "projects");

const OUT_BLOG = path.join(ASSETS, "blog-index.json");
const OUT_PROJECTS = path.join(ASSETS, "projects-index.json");
const OUT_ACTIVITIES = path.join(ASSETS, "activities-index.json");

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXT = new Set([".txt", ".md", ".html"]);

const CALENDAR_DIR = path.join(ASSETS, "calendar");
const OUT_CALENDAR = path.join(ASSETS, "calendar-index.json");

function buildCalendarIndex() {
  if (!isDir(CALENDAR_DIR)) return { generatedAt: new Date().toISOString(), items: [] };

  const files = fs.readdirSync(CALENDAR_DIR)
    .filter(f => f.toLowerCase().endsWith(".json"));

  const items = [];
  for (const f of files) {
    const p = path.join(CALENDAR_DIR, f);
    const ev = safeReadJson(p);
    if (!ev || !ev.date) continue;

    items.push({
      id: ev.id || f.replace(/\.json$/i, ""),
      date: String(ev.date || "").slice(0, 10),
      title: ev.title || "Termin",
      projects: Array.isArray(ev.projects) ? ev.projects : [],
      tags: Array.isArray(ev.tags) ? ev.tags : [],
      where: ev.where || "",
      note: ev.note || ""
    });
  }

  // sort ascending by date (calendar view), but you can also sort desc for “next up”
  items.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return { generatedAt: new Date().toISOString(), items };
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeReadJson(p) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function safeReadText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function pickFirstByExt(files, exts) {
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (exts.has(ext)) return f;
  }
  return "";
}

function pickCoverImage(files) {
  // Prefer names that include "cover" if present, otherwise first image.
  const coverFirst = files.find(f => IMAGE_EXT.has(path.extname(f).toLowerCase()) && /cover/i.test(f));
  if (coverFirst) return coverFirst;
  return pickFirstByExt(files, IMAGE_EXT);
}

function normalizeUpdated(meta, folderPath) {
  // Prefer meta.updated, then meta.date, else use folder mtime.
  const mUpdated =
    (meta && (meta.updated || meta.date || meta.lastEdited || meta.last_edit)) || "";

  if (typeof mUpdated === "string" && mUpdated.trim()) return mUpdated.trim();

  try {
    const st = fs.statSync(folderPath);
    // ISO without ms
    return new Date(st.mtime).toISOString().slice(0, 19) + "Z";
  } catch {
    return "";
  }
}

function toWebPath(absPath) {
  // Convert absolute OS path -> web path starting with /assets/...
  const rel = path.relative(ROOT, absPath).split(path.sep).join("/");
  return "/" + rel;
}

function listSubfolders(baseDir) {
  if (!isDir(baseDir)) return [];
  return fs
    .readdirSync(baseDir)
    .map(name => path.join(baseDir, name))
    .filter(isDir);
}

function buildBlogIndex() {
  const folders = listSubfolders(BLOG_DIR);

  const items = folders.map(folderPath => {
    const slug = path.basename(folderPath);

    const files = fs.readdirSync(folderPath);
    const metaPath = path.join(folderPath, "meta.json");
    const meta = safeReadJson(metaPath) || {};

    // Article: prefer article.html if present, else first *.html, else first *.md
    let articleFile = "";
    if (files.includes("article.html")) articleFile = "article.html";
    else {
      articleFile = pickFirstByExt(files, new Set([".html"])) || pickFirstByExt(files, new Set([".md"]));
    }

    // Excerpt: prefer excerpt.txt, else first .txt
    let excerptFile = "";
    if (files.includes("excerpt.txt")) excerptFile = "excerpt.txt";
    else excerptFile = pickFirstByExt(files, new Set([".txt"]));

    const coverFile = pickCoverImage(files);

    const updated = normalizeUpdated(meta, folderPath);
    const title = meta.title || meta.name || slug;

    // Only read excerpt text (short). Full article remains in file.
    const excerpt = excerptFile ? safeReadText(path.join(folderPath, excerptFile)).trim() : (meta.excerpt || "");

    // alsoPublished can live in meta.json as you want
    const alsoPublished = meta.alsoPublished || meta.links || null;

    return {
      type: "blog",
      slug,
      title,
      updated,
      excerpt,
      cover: coverFile ? toWebPath(path.join(folderPath, coverFile)) : "",
      contentUrl: articleFile ? toWebPath(path.join(folderPath, articleFile)) : "",
      metaUrl: fs.existsSync(metaPath) ? toWebPath(metaPath) : "",
      alsoPublished
    };
  });

  // newest first
  items.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

  return { generatedAt: new Date().toISOString(), items };
}

function buildProjectsIndex() {
  const folders = listSubfolders(PROJECTS_DIR);

  const items = folders.map(folderPath => {
    const slug = path.basename(folderPath);

    const files = fs.readdirSync(folderPath);
    const metaPath = path.join(folderPath, "meta.json");
    const meta = safeReadJson(metaPath) || {};

    const coverFile = pickCoverImage(files);

    // Project text: prefer any .txt/.md/.html (excluding meta.json)
    const textFile = files.find(f => {
      const ext = path.extname(f).toLowerCase();
      if (!TEXT_EXT.has(ext)) return false;
      if (f.toLowerCase() === "meta.json") return false;
      if (f.toLowerCase() === "excerpt.txt") return false;
      if (f.toLowerCase() === "article.html") return false;
      return true;
    }) || "";

    const updated = normalizeUpdated(meta, folderPath);
    const title = meta.title || meta.name || slug;

    const synopsis = textFile ? safeReadText(path.join(folderPath, textFile)).trim() : (meta.excerpt || meta.synopsis || "");

    return {
      type: "project",
      slug,
      title,
      updated,
      excerpt: synopsis,
      cover: coverFile ? toWebPath(path.join(folderPath, coverFile)) : "",
      contentUrl: textFile ? toWebPath(path.join(folderPath, textFile)) : "",
      metaUrl: fs.existsSync(metaPath) ? toWebPath(metaPath) : ""
    };
  });

  items.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

  return { generatedAt: new Date().toISOString(), items };
}

function mergeActivities(blogIndex, projectIndex) {
  const merged = [...(blogIndex.items || []), ...(projectIndex.items || [])]
    .sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));

  return { generatedAt: new Date().toISOString(), items: merged };
}

function writeJson(outPath, data) {
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  console.log("Wrote", path.relative(ROOT, outPath));
}

function main() {
  const blogIndex = buildBlogIndex();
  const projectsIndex = buildProjectsIndex();
  const activitiesIndex = mergeActivities(blogIndex, projectsIndex);
  const calendarIndex = buildCalendarIndex();

  writeJson(OUT_BLOG, blogIndex);
  writeJson(OUT_PROJECTS, projectsIndex);
  writeJson(OUT_ACTIVITIES, activitiesIndex);
  writeJson(OUT_CALENDAR, calendarIndex);
}

main();


