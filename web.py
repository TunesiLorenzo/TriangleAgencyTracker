"""Web entrypoint for the Triangle Agency Tracker.

Two front-ends share one local Flask server (same layout as MTG_Table):
  /          the tracker viewer shown on the table screen (static index.html)
  /settings  the setup page: sound assignments and effect tuning

Settings live in tracker_config.json next to this file. The viewer polls
/api/config and applies changes live, so tuning on /settings (from this PC or a
phone on the same network) shows up on the display without a reload.
Tracker data (agents, tasks, counters) stays in the viewer's browser storage.
"""

import json
import os
import re
import threading
from pathlib import Path

from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.exceptions import HTTPException

BASE_DIR = Path(__file__).resolve().parent
AUDIO_DIR = BASE_DIR / "audio"
UPLOAD_FOLDERS = {"uploads": AUDIO_DIR / "uploads", "Competencies": AUDIO_DIR / "Competencies"}
CONFIG_FILE = BASE_DIR / "tracker_config.json"

AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".webm"}
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_CONFIG_BYTES = 512 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

config_lock = threading.Lock()
config_state = {"revision": 0, "config": {}}


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


for folder in ("css", "js", "audio", "images", "various"):
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


load_config()
