"""Index the Documents in Playwall of the manual, for the Manager to read on the published copy.

Usage:
    python playwall.py [--pdf Materiale/Triangle-Agency.pdf] [--force]

Every Document in Playwall carries its Code (A1 ... Z3) in 25 pt type in the page margin,
with its Title in 20 pt type running up or down the margin beneath it. A Document runs from
its Code to the next Code, across any pages in between (the image-only pages that continue
it). Each one is cut out of the rendered pages as WebP pictures, one per page it spans.

The pictures and the index (Code -> Title, page, pictures) are written to playwall/files/,
sealed. The Playwall has a key of its own (playwall/key); each Document is sealed with a key
worked out from it and its Code (document_key), the index with the Playwall key itself.
build_static.make_access puts, sealed with each account's credentials:
  - for the Manager, the Playwall key: every Document, and the index;
  - for a player, the keys of only the Documents their agent has unlocked (unlocked_codes):
    the coded boxes ticked on the Realta, Anomalia and Competenza tracks, and the Documents
    of the anomaly answer tracks filled to the end. Nothing else, and no index.
So on the published copy each one reads only what they may (js/playwall.js), though all of
them can reach the same files. What a player has unlocked is as it was when published.

Needs pdftoppm (Poppler) on the PATH, pypdf and Pillow. Materiale/ is not published, so
run this once on the computer that has the manual; build_static.py then publishes what it
wrote. It runs again only when the manual changes (or with --force).
"""

import argparse
import base64
import hashlib
import io
import json
import re
import secrets
import shutil
import subprocess
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
PDF = BASE_DIR / "Materiale" / "Triangle-Agency.pdf"
PLAYWALL_DIR = BASE_DIR / "playwall"
FILES_DIR = PLAYWALL_DIR / "files"           # sealed: what is published, as playwall/<name>
KEY_FILE = PLAYWALL_DIR / "key"              # never published, except inside the Manager's account
MANIFEST = PLAYWALL_DIR / "manifest.json"    # what was built, from which manual
INDEX = PLAYWALL_DIR / "index.json"          # the index, unsealed, for build_static (never published)
VERSION = 2                                  # bump to rebuild when the cutting or sealing changes

CODE_SIZE = 25        # pt: a Document's Code; references to other Codes are 10-12 pt
TITLE_SIZE = 20       # pt: its Title, rotated in the margin
RENDER_HEIGHT = 1400  # px of a whole page
WEBP_QUALITY = 74
CODE = re.compile(r"[A-Z]\d{1,2}")
FIRST_CODE = "A1"


class PlaywallError(Exception):
    """Building the index cannot go ahead; the message says why."""


# -----------------------------
# SEALING (the same keystream as build_static.seal and js/access.js)
# -----------------------------
def keystream(key, nonce, length):
    return b"".join(hashlib.sha256(key + nonce + block.to_bytes(4, "big")).digest()
                    for block in range((length + 31) // 32))[:length]


def seal_bytes(key, data):
    """`data` sealed as nonce (16 bytes) + data XOR keystream. The nonce comes from the data,
    so the same file seals the same way and an unchanged Playwall publishes unchanged."""
    nonce = hashlib.sha256(key + data).digest()[:16]
    if not data:
        return nonce
    stream = keystream(key, nonce, len(data))
    return nonce + (int.from_bytes(data, "big") ^ int.from_bytes(stream, "big")).to_bytes(len(data), "big")


def content_key():
    """The Playwall's own key, made once."""
    if KEY_FILE.is_file():
        return bytes.fromhex(KEY_FILE.read_text(encoding="ascii").strip())
    PLAYWALL_DIR.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    KEY_FILE.write_text(key.hex(), encoding="ascii")
    return key


def document_key(key, code):
    """The key of one Document (js/access.js documentKey works it out the same way)."""
    return hashlib.sha256(b"document\n" + key + code.encode("utf-8")).digest()


def file_name(key, label):
    """A published name that says nothing of which Document it holds."""
    return hashlib.sha256(key + label.encode("utf-8")).hexdigest()[:20] + ".bin"


# -----------------------------
# WHAT THE PUBLISHED COPY GETS
# -----------------------------
def read_manifest():
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return None


def published_files():
    """{published path: path here, relative to BASE_DIR} of the sealed Playwall; empty when it was never built."""
    manifest = read_manifest()
    if not manifest:
        return {}
    files = {}
    for name in manifest.get("files") or []:
        if (FILES_DIR / name).is_file():
            files[f"playwall/{name}"] = (FILES_DIR / name).relative_to(BASE_DIR).as_posix()
    return files


def built():
    manifest = read_manifest()
    return bool(manifest) and KEY_FILE.is_file() and INDEX.is_file() and (FILES_DIR / manifest.get("index", "")).is_file()


def manager_details():
    """What goes into the Manager's sealed account: the key and where the index is. None without a Playwall."""
    if not built():
        return None
    return {"key": base64.b64encode(content_key()).decode("ascii"), "index": f"playwall/{read_manifest()['index']}"}


# -----------------------------
# WHAT A PLAYER HAS UNLOCKED
# -----------------------------
# The coded boxes of the tracks, read from the viewer's own tables, so they are kept in one place.
def read_js(name):
    return (BASE_DIR / "js" / name).read_text(encoding="utf-8")


def track_table(name):
    """{box: Code} of the `const DOCUMENTS = { 1: 'C4', ... }` in js/<name>."""
    match = re.search(r"const DOCUMENTS = \{([^}]*)\}", read_js(name))
    if not match:
        raise PlaywallError(f"No DOCUMENTS table in js/{name}")
    return {int(box): code for box, code in re.findall(r"(\d+):\s*'([A-Z]\d{1,2})'", match[1])}


def track_tables():
    """The Codes of every track, and of the answers of every Anomalia's abilities."""
    anomaly_data = read_js("anomalyData.js")
    abilities, _ = json.JSONDecoder().raw_decode(anomaly_data.split("ANOMALY_ABILITIES =", 1)[1].lstrip())
    ranks = re.findall(r"from:\s*(\d+),[^}]*code:\s*'([A-Z]\d{1,2})'", read_js("badge.js"))
    return {
        "reality": track_table("relationships.js"),
        "anomaly": track_table("anomalies.js"),
        "competency": {int(box): code for box, code in ranks},
        # "Sussurro:0" -> the Codes of its two answers, as js/anomalies.js keys an ability's state.
        "answers": {f"{anomaly}:{index}": [str(answer.get("reference") or "") for answer in ability.get("answers") or []]
                    for anomaly, entries in abilities.items() for index, ability in enumerate(entries)},
    }


def number(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def filled(answers, index):
    """Whether answer track `index` has all 3 boxes marked."""
    return isinstance(answers, list) and index < len(answers) and number(answers[index]) >= 3


def unlocked_codes(char, tables=None):
    """The Codes an agent has unlocked: the coded boxes up to where each track is marked, and
    the Document of every answer track filled to the end, of any Anomalia it has had."""
    tables = tables or track_tables()
    char = char if isinstance(char, dict) else {}
    anomaly = char.get("anomalyState") if isinstance(char.get("anomalyState"), dict) else {}
    reached = {"reality": number(char.get("realityProgress")), "competency": number(char.get("competencyProgress")),
               "anomaly": number(anomaly.get("progress"))}
    codes = {code for track, progress in reached.items() for box, code in tables[track].items() if box <= progress}
    abilities = anomaly.get("abilities") if isinstance(anomaly.get("abilities"), dict) else {}
    for key, state in abilities.items():
        answers = state.get("answers") if isinstance(state, dict) else None
        for index, reference in enumerate(tables["answers"].get(key, [])):
            if filled(answers, index):
                codes.add(reference)
    for ability in anomaly.get("custom") or []:
        if not isinstance(ability, dict):
            continue
        answers = (ability.get("state") or {}).get("answers")
        for index, answer in enumerate(ability.get("answers") or []):
            if isinstance(answer, dict) and filled(answers, index):
                codes.add(str(answer.get("reference") or "").strip().upper())
    return {code for code in codes if CODE.fullmatch(code)}


def player_details(char, tables=None):
    """What goes into a player's sealed account: the Documents their agent has unlocked, each
    with its own key. None when there are none, or no Playwall."""
    if not built():
        return None
    index = json.loads(INDEX.read_text(encoding="utf-8"))["documents"]
    key = content_key()
    codes = unlocked_codes(char, tables)
    documents = [{**doc, "key": base64.b64encode(document_key(key, doc["code"])).decode("ascii")}
                 for doc in index if doc["code"] in codes]   # in Playwall order
    return {"documents": documents} if documents else None


# -----------------------------
# READING THE MANUAL
# -----------------------------
def page_marks(page):
    """(codes, titles, has_text) of a page: codes as (code, y), titles as (text, y), y in pt from the bottom."""
    fragments = []

    def visit(text, cm, tm, font, size):
        text = text.strip()
        if not text:
            return
        x = tm[4] * cm[0] + cm[4]
        y = tm[5] * cm[3] + cm[5]
        if abs(tm[1]) < 0.01:
            fragments.append(("text", text, size * abs(tm[0]) * abs(cm[0]), x, y))
        else:
            fragments.append(("rotated", text, size * abs(tm[1]) * abs(cm[0]), x, y))

    plain = page.extract_text(visitor_text=visit) or ""
    codes, titles = [], []
    big = [f for f in fragments if f[0] == "text" and abs(f[2] - CODE_SIZE) < 1]
    i = 0
    while i < len(big):
        _, text, _, x, y = big[i]
        # Kerning splits some Codes in two ("J" + "3"): put them back together.
        if re.fullmatch(r"[A-Z]", text) and i + 1 < len(big) and re.fullmatch(r"\d{1,2}", big[i + 1][1]) \
                and abs(big[i + 1][4] - y) < 1:
            text += big[i + 1][1]
            i += 1
        if CODE.fullmatch(text):
            codes.append((text, y))
        i += 1
    for kind, text, size, x, y in fragments:
        if kind == "rotated" and abs(size - TITLE_SIZE) < 1:
            titles.append((text, y))
    return codes, titles, bool(plain.strip())


def find_documents(reader):
    """Every Document as {code, title, start: (page, y), pages: [(page, top_pt, bottom_pt)]}, in order."""
    height = float(reader.pages[0].mediabox.height)
    marks = {}
    starts = []   # (page, y, code), the first time each Code appears
    seen = set()
    last_page = None
    for number in range(1, len(reader.pages) + 1):
        codes, titles, has_text = page_marks(reader.pages[number - 1])
        if not starts and FIRST_CODE not in (code for code, _ in codes):
            continue   # before the Playwall, which opens on A1
        if starts and not codes and has_text:
            break   # past the Playwall: the ARCo Dossier
        marks[number] = titles
        last_page = number
        for code, y in sorted(codes, key=lambda item: -item[1]):
            if code in seen:
                continue   # a Code repeated at the top of a page it runs onto, or a joke overprint
            seen.add(code)
            starts.append((number, y, code))
    if not starts:
        raise PlaywallError("No Documents in Playwall found in the manual")

    def band_top(y):
        # The Document's box starts a little above its Code; at the top of the page, the page top.
        return 0.0 if y >= height - 40 else max(0.0, height - y - 31)

    documents = []
    for index, (page, y, code) in enumerate(starts):
        end_page, end_top = (starts[index + 1][0], band_top(starts[index + 1][1])) if index + 1 < len(starts) \
            else (last_page, height)
        pieces = []
        for number in range(page, end_page + 1):
            top = band_top(y) if number == page else 0.0
            bottom = end_top if number == end_page else height
            if bottom - top > 8:
                pieces.append((number, top, bottom))
        # The Title sits in the margin within the Document's first band.
        first_bottom = pieces[0][2] if pieces else height
        title = " ".join(text for text, ty in sorted(marks.get(page, []), key=lambda item: -item[1])
                         if band_top(y) <= height - ty <= first_bottom)
        documents.append({"code": code, "title": title, "page": page, "pieces": pieces})
    return documents, height


def page_label(reader, number):
    try:
        return reader.page_labels[number - 1]
    except (IndexError, AttributeError, KeyError):
        return str(number)


# -----------------------------
# BUILDING
# -----------------------------
def source_stamp(pdf):
    stat = pdf.stat()
    return {"version": VERSION, "pdf": pdf.name, "size": stat.st_size, "mtime": int(stat.st_mtime)}


def up_to_date(pdf):
    manifest = read_manifest()
    return bool(manifest) and manifest.get("source") == source_stamp(pdf) and all(
        (FILES_DIR / name).is_file() for name in manifest.get("files") or [])


def build(pdf=PDF, force=False, log=print):
    """Index and cut out the Playwall of `pdf`; returns the manifest."""
    from pypdf import PdfReader
    from PIL import Image

    pdf = Path(pdf)
    if not pdf.is_file():
        raise PlaywallError(f"No manual at {pdf}")
    if not force and up_to_date(pdf):
        log("Playwall already up to date")
        return read_manifest()
    renderer = shutil.which("pdftoppm")
    if not renderer:
        raise PlaywallError("pdftoppm (Poppler) is needed to render the pages, and is not on the PATH")

    reader = PdfReader(str(pdf))
    documents, height = find_documents(reader)
    first = min(doc["pieces"][0][0] for doc in documents if doc["pieces"])
    last = max(piece[0] for doc in documents for piece in doc["pieces"])
    log(f"{len(documents)} Documents, {documents[0]['code']} to {documents[-1]['code']}, on pages {first}-{last}")

    key = content_key()
    with tempfile.TemporaryDirectory() as scratch:
        log("Rendering the pages...")
        subprocess.run([renderer, "-f", str(first), "-l", str(last), "-scale-to", str(RENDER_HEIGHT),
                        "-png", str(pdf), str(Path(scratch) / "page")], check=True, capture_output=True)
        rendered = {}
        for item in Path(scratch).glob("page-*.png"):
            rendered[int(item.stem.rsplit("-", 1)[1])] = item

        if FILES_DIR.exists():
            shutil.rmtree(FILES_DIR)
        FILES_DIR.mkdir(parents=True)
        files = []
        index = []
        pages = {}
        for doc in documents:
            parts = []
            for part, (number, top, bottom) in enumerate(doc["pieces"]):
                if number not in pages:
                    pages[number] = Image.open(rendered[number]).convert("RGB")
                image = pages[number]
                scale = image.height / height
                crop = image.crop((0, round(top * scale), image.width, min(image.height, round(bottom * scale))))
                buffer = io.BytesIO()
                crop.save(buffer, "WEBP", quality=WEBP_QUALITY, method=6)
                name = file_name(key, f"{doc['code']}:{part}")
                (FILES_DIR / name).write_bytes(seal_bytes(document_key(key, doc["code"]), buffer.getvalue()))
                files.append(name)
                parts.append({"file": f"playwall/{name}", "width": crop.width, "height": crop.height})
            index.append({"code": doc["code"], "title": doc["title"], "page": page_label(reader, doc["page"]), "parts": parts})
            log(f"  {doc['code']:>4}  {doc['title'] or '-'}  ({len(parts)} part{'s' if len(parts) != 1 else ''})")

    index_name = file_name(key, "index")
    payload = json.dumps({"version": 1, "documents": index}, ensure_ascii=False).encode("utf-8")
    (FILES_DIR / index_name).write_bytes(seal_bytes(key, payload))
    INDEX.write_bytes(payload)
    files.append(index_name)
    manifest = {"source": source_stamp(pdf), "index": index_name, "documents": len(index), "files": sorted(files)}
    MANIFEST.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    size = sum((FILES_DIR / name).stat().st_size for name in files)
    log(f"Playwall written to {FILES_DIR} ({len(files)} files, {size / 1024 / 1024:.1f} MB)")
    return manifest


def main():
    parser = argparse.ArgumentParser(description="Index the Documents in Playwall of the manual for the Manager.")
    parser.add_argument("--pdf", default=str(PDF), help="the manual (default: Materiale/Triangle-Agency.pdf)")
    parser.add_argument("--force", action="store_true", help="rebuild even if the manual has not changed")
    args = parser.parse_args()
    try:
        build(Path(args.pdf), force=args.force)
    except PlaywallError as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
