"""Web entrypoint for the Triangle Agency Tracker.

Two front-ends share one local Flask server (same layout as MTG_Table):
  /          the tracker viewer shown on the table screen (static index.html)
  /settings  the setup page: sound assignments and effect tuning

Settings live in tracker_config.json next to this file. The viewer polls
/api/config and applies changes live, so tuning on /settings (from this PC or a
phone on the same network) shows up on the display without a reload.
Tracker data (agents, tasks, counters) stays in the viewer's browser storage.
Previous cases (HD scans of each mission's Rapporto) are too big for that, so they
live in cases/ next to this file, indexed by cases/cases.json.
"""

import datetime
import json
import os
import re
import secrets
import threading
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException

BASE_DIR = Path(__file__).resolve().parent
AUDIO_DIR = BASE_DIR / "audio"
UPLOAD_FOLDERS = {"uploads": AUDIO_DIR / "uploads", "Competencies": AUDIO_DIR / "Competencies"}
CONFIG_FILE = BASE_DIR / "tracker_config.json"
CASES_DIR = BASE_DIR / "cases"
CASES_FILE = CASES_DIR / "cases.json"

AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".webm"}
CASE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}   # what a browser can display
CASE_OUTCOMES = {"contained", "killed", "escaped"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_CASE_BYTES = 100 * 1024 * 1024
MAX_CONFIG_BYTES = 512 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES
# Outside debug mode Flask keeps the first copy of settings.html it read, so an updated
# template would sit next to an updated settings.js it no longer matches until a restart.
app.config["TEMPLATES_AUTO_RELOAD"] = True

config_lock = threading.Lock()
config_state = {"revision": 0, "config": {}}
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
    """Return a valid 0-100 team score, or raise a useful API error."""
    try:
        score = int(value)
    except (TypeError, ValueError):
        raise ValueError("Give the team a score from 0 to 100") from None
    if not 0 <= score <= 100:
        raise ValueError("The team score must be between 0 and 100")
    return score


def case_outcome(value):
    outcome = (value or "").strip().casefold()
    if outcome == "captured":                 # accepts the tracker's older wording
        outcome = "contained"
    if outcome not in CASE_OUTCOMES:
        raise ValueError("Choose Contained, Killed or Escaped")
    return outcome


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


for folder in ("css", "js", "audio", "images", "various", "cases", "Materiale"):
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
    # The sound list rides along so viewers can match audio/Competencies/<Name>_Bad|_Good files.
    with config_lock:
        return jsonify({"ok": True, **config_state, "sounds": list_sounds()})


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


@app.get("/api/cases")
def get_cases():
    with cases_lock:
        return jsonify({"ok": True, "cases": load_cases()})


@app.post("/api/cases")
def add_case():
    request.max_content_length = MAX_CASE_BYTES   # HD scans outgrow the sound-upload limit
    upload = request.files.get("file")
    if upload is None or not upload.filename:
        raise ValueError("Choose the scan of the Rapporto")
    suffix = os.path.splitext(upload.filename)[1].casefold()
    if suffix not in CASE_EXTENSIONS:
        raise ValueError("Upload an image or a PDF: " + ", ".join(sorted(CASE_EXTENSIONS)))
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
        CASES_DIR.mkdir(parents=True, exist_ok=True)
        upload.save(CASES_DIR / (case_id + suffix))
        case = {
            "id": case_id,
            "number": number,
            "name": name,
            "code": code,
            "date": date,
            "score": score,
            "outcome": outcome,
            "file": case_id + suffix,
            "added": datetime.datetime.now().isoformat(timespec="seconds"),
        }
        cases.append(case)
        write_json_file(CASES_FILE, {"cases": cases})
    return jsonify({"ok": True, "case": case})


@app.patch("/api/cases/<case_id>")
def update_case(case_id):
    """Update the classification printed on a filed case without replacing its scan."""
    payload = request.get_json(silent=True) or {}
    score = case_score(payload.get("score"))
    outcome = case_outcome(payload.get("outcome"))
    with cases_lock:
        cases = load_cases()
        case = next((case for case in cases if case.get("id") == case_id), None)
        if case is None:
            raise ValueError("That case is not in the archive")
        case["score"] = score
        case["outcome"] = outcome
        write_json_file(CASES_FILE, {"cases": cases})
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
        scan = os.path.basename(case.get("file") or "")
        if scan:
            (CASES_DIR / scan).unlink(missing_ok=True)
    return jsonify({"ok": True})


load_config()
