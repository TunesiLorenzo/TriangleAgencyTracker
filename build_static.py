"""Build a published copy of the viewer: a folder any static host can serve.

Usage:
    python build_static.py [--out dist] [--data-dir <folder>] [--publish]

The viewer is a plain static page; what it normally asks the tracker server for is written
once into snapshot.json beside it: the settings, the sound list, the team and the case
archive, as they are in the tracker file right now. The viewer picks that file up when no
server answers (js/config.js) and then runs as a published copy: everything can be opened,
clicked and heard, nothing is saved, and every visit starts again from the snapshot. The
settings page, the room lights and the rulebook scans of Materiale/ are left out.

--publish also pushes the folder to the gh-pages branch of origin as its only commit, which
is where GitHub Pages serves it from. Run it again to bring the published copy up to date.
"""

import argparse
import datetime
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ASSET_FOLDERS = ("css", "js", "audio", "images", "texts", "various")
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".webm"}   # as web.py's sound library
SNAPSHOT_FORMAT = "triangle-agency-snapshot"


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def read_tracker_file(data_dir):
    """The (team, settings) of the tracker file the server would open in this data folder."""
    location = read_json(data_dir / "tracker_location.json") or {}
    path = (data_dir / location["path"]).resolve() if location.get("path") else data_dir / "triangle-agency-tracker.json"
    data = read_json(path)
    if not isinstance(data, dict) or data.get("format") != "triangle-agency-tracker":
        raise SystemExit(f"No tracker file to publish at {path}")
    return path, data.get("team") or {}, data.get("settings") or {}


def list_sounds(audio_dir):
    """Every playable file under audio/, as the server lists them for the viewer."""
    files = [item.relative_to(audio_dir).as_posix() for item in audio_dir.rglob("*")
             if item.is_file() and item.suffix.casefold() in AUDIO_EXTENSIONS]
    return sorted(files, key=str.casefold)


def case_scans(cases):
    """The file name of every page of these cases."""
    names = set()
    for case in cases:
        pages = case.get("files") or [case.get("file")]
        for page in pages:
            record = page if isinstance(page, dict) else {"file": page}
            photos = record.get("photos") if isinstance(record.get("photos"), list) else []
            for item in (record, *photos):
                if isinstance(item, dict) and item.get("file"):
                    names.add(str(item["file"]))
    return sorted(names)


def build(out, data_dir):
    tracker_file, team, settings = read_tracker_file(data_dir)
    cases = (read_json(BASE_DIR / "cases" / "cases.json") or {}).get("cases") or []

    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    shutil.copy2(BASE_DIR / "index.html", out / "index.html")
    for folder in ASSET_FOLDERS:
        shutil.copytree(BASE_DIR / folder, out / folder)
    missing = []
    for name in case_scans(cases):
        source = BASE_DIR / "cases" / name
        if source.is_file():
            (out / "cases").mkdir(exist_ok=True)
            shutil.copy2(source, out / "cases" / name)
        else:
            missing.append(name)

    snapshot = {
        "format": SNAPSHOT_FORMAT,
        "built": datetime.datetime.now().isoformat(timespec="seconds"),
        "revision": int(settings.get("revision") or 0),
        "config": settings.get("config") or {},
        "sounds": list_sounds(out / "audio"),
        "team": {**team, "cases": cases},
        "cases": cases,
    }
    (out / "snapshot.json").write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    # GitHub Pages: serve the folder as it is, without running it through Jekyll.
    (out / ".nojekyll").write_text("", encoding="utf-8")

    size = sum(item.stat().st_size for item in out.rglob("*") if item.is_file())
    print(f"Published copy built in {out} ({size / 1024 / 1024:.0f} MB)")
    print(f"  from {tracker_file}: {len(team.get('chars') or [])} agents, {len(cases)} cases, {len(snapshot['sounds'])} sounds")
    for name in missing:
        print(f"  missing scan, shown as a placeholder: cases/{name}")


def git(*args, env=None):
    result = subprocess.run(["git", *args], cwd=BASE_DIR, env=env, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def publish(out, remote, branch):
    """Push the folder to the branch as its only commit, without touching this checkout."""
    with tempfile.TemporaryDirectory() as scratch:
        env = {
            **os.environ,
            "GIT_DIR": str(BASE_DIR / ".git"),
            "GIT_WORK_TREE": str(out),
            "GIT_INDEX_FILE": str(Path(scratch) / "index"),
        }
        # --force: the scans and the badge picture are ignored in the repository itself.
        git("add", "--all", "--force", ".", env=env)
        tree = git("write-tree", env=env)
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    commit = git("commit-tree", tree, "-m", f"Published copy of the viewer, {stamp}")
    git("push", "--force", remote, f"{commit}:refs/heads/{branch}")
    print(f"Pushed to {branch} on {remote}")


def main():
    parser = argparse.ArgumentParser(description="Build a published, static copy of the viewer.")
    parser.add_argument("--out", default="dist", help="folder to write (default: dist); it is emptied first")
    parser.add_argument("--data-dir", default=os.environ.get("TRACKER_DATA_DIR", "").strip() or str(BASE_DIR),
                        help="folder holding the tracker file (default: TRACKER_DATA_DIR, else this folder)")
    parser.add_argument("--publish", action="store_true", help="push the folder to the gh-pages branch of origin")
    parser.add_argument("--remote", default="origin")
    parser.add_argument("--branch", default="gh-pages")
    args = parser.parse_args()

    out = (BASE_DIR / args.out).resolve()
    if out == BASE_DIR or BASE_DIR.is_relative_to(out):
        raise SystemExit("Choose an output folder of its own: it is emptied before each build")
    build(out, Path(args.data_dir).expanduser().resolve())
    if args.publish:
        publish(out, args.remote, args.branch)


if __name__ == "__main__":
    main()
