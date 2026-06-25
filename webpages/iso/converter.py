#!/usr/bin/env python3
"""
converter.py  --  run manually:  python converter.py

Scans the FIRST level of docs/ and converts:
  ODT, DOCX        -> Markdown        -> docs/conv_markdown/   (no pandoc needed)
  ODS, XLSX, CSV   -> CSV + JSON      -> docs/conv_tables/
  (every file)     -> metadata JSON   -> docs/conv_meta/

Requires: pandas, openpyxl, odfpy, python-docx
"""

import json
import shutil
import datetime
from pathlib import Path

import pandas as pd
from odf.opendocument import load as odf_load
from odf import text, table
from odf.element import Element
from docx import Document
from docx.table import Table as DocxTable
from docx.text.paragraph import Paragraph as DocxParagraph

# If True: empty the conv_ folders at the start of every run (clean regenerate,
# removes orphaned outputs). If False: just overwrite files of the same name.
CLEAN_OUTPUTS = True

# --- Paths (script lives in iso/, docs is a subfolder) ---------------------
SCRIPT_DIR = Path(__file__).resolve().parent
DOCS_DIR   = SCRIPT_DIR / "docs"
MD_DIR     = DOCS_DIR / "conv_markdown"
TABLES_DIR = DOCS_DIR / "conv_tables"
META_DIR   = DOCS_DIR / "conv_meta"

TABLE_EXTS = {".ods", ".xlsx", ".csv"}

# Element types whose text must NOT leak into the body (comments, tracked changes)
_SKIP_ELEMENTS = {"annotation", "tracked-changes", "note"}


# --- ODT -> Markdown (pure Python, via odfpy) ------------------------------
def _odt_text(node):
    s = ""
    for n in node.childNodes:
        if n.nodeType == 3:                       # plain text node
            s += n.data
        elif isinstance(n, Element):
            local = n.qname[1]
            if local in _SKIP_ELEMENTS:
                continue
            if local == "tab":
                s += "\t"
            elif local == "line-break":
                s += "\n"
            else:
                s += _odt_text(n)
    return s


def convert_odt(src: Path):
    doc = odf_load(str(src))
    out = []
    for el in doc.text.childNodes:
        if not isinstance(el, Element):
            continue
        name = el.qname[1]
        if name == "h":                           # heading
            lvl = max(1, min(int(el.getAttribute("outlinelevel") or 1), 6))
            t = _odt_text(el).strip()
            if t:
                out.append("#" * lvl + " " + t)
        elif name == "p":                         # paragraph
            t = _odt_text(el).strip()
            if t:
                out.append(t)
        elif name == "list":                      # bullet / numbered list
            for item in el.getElementsByType(text.ListItem):
                t = _odt_text(item).strip()
                if t:
                    out.append("- " + t)
        elif name == "table":                     # table
            md = []
            for i, row in enumerate(el.getElementsByType(table.TableRow)):
                cells = [_odt_text(c).strip().replace("\n", " ")
                         for c in row.getElementsByType(table.TableCell)]
                md.append("| " + " | ".join(cells) + " |")
                if i == 0:
                    md.append("| " + " | ".join("---" for _ in cells) + " |")
            out.append("\n".join(md))

    dest = MD_DIR / (src.stem + ".md")
    dest.write_text("\n\n".join(out), encoding="utf-8")
    return [dest]


# --- DOCX -> Markdown (pure Python, via python-docx) -----------------------
def _docx_blocks(doc):
    """Yield Paragraph and Table objects in true document order."""
    for child in doc.element.body.iterchildren():
        if child.tag.endswith("}p"):
            yield DocxParagraph(child, doc)
        elif child.tag.endswith("}tbl"):
            yield DocxTable(child, doc)


def convert_docx(src: Path):
    doc = Document(str(src))
    out = []
    for block in _docx_blocks(doc):
        if isinstance(block, DocxParagraph):
            t = block.text.strip()
            if not t:
                continue
            style = (block.style.name or "").lower()
            if style.startswith("heading"):
                try:
                    lvl = int(style.split()[-1])
                except ValueError:
                    lvl = 1
                out.append("#" * max(1, min(lvl, 6)) + " " + t)
            elif "list bullet" in style:
                out.append("- " + t)
            elif "list number" in style:
                out.append("1. " + t)
            else:
                out.append(t)
        elif isinstance(block, DocxTable):
            md = []
            for i, row in enumerate(block.rows):
                cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                md.append("| " + " | ".join(cells) + " |")
                if i == 0:
                    md.append("| " + " | ".join("---" for _ in cells) + " |")
            out.append("\n".join(md))

    dest = MD_DIR / (src.stem + ".md")
    dest.write_text("\n\n".join(out), encoding="utf-8")
    return [dest]

def _json_default(o):
    """Make pandas/np types JSON-safe (dates -> ISO strings, fallback -> str)."""
    if isinstance(o, (pd.Timestamp, datetime.datetime, datetime.date)):
        return o.isoformat()
    return str(o)


def convert_table(src: Path):
    ext = src.suffix.lower()
    if ext == ".csv":
        sheets = {"Sheet1": pd.read_csv(src)}
    elif ext == ".ods":
        sheets = pd.read_excel(src, sheet_name=None, engine="odf")
    elif ext == ".xlsx":
        sheets = pd.read_excel(src, sheet_name=None, engine="openpyxl")
    else:
        return []

    written = []
    json_payload = {}
    for name, df in sheets.items():
        df = df.copy()
        df.columns = [str(c) for c in df.columns]   # headers -> safe JSON keys
        df = df.fillna("")
        if len(sheets) == 1:
            csv_path = TABLES_DIR / (src.stem + ".csv")
        else:
            safe = str(name).replace(" ", "_")
            csv_path = TABLES_DIR / f"{src.stem}__{safe}.csv"
        df.to_csv(csv_path, index=False, encoding="utf-8")
        written.append(csv_path)
        json_payload[str(name)] = df.to_dict(orient="records")

    json_path = TABLES_DIR / (src.stem + ".json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_payload, f, ensure_ascii=False, indent=2,
                  default=_json_default)   # <-- handles Timestamp values
    written.append(json_path)
    return written

# --- Document register ------------------------------------------------------
def update_docregister(src: Path):
    reg_path = SCRIPT_DIR / "docregister.json"

    if not reg_path.exists():
        return

    with open(reg_path, "r", encoding="utf-8") as f:
        reg = json.load(f)

    changed = datetime.datetime.fromtimestamp(
        src.stat().st_mtime
    ).isoformat(timespec="seconds")

    updated = False

    for doc in reg.values():
        if doc.get("file") == src.stem:
            doc["last_changed"] = changed
            updated = True

    if updated:
        with open(reg_path, "w", encoding="utf-8") as f:
            json.dump(reg, f, ensure_ascii=False, indent=2)
# --- Metadata ---------------------------------------------------------------
def write_metadata(src: Path, outputs):
    stat = src.stat()
    meta = {
        "source_file":  src.name,
        "extension":    src.suffix.lower(),
        "size_bytes":   stat.st_size,
        "modified":     datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "converted_at": datetime.datetime.now().isoformat(),
        "outputs":      [str(p.relative_to(DOCS_DIR)) for p in outputs],
    }
    meta_path = META_DIR / (src.stem + ".json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)


# --- Main -------------------------------------------------------------------
def main():
    if CLEAN_OUTPUTS:
        for d in (MD_DIR, TABLES_DIR, META_DIR):
            if d.exists():
                shutil.rmtree(d)

    for d in (MD_DIR, TABLES_DIR, META_DIR):
        d.mkdir(parents=True, exist_ok=True)

    if not DOCS_DIR.is_dir():
        print(f"docs folder not found: {DOCS_DIR}")
        return

    for entry in sorted(DOCS_DIR.iterdir()):
        if entry.is_dir():
            continue  # first level only -> automatically skips conv_* folders
        ext = entry.suffix.lower()
        try:
            if ext == ".odt":
                outputs = convert_odt(entry)
            elif ext == ".docx":
                outputs = convert_docx(entry)
            elif ext in TABLE_EXTS:
                outputs = convert_table(entry)
            else:
                print(f"skip (unsupported): {entry.name}")
                continue
            write_metadata(entry, outputs)
            update_docregister(entry)

            print(f"OK   {entry.name}  ->  {len(outputs)} file(s)")
        except Exception as e:
            print(f"ERR  {entry.name}: {e}")


if __name__ == "__main__":
    main()