import html
import sys
from pathlib import Path
import markdown

import mammoth          # DOCX
import fitz             # PDF (PyMuPDF)
from odf import text as odf_text
from odf import teletype
from odf.opendocument import load as odf_load


ROOT = Path(__file__).resolve().parent
BLOG_DIR = ROOT / "assets" / "blog"

HTML_WRAP = """<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
</head>
<body>
<article class="prose">
{body}
</article>
</body>
</html>
"""


def log(msg):
    print(msg)


def convert_docx(src: Path, title: str) -> str:
    with src.open("rb") as f:
        result = mammoth.convert_to_html(f)
    return HTML_WRAP.format(
        title=html.escape(title),
        body=result.value or ""
    )


def convert_pdf(src: Path, title: str) -> str:
    doc = fitz.open(src)
    parts = []
    for i, page in enumerate(doc, start=1):
        parts.append(
            f"<section data-page='{i}'>\n{page.get_text('html')}\n</section>"
        )
    return HTML_WRAP.format(
        title=html.escape(title),
        body="\n<hr />\n".join(parts)
    )

def convert_md(src: Path, title: str) -> str:
    md = src.read_text(encoding="utf-8", errors="replace")
    body = markdown.markdown(md, extensions=["extra", "sane_lists"])
    return HTML_WRAP.format(
        title=html.escape(title),
        body=body
    )

def convert_odt_basic(src: Path, title: str) -> str:
    odt = odf_load(str(src))
    paras = odt.getElementsByType(odf_text.P)
    body = []
    for p in paras:
        t = teletype.extractText(p).strip()
        if t:
            body.append(f"<p>{html.escape(t)}</p>")
    return HTML_WRAP.format(
        title=html.escape(title),
        body="\n".join(body) if body else "<p>(Kein Text gefunden.)</p>"
    )


def pick_source_by_extension(folder: Path) -> Path | None:
    """
    Pick the best source file in this folder based on extension only.
    Priority: DOCX > PDF > ODT > MD
    Within the same extension: newest mtime wins
    """
    priority = [".docx", ".pdf", ".odt", ".md"]
    best = None
    best_rank = 10**9
    best_mtime = -1.0

    for p in folder.iterdir():
        if not p.is_file():
            continue
        ext = p.suffix.lower()
        if ext not in priority:
            continue

        rank = priority.index(ext)
        mtime = p.stat().st_mtime

        # Prefer higher-priority formats; for same priority pick newest
        if (rank < best_rank) or (rank == best_rank and mtime > best_mtime):
            best = p
            best_rank = rank
            best_mtime = mtime

    return best



def main():
    if not BLOG_DIR.exists():
        log(f"ERROR: Blog folder not found: {BLOG_DIR}")
        sys.exit(1)

    converted = 0

    for folder in sorted(p for p in BLOG_DIR.iterdir() if p.is_dir()):
        title = folder.name.replace("-", " ").strip()
        out = folder / "article.html"
        src = pick_source_by_extension(folder)

        if not src:
            # No docx/pdf/odt/md found (images/meta don’t count as article source)
            log(f"– {folder.name}: no article source (.docx/.pdf/.odt/.md) found, skipped")
            continue

        # Only (re)build article.html if the chosen source is newer than article.html
        if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
            log(f"✓ {folder.name}: article.html is up to date (source: {src.name})")
            continue


        log(f"→ Converting: {folder.name} ({src.name})")

        try:
            ext = src.suffix.lower()
            if ext == ".docx":
                html_out = convert_docx(src, title)
            elif ext == ".pdf":
                html_out = convert_pdf(src, title)
            elif ext == ".odt":
                html_out = convert_odt_basic(src, title)
            elif ext == ".md":
                html_out = convert_md(src, title)
            else:
                log(f"  ! Unsupported type: {src.name}")
                continue


            out.write_text(html_out, encoding="utf-8")
            converted += 1
            log(f"  ✓ wrote {out.relative_to(ROOT)}")

        except Exception as e:
            log(f"  ✗ ERROR converting {folder.name}: {e}")

    log(f"\nDone. Converted {converted} article(s).")


if __name__ == "__main__":
    main()
