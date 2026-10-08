"""Web entrypoint for the Triangle Agency Tracker.

Two front-ends share one local Flask server (same layout as MTG_Table):
  /          the tracker viewer shown on the table screen (static index.html)
  /settings  the setup page: sound assignments and effect tuning

Settings live in tracker_config.json in the configured data folder. The viewer
polls /api/config and applies changes live, so tuning on /settings shows up on
the display without a reload. TRACKER_DATA_DIR can place both tracker_config.json
and team_save.json on a synced, mapped or removable drive.
Tracker data (agents, tasks, counters) stays in the viewer's browser storage and can
also be mirrored atomically to team_save.json by viewers that connect Tracker Save:
one shared copy for every browser, on this computer or on the LAN.
Previous cases (HD scans of each mission's Rapporto) are too big for that, so they
live in cases/ next to this file, indexed by cases/cases.json. A team file carries the
case index only; /api/cases/archive exports and restores the whole archive, scans
included, as one .zip so it can move between terminals.
The Manager's badge picture on the login screen is uploaded to images/badge/.
Room lights go through LightRPG, which runs beside the tracker (see lights.py);
/api/lights/* forwards cues to it, so phones never need to reach it directly.
"""

import datetime
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import threading
import zipfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_file, send_from_directory
from werkzeug.exceptions import HTTPException

import lights

BASE_DIR = Path(__file__).resolve().parent
_data_dir_setting = os.environ.get("TRACKER_DATA_DIR", "").strip()
DATA_DIR = Path(_data_dir_setting).expanduser().resolve() if _data_dir_setting else BASE_DIR
try:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
except OSError as error:
    raise RuntimeError(f"Tracker data folder is unavailable: {DATA_DIR}") from error

AUDIO_DIR = BASE_DIR / "audio"
UPLOAD_FOLDERS = {"uploads": AUDIO_DIR / "uploads", "Competencies": AUDIO_DIR / "Competencies"}
CONFIG_FILE = DATA_DIR / "tracker_config.json"
TEAM_SAVE_FILE = DATA_DIR / "team_save.json"
CASES_DIR = BASE_DIR / "cases"
CASES_FILE = CASES_DIR / "cases.json"
BADGE_DIR = BASE_DIR / "images" / "badge"   # the Manager's photo on the login screen badge

AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".webm"}
BADGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
CASE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}   # what a browser can display
CASE_OUTCOMES = {"contained", "killed", "escaped"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_CASE_BYTES = 100 * 1024 * 1024
MAX_CONFIG_BYTES = 512 * 1024
MAX_TEAM_SAVE_BYTES = 25 * 1024 * 1024
MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024   # a whole archive of HD scans
ARCHIVE_INDEX_NAME = "cases.json"            # the index inside an archive bundle

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
# Outside debug mode Flask keeps the first copy of settings.html it read, so an updated
# template would sit next to an updated settings.js it no longer matches until a restart.
app.config["TEMPLATES_AUTO_RELOAD"] = True

config_lock = threading.Lock()
config_state = {"revision": 0, "config": {}}
team_save_lock = threading.Lock()
cases_lock = threading.Lock()


# -----------------------------
# CONFIG PERSISTENCE
# -----------------------------
def write_json_file(path, payload):
    """Write beside the target and rename, so a crash never leaves half a file."""
    temporary = path.with_name(path.name + ".tmp")
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)


def load_config():
    try:
        saved = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return
    except (OSError, ValueError):
        app.logger.exception("tracker_config.json is unreadable; starting from defaults")
        return
    if isinstance(saved, dict) and isinstance(saved.get("config"), dict):
        config_state["config"] = saved["config"]
        config_state["revision"] = int(saved.get("revision") or 0)


def team_save_version(team):
    """Stable content version used to prevent two viewers overwriting each other."""
    encoded = json.dumps(team, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_team_save():
    try:
        team = json.loads(TEAM_SAVE_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    if not isinstance(team, dict):
        raise ValueError("The team save is not a settings object")
    return team


# -----------------------------
# SOUND LIBRARY
# -----------------------------
def list_sounds():
    """Every playable file under audio/, as paths relative to audio/."""
    if not AUDIO_DIR.is_dir():
        return []
    sounds = []
    for item in AUDIO_DIR.rglob("*"):
        if item.is_file() and item.suffix.casefold() in AUDIO_EXTENSIONS:
            relative = item.relative_to(AUDIO_DIR).as_posix()
            sounds.append({"file": relative, "label": item.stem.replace("_", " ")})
    return sorted(sounds, key=lambda sound: sound["file"].casefold())


def safe_upload_name(name):
    stem, suffix = os.path.splitext(os.path.basename(name or ""))
    suffix = suffix.casefold()
    if suffix not in AUDIO_EXTENSIONS:
        raise ValueError("Upload an audio file: " + ", ".join(sorted(AUDIO_EXTENSIONS)))
    stem = re.sub(r"[^A-Za-z0-9 _.&-]+", "", stem).strip(" .") or "sound"
    return stem[:60] + suffix


# -----------------------------
# PREVIOUS CASES
# -----------------------------
def load_cases():
    """Filed cases, oldest first. An unreadable index raises rather than being overwritten."""
    try:
        saved = json.loads(CASES_FILE.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    cases = saved.get("cases") if isinstance(saved, dict) else None
    return cases if isinstance(cases, list) else []


def case_score(value):
    """Return a short uppercase team rank, or raise a useful API error."""
    score = str(value or "").strip().upper()
    if not re.fullmatch(r"[A-Z0-9+-]{1,6}", score):
        raise ValueError("Use 1-6 letters, numbers, + or - for the team rank")
    return score


def case_outcome(value):
    outcome = (value or "").strip().casefold()
    if outcome == "captured":                 # accepts the tracker's older wording
        outcome = "contained"
    if outcome not in CASE_OUTCOMES:
        raise ValueError("Choose Contained, Killed or Escaped")
    return outcome


def case_brightness(value):
    """Validate the persisted CSS brightness percentage for a scanned page."""
    try:
        brightness = int(value)
    except (TypeError, ValueError):
        raise ValueError("Brightness must be a whole percentage") from None
    if not 20 <= brightness <= 150:
        raise ValueError("Brightness must be between 20% and 150%")
    return brightness


def case_files(case):
    """Return normalized page records, including legacy one-file cases."""
    records = []
    saved = case.get("files")
    if isinstance(saved, list):
        for index, item in enumerate(saved, start=1):
            if isinstance(item, str):
                item = {"file": item}
            if not isinstance(item, dict):
                continue
            try:
                brightness = case_brightness(item.get("brightness", 100))
            except ValueError:
                brightness = 100
            page_id = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("id") or "")) or f"page-{index:03d}"
            if item.get("kind") == "scatter" and isinstance(item.get("photos"), list):
                for photo_index, photo in enumerate(item["photos"], start=1):
                    if not isinstance(photo, dict):
                        continue
                    filename = os.path.basename(str(photo.get("file") or ""))
                    if not filename:
                        continue
                    try:
                        photo_brightness = case_brightness(photo.get("brightness", 100))
                    except ValueError:
                        photo_brightness = 100
                    photo_id = re.sub(r"[^A-Za-z0-9_-]", "", str(photo.get("id") or "")) or f"photo-{photo_index:03d}"
                    records.append({
                        "id": f"{page_id}-{photo_id}",
                        "kind": "page",
                        "file": filename,
                        "name": str(photo.get("name") or filename)[:120],
                        "brightness": photo_brightness,
                    })
                continue
            filename = os.path.basename(str(item.get("file") or ""))
            if not filename:
                continue
            records.append({
                "id": page_id,
                "kind": "page",
                "file": filename,
                "name": str(item.get("name") or filename)[:120],
                "brightness": brightness,
            })
    if not records:
        filename = os.path.basename(str(case.get("file") or ""))
        if filename:
            records.append({"id": "page-001", "kind": "page", "file": filename, "name": filename, "brightness": 100})
    return records


def imported_case_pages(value):
    """Page records from a team file: metadata only, since scans stay on the machine that filed them."""
    pages = []
    for index, item in enumerate(value if isinstance(value, list) else [], start=1):
        if not isinstance(item, dict):
            continue
        page_id = re.sub(r"[^A-Za-z0-9_-]", "", str(item.get("id") or "")) or f"page-{index:03d}"
        try:
            brightness = case_brightness(item.get("brightness", 100))
        except ValueError:
            brightness = 100
        # The scan filename is kept so the page lines up again if cases/ is copied across too.
        filename = os.path.basename(str(item.get("file") or ""))
        pages.append({
            "id": page_id,
            "kind": "page",
            "file": filename,
            "name": str(item.get("name") or filename or f"Page {index}")[:120],
            "brightness": brightness,
        })
    return pages


def imported_case(case, number):
    """Validate one case record from a team file. Raises ValueError on anything unusable."""
    if not isinstance(case, dict):
        raise ValueError("A case in the team file is not a record")
    name = str(case.get("name") or "").strip()[:80]
    if not name:
        raise ValueError("A case in the team file has no name")
    case_id = re.sub(r"[^A-Za-z0-9_-]", "", str(case.get("id") or ""))
    if not case_id:
        case_id = f"case-{number:03d}-{secrets.token_hex(3)}"
    date = str(case.get("date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = datetime.date.today().isoformat()
    try:
        case_number = int(case.get("number") or number)
    except (TypeError, ValueError):
        case_number = number
    return {
        "id": case_id,
        "number": case_number,
        "name": name,
        "code": str(case.get("code") or "").strip()[:12],
        "date": date,
        "score": case_score(case.get("score")),
        "outcome": case_outcome(case.get("outcome")),
        "files": imported_case_pages(case.get("files")),
        "added": str(case.get("added") or datetime.datetime.now().isoformat(timespec="seconds"))[:40],
    }


def attach_case_files(case):
    """Attach the normalized page collection used by the current client."""
    files = case_files(case)
    case["files"] = files
    case["file"] = files[0]["file"] if files else ""
    return case


def uploaded_case_files():
    """Accept the new multi-page field and the former single-file field."""
    uploads = [upload for upload in request.files.getlist("files") if upload and upload.filename]
    legacy = request.files.get("file")
    if not uploads and legacy is not None and legacy.filename:
        uploads = [legacy]
    for upload in uploads:
        suffix = os.path.splitext(upload.filename)[1].casefold()
        if suffix not in CASE_EXTENSIONS:
            raise ValueError("Upload images or PDFs: " + ", ".join(sorted(CASE_EXTENSIONS)))
    return uploads


def save_case_pages(case_id, uploads):
    """Save uploaded pages with stable ids and return their metadata records."""
    pages = []
    CASES_DIR.mkdir(parents=True, exist_ok=True)
    for upload in uploads:
        suffix = os.path.splitext(upload.filename)[1].casefold()
        page_id = f"page-{secrets.token_hex(4)}"
        filename = f"{case_id}-{page_id}{suffix}"
        upload.save(CASES_DIR / filename)
        pages.append({
            "id": page_id,
            "kind": "page",
            "file": filename,
            "name": os.path.basename(upload.filename)[:120],
            "brightness": 100,
        })
    return pages


# -----------------------------
# RESPONSES
# -----------------------------
@app.after_request
def no_stale_copies(response):
    """Never let a browser run old CSS/JS or old settings.

    python -m http.server sent no cache headers, so after an update a browser
    could keep an old stylesheet and show the page half-updated.
    """
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    else:
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(error, HTTPException):
        if request.path.startswith("/api/"):
            return jsonify({"ok": False, "message": error.description}), error.code
        return error
    app.logger.exception("Tracker request failed")
    return jsonify({"ok": False, "message": str(error) or "Unexpected error"}), 400


# -----------------------------
# PAGES AND ASSETS
# -----------------------------
@app.get("/")
def index():
    """The viewer is a plain static page, so it also works from any static server."""
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/settings")
def settings():
    return render_template("settings.html")


for folder in ("css", "js", "audio", "images", "various", "cases", "Materiale", "texts"):
    app.add_url_rule(
        f"/{folder}/<path:filename>",
        endpoint=f"asset_{folder}",
        view_func=lambda filename, folder=folder: send_from_directory(BASE_DIR / folder, filename),
    )


# -----------------------------
# API
# -----------------------------
@app.get("/api/config")
def get_config():
    # Polling viewers send their known revision. Avoid walking audio/ and sending the
    # full settings object every two seconds when nothing has changed.
    known_revision = request.args.get("revision", type=int)
    with config_lock:
        if known_revision == config_state["revision"]:
            return jsonify({
                "ok": True,
                "unchanged": True,
                "revision": config_state["revision"],
                "dataDir": str(DATA_DIR),
            })
        # A fresh or changed config includes sounds so competency and GRA discovery update together.
        return jsonify({"ok": True, **config_state, "sounds": list_sounds(), "dataDir": str(DATA_DIR)})

@app.post("/api/config")
def set_config():
    if (request.content_length or 0) > MAX_CONFIG_BYTES:
        raise ValueError("Settings are too large")
    payload = request.get_json(silent=True) or {}
    config = payload.get("config")
    if not isinstance(config, dict):
        raise ValueError("Expected a settings object")
    with config_lock:
        config_state["config"] = config
        config_state["revision"] += 1
        write_json_file(CONFIG_FILE, config_state)
        return jsonify({"ok": True, "revision": config_state["revision"]})


# -----------------------------
# TEAM SAVE (LAN-safe automatic persistence)
# -----------------------------
@app.get("/api/team-save")
def get_team_save():
    """Return the desktop-hosted team save used when LAN HTTP cannot open local files."""
    with team_save_lock:
        team = load_team_save()
        if team is None:
            return jsonify({"ok": True, "exists": False, "version": None, "team": None})
        return jsonify({"ok": True, "exists": True, "version": team_save_version(team), "team": team})


@app.put("/api/team-save")
def put_team_save():
    """Atomically update the team save, rejecting stale viewers unless overwrite is explicit."""
    if (request.content_length or 0) > MAX_TEAM_SAVE_BYTES:
        return jsonify({"ok": False, "message": "The team save is too large"}), 413
    payload = request.get_json(silent=True) or {}
    team = payload.get("team")
    expected = payload.get("expectedVersion")
    overwrite = payload.get("overwrite") is True
    if not isinstance(team, dict):
        raise ValueError("Expected a team settings object")
    if expected is not None and not isinstance(expected, str):
        raise ValueError("Invalid team save version")

    with team_save_lock:
        current = load_team_save()
        current_version = team_save_version(current) if current is not None else None
        if not overwrite and expected != current_version:
            return jsonify({
                "ok": False,
                "conflict": True,
                "exists": current is not None,
                "version": current_version,
                "message": "The tracker team save changed in another viewer",
            }), 409
        write_json_file(TEAM_SAVE_FILE, team)
        return jsonify({"ok": True, "version": team_save_version(team)})


@app.get("/api/sounds")
def get_sounds():
    return jsonify({"ok": True, "sounds": list_sounds()})


@app.post("/api/sounds")
def upload_sound():
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ValueError("Choose a sound file to upload")
    folder = UPLOAD_FOLDERS.get(request.form.get("folder") or "uploads")
    if folder is None:
        raise ValueError("Unknown upload folder")
    name = safe_upload_name(upload.filename)
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / name
    stem, suffix = os.path.splitext(name)
    counter = 2
    while target.exists():
        target = folder / f"{stem}_{counter}{suffix}"
        counter += 1
    upload.save(target)
    return jsonify({
        "ok": True,
        "file": target.relative_to(AUDIO_DIR).as_posix(),
        "sounds": list_sounds(),
    })


@app.post("/api/badge")
def upload_badge_picture():
    """The Manager's photo for the login screen badge. Only the newest picture is kept;
    /settings then saves its path as login.badgePicture."""
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ValueError("Choose a picture to upload")
    suffix = os.path.splitext(upload.filename)[1].casefold()
    if suffix not in BADGE_EXTENSIONS:
        raise ValueError("Upload a picture: " + ", ".join(sorted(BADGE_EXTENSIONS)))
    BADGE_DIR.mkdir(parents=True, exist_ok=True)
    # A new name each time, so open viewers load the new picture instead of a cached one.
    target = BADGE_DIR / f"manager-{secrets.token_hex(4)}{suffix}"
    upload.save(target)
    for old in BADGE_DIR.iterdir():
        if old.is_file() and old != target:
            old.unlink(missing_ok=True)
    return jsonify({"ok": True, "file": target.relative_to(BASE_DIR).as_posix()})


@app.get("/api/cases")
def get_cases():
    with cases_lock:
        return jsonify({"ok": True, "cases": [attach_case_files(case) for case in load_cases()]})


@app.get("/api/cases/archive")
def export_case_archive():
    """The whole archive as one .zip: the index plus every scan.

    Unlike the metadata a team file carries, this bundle is self-contained, so it can rebuild
    the archive on another terminal. Built in memory and sent as a download.
    """
    with cases_lock:
        cases = [attach_case_files(case) for case in load_cases()]
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr(
                ARCHIVE_INDEX_NAME,
                json.dumps({"cases": cases}, indent=2, ensure_ascii=False),
            )
            # One entry per scan actually on disk; a missing file is skipped, not fatal.
            for case in cases:
                for page in case.get("files") or []:
                    scan = CASES_DIR / page["file"] if page.get("file") else None
                    if scan and scan.is_file():
                        bundle.write(scan, f"scans/{page['file']}")
    buffer.seek(0)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    return send_file(
        buffer,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"case-archive-{stamp}.zip",
    )


def archive_scan_name(name):
    """The scan filename for a bundle entry, or None if the entry is not a usable scan.

    Entry names are attacker-controlled, so only a plain filename directly under scans/ is
    accepted: anything with a path separator, a drive or a parent reference is dropped.
    """
    if not name.startswith("scans/"):
        return None
    relative = name[len("scans/"):]
    if not relative or relative != os.path.basename(relative):
        return None
    if os.path.splitext(relative)[1].casefold() not in CASE_EXTENSIONS:
        return None
    return relative


@app.post("/api/cases/archive")
def import_case_archive():
    """Rebuild the archive from a .zip produced by the export above.

    Scans are unpacked into cases/ and the index is merged exactly as a team-file import is,
    so merge keeps what is filed here and replace mirrors the bundle.
    """
    request.max_content_length = MAX_ARCHIVE_BYTES
    upload = request.files.get("archive")
    if upload is None or not upload.filename:
        raise ValueError("Choose a case archive .zip")
    mode = (request.form.get("mode") or "merge").strip().casefold()
    if mode not in {"merge", "replace"}:
        raise ValueError("Choose merge or replace")

    try:
        bundle = zipfile.ZipFile(upload.stream)
    except zipfile.BadZipFile:
        raise ValueError("That file is not a readable .zip archive") from None

    with bundle:
        try:
            index = json.loads(bundle.read(ARCHIVE_INDEX_NAME).decode("utf-8"))
        except KeyError:
            raise ValueError("The archive has no cases.json index") from None
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("The archive index is not readable JSON") from None
        incoming = index.get("cases") if isinstance(index, dict) else None
        if not isinstance(incoming, list):
            raise ValueError("The archive index holds no cases")

        with cases_lock:
            existing = load_cases()
            by_id = {case.get("id"): case for case in existing}
            highest = max((int(case.get("number") or 0) for case in existing), default=0)
            merged = [] if mode == "replace" else list(existing)
            added = 0
            kept = 0
            wanted = set()
            for case in incoming:
                highest += 1
                record = imported_case(case, highest)
                if mode == "merge" and record["id"] in by_id:
                    kept += 1
                    continue
                merged.append(record)
                added += 1
                wanted.update(page["file"] for page in record["files"] if page.get("file"))

            # Unpack only the scans the accepted cases refer to, and only safe names.
            CASES_DIR.mkdir(parents=True, exist_ok=True)
            restored = 0
            for entry in bundle.infolist():
                if entry.is_dir():
                    continue
                scan = archive_scan_name(entry.filename)
                if scan is None or scan not in wanted:
                    continue
                target = CASES_DIR / scan
                # The index is authoritative for names, so an existing scan is left in place.
                if target.exists():
                    continue
                with bundle.open(entry) as source, open(target, "wb") as handle:
                    shutil.copyfileobj(source, handle)
                restored += 1

            write_json_file(CASES_FILE, {"cases": merged})
            cases = [attach_case_files(case) for case in merged]

    return jsonify({"ok": True, "cases": cases, "added": added, "kept": kept, "scans": restored})


@app.post("/api/cases/import")
def import_cases():
    """Take case metadata from a team file. Scans are not carried: only the archive index.

    mode=merge keeps cases already filed here and adds the ones that are missing (matched by
    id); mode=replace makes the archive exactly what the team file holds. Scan files on disk
    are never deleted, so a replace that drops a case leaves its pages recoverable.
    """
    payload = request.get_json(silent=True) or {}
    mode = (payload.get("mode") or "merge").strip().casefold()
    if mode not in {"merge", "replace"}:
        raise ValueError("Choose merge or replace")
    incoming = payload.get("cases")
    if not isinstance(incoming, list):
        raise ValueError("The team file has no case archive")

    with cases_lock:
        existing = load_cases()
        by_id = {case.get("id"): case for case in existing}
        highest = max((int(case.get("number") or 0) for case in existing), default=0)
        added = 0
        kept = 0
        merged = [] if mode == "replace" else list(existing)
        for case in incoming:
            highest += 1
            record = imported_case(case, highest)
            current = by_id.get(record["id"])
            if mode == "merge" and current is not None:
                kept += 1          # already filed here: the local copy and its scans win
                continue
            # A local case keeps its own scan records when the file only carries metadata.
            if current is not None and not record["files"]:
                record["files"] = case_files(current)
            merged.append(record)
            added += 1
        CASES_DIR.mkdir(parents=True, exist_ok=True)   # first import on a fresh install
        write_json_file(CASES_FILE, {"cases": merged})
        cases = [attach_case_files(case) for case in merged]
    return jsonify({"ok": True, "cases": cases, "added": added, "kept": kept})


@app.post("/api/cases")
def add_case():
    request.max_content_length = MAX_CASE_BYTES   # HD scans outgrow the sound-upload limit
    uploads = uploaded_case_files()
    if not uploads:
        raise ValueError("Choose at least one page of the Rapporto")
    name = (request.form.get("name") or "").strip()[:80]
    if not name:
        raise ValueError("Give the case a name")
    code = (request.form.get("code") or "").strip()[:12]
    score = case_score(request.form.get("score"))
    outcome = case_outcome(request.form.get("outcome"))
    date = (request.form.get("date") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        date = datetime.date.today().isoformat()

    with cases_lock:
        cases = load_cases()
        number = max((int(case.get("number") or 0) for case in cases), default=0) + 1
        case_id = f"case-{number:03d}-{secrets.token_hex(3)}"
        pages = save_case_pages(case_id, uploads)
        case = {
            "id": case_id,
            "number": number,
            "name": name,
            "code": code,
            "date": date,
            "score": score,
            "outcome": outcome,
            "file": pages[0]["file"],
            "files": pages,
            "added": datetime.datetime.now().isoformat(timespec="seconds"),
        }
        cases.append(case)
        write_json_file(CASES_FILE, {"cases": cases})
    return jsonify({"ok": True, "case": case})


@app.patch("/api/cases/<case_id>")
def update_case(case_id):
    """Update a filed case and, optionally, append more scanned pages."""
    request.max_content_length = MAX_CASE_BYTES
    payload = request.form if request.mimetype == "multipart/form-data" else (request.get_json(silent=True) or {})
    score = case_score(payload.get("score"))
    outcome = case_outcome(payload.get("outcome"))
    uploads = uploaded_case_files()
    with cases_lock:
        cases = load_cases()
        case = next((case for case in cases if case.get("id") == case_id), None)
        if case is None:
            raise ValueError("That case is not in the archive")
        case["score"] = score
        case["outcome"] = outcome
        pages = case_files(case)
        if uploads:
            pages.extend(save_case_pages(case_id, uploads))
        case["files"] = pages
        case["file"] = pages[0]["file"] if pages else ""
        write_json_file(CASES_FILE, {"cases": cases})
    return jsonify({"ok": True, "case": case})


@app.patch("/api/cases/<case_id>/files/<page_id>")
def update_case_page(case_id, page_id):
    """Persist display settings for one scanned page."""
    payload = request.get_json(silent=True) or {}
    brightness = case_brightness(payload.get("brightness"))
    with cases_lock:
        cases = load_cases()
        case = next((case for case in cases if case.get("id") == case_id), None)
        if case is None:
            raise ValueError("That case is not in the archive")
        pages = case_files(case)
        page = next((page for page in pages if page.get("id") == page_id), None)
        if page is None:
            raise ValueError("That page is not in the case folder")
        page["brightness"] = brightness
        case["files"] = pages
        case["file"] = pages[0]["file"] if pages else ""
        write_json_file(CASES_FILE, {"cases": cases})
    return jsonify({"ok": True, "file": page})


@app.delete("/api/cases/<case_id>/files/<page_id>")
def delete_case_page(case_id, page_id):
    """Remove one page from a dossier."""
    with cases_lock:
        cases = load_cases()
        case = next((case for case in cases if case.get("id") == case_id), None)
        if case is None:
            raise ValueError("That case is not in the archive")
        pages = case_files(case)
        page = next((page for page in pages if page.get("id") == page_id), None)
        if page is None:
            raise ValueError("That page is not in the case folder")
        if len(pages) <= 1:
            raise ValueError("A dossier must keep at least one page; delete the case instead")
        pages.remove(page)
        case["files"] = pages
        case["file"] = pages[0]["file"]
        write_json_file(CASES_FILE, {"cases": cases})
        (CASES_DIR / page["file"]).unlink(missing_ok=True)
    return jsonify({"ok": True, "case": case})


@app.delete("/api/cases/<case_id>")
def delete_case(case_id):
    with cases_lock:
        cases = load_cases()
        case = next((case for case in cases if case.get("id") == case_id), None)
        if case is None:
            raise ValueError("That case is not in the archive")
        cases.remove(case)
        write_json_file(CASES_FILE, {"cases": cases})
        scans = {page["file"] for page in case_files(case)}
        for scan in scans:
            (CASES_DIR / scan).unlink(missing_ok=True)
    return jsonify({"ok": True})


# -----------------------------
# LIGHTS (LightRPG bridge)
# -----------------------------
light_bridge = lights.LightBridge(app.logger)


def saved_light_settings():
    with config_lock:
        saved = config_state["config"].get("lights")
    return saved if isinstance(saved, dict) else {}


def autostart_lights():
    """Launch LightRPG with the tracker when /settings asks for it (off by default)."""
    saved = saved_light_settings()
    if not (saved.get("enabled") and saved.get("autoStart", True)):
        return None
    try:
        return light_bridge.start_lightrpg()
    except Exception as error:
        return f"Could not start LightRPG: {error}"


@app.get("/api/lights/status")
def lights_status():
    return jsonify({"ok": True, **light_bridge.report()})


@app.post("/api/lights/start")
def lights_start():
    return jsonify({"ok": True, "message": light_bridge.start_lightrpg()})


@app.post("/api/lights/cue")
def lights_cue():
    """Queue one cue and answer at once; the bulbs are far slower than a click."""
    payload = request.get_json(silent=True) or {}
    cue, ambient = payload.get("cue"), payload.get("ambient")
    if not isinstance(cue, dict) or not (ambient is None or isinstance(ambient, dict)):
        raise ValueError("Expected a light cue")
    target = payload.get("target") or "all"
    if target not in lights.TARGETS:
        raise ValueError("Unknown light target")
    light_bridge.submit(cue, ambient, target)
    return jsonify({"ok": True})


# -----------------------------
# SHUTDOWN
# -----------------------------
SHUTDOWN_DELAY = 3   # seconds between the Log Out window closing and the server stopping


@app.post("/api/shutdown")
def shutdown():
    """Log Out on the viewer stops the server.

    The viewer calls this once its closing animation has finished; answering first and
    exiting a few seconds later lets the reply reach the browser. LightRPG runs in its own
    window and keeps going.
    """
    def stop():
        print("Logged out - Triangle Agency Tracker stopped.", flush=True)
        os._exit(0)   # Flask's development server has no stop call; the OS frees the port and lock

    threading.Timer(SHUTDOWN_DELAY, stop).start()
    return jsonify({"ok": True})


load_config()
