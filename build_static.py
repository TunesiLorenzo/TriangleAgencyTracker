"""Build a published copy of the viewer: a folder any static host can serve.

Usage:
    python build_static.py [--out dist] [--data-dir <folder>] [--publish] [--status]

The viewer is a plain static page; what it normally asks the tracker server for is written
once into snapshot.json beside it: the settings, the sound list, the team and the case
archive, as they are in the tracker file right now. The viewer looks for that file first
(js/config.js) and, finding it, runs as a published copy, for looking only: every page can
be opened and heard, but nothing can be changed (js/readOnly.js), saved, or sent to the
lights. The settings page, the room lights and the rulebook scans of Materiale/ are left out.

--publish commits the published copy to the gh-pages branch of origin, on top of the last
one, and pushes it: GitHub Pages serves it from there. --status says what has changed since the last
publish. The tracker server does both from /publish, and serves the copy, live, on /public.
"""

import argparse
import datetime
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
# Published as they are, beside index.html; of cases/, only the scans the archive names.
ASSET_FOLDERS = ("css", "js", "audio", "images", "texts", "various")
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".webm"}   # as web.py's sound library
SNAPSHOT_FORMAT = "triangle-agency-snapshot"
SNAPSHOT_FILE = "snapshot.json"
# What the snapshot holds, as the publish status names it.
SNAPSHOT_PARTS = {"team": "team", "config": "settings", "cases": "cases", "sounds": "sound list"}
REMOTE = "origin"
BRANCH = "gh-pages"


class PublishError(Exception):
    """A build or publish that cannot go ahead; the message says why."""


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None


def tracker_file_in(data_dir):
    """The tracker file the server would open in this data folder."""
    location = read_json(data_dir / "tracker_location.json") or {}
    return (data_dir / location["path"]).resolve() if location.get("path") else data_dir / "triangle-agency-tracker.json"


def read_tracker_file(path):
    """The (team, settings) of a tracker file."""
    data = read_json(path)
    if not isinstance(data, dict) or data.get("format") != "triangle-agency-tracker":
        raise PublishError(f"No tracker file to publish at {path}")
    return data.get("team") or {}, data.get("settings") or {}


def load_cases():
    return (read_json(BASE_DIR / "cases" / "cases.json") or {}).get("cases") or []


def list_sounds():
    """Every playable file under audio/, as the server lists them for the viewer."""
    audio_dir = BASE_DIR / "audio"
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


def make_snapshot(team, settings, cases):
    """What snapshot.json holds. Nothing in it changes unless the data does, so an
    unchanged team publishes as an unchanged file."""
    return {
        "format": SNAPSHOT_FORMAT,
        "revision": int(settings.get("revision") or 0),
        "config": settings.get("config") or {},
        "sounds": list_sounds(),
        "team": {**team, "cases": cases},
        "cases": cases,
    }


def snapshot_text(snapshot):
    return json.dumps(snapshot, ensure_ascii=False)


def site_files(cases):
    """(files, missing): every file of the published copy that comes from this folder, by its
    path there (which is also its path here), and the scans the archive names but lacks."""
    files = ["index.html"]
    for folder in ASSET_FOLDERS:
        files += sorted(item.relative_to(BASE_DIR).as_posix() for item in (BASE_DIR / folder).rglob("*") if item.is_file())
    missing = []
    for name in case_scans(cases):
        (files if (BASE_DIR / "cases" / name).is_file() else missing).append(f"cases/{name}")
    return files, missing


def build(out, snapshot):
    """Write the published copy into `out`, emptying it first."""
    files, missing = site_files(snapshot["cases"])
    if out.exists():
        shutil.rmtree(out)
    for path in files:
        (out / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(BASE_DIR / path, out / path)
    (out / SNAPSHOT_FILE).write_text(snapshot_text(snapshot), encoding="utf-8")
    # GitHub Pages: serve the folder as it is, without running it through Jekyll.
    (out / ".nojekyll").write_text("", encoding="utf-8")
    return files, missing


# -----------------------------
# PUBLISHING (gh-pages)
# -----------------------------
def git(*args, env=None, stdin=None, timeout=120):
    # Never wait on a credential prompt nobody can see: fail and say so instead. Bytes, not
    # text: on Windows a text-mode pipe turns each \n into \r\n, which git reads as part of a path.
    result = subprocess.run(["git", *args], cwd=BASE_DIR, input=None if stdin is None else stdin.encode("utf-8"),
                            capture_output=True, timeout=timeout,
                            env={**os.environ, "GIT_TERMINAL_PROMPT": "0", **(env or {})})
    stdout, stderr = (stream.decode("utf-8", "replace").strip() for stream in (result.stdout, result.stderr))
    if result.returncode:
        raise PublishError(stderr or stdout or f"git {args[0]} failed")
    return stdout


def site_tree(snapshot, files, write=False):
    """The git tree of the published copy, hashed straight from this folder: no copy is
    made. With `write` its files are stored in the repository, ready to be pushed."""
    hash_args = ["hash-object", *(["-w"] if write else [])]
    blobs = git(*hash_args, "--stdin-paths", stdin="\n".join(files), timeout=600).splitlines()
    entries = [f"100644 blob {blob}\t{path}" for blob, path in zip(blobs, files)]
    entries.append(f"100644 blob {git(*hash_args, '--stdin', stdin=snapshot_text(snapshot))}\t{SNAPSHOT_FILE}")
    entries.append(f"100644 blob {git(*hash_args, '--stdin', stdin='')}\t.nojekyll")
    with tempfile.TemporaryDirectory() as scratch:
        env = {"GIT_INDEX_FILE": str(Path(scratch) / "index")}
        git("update-index", "--add", "--index-info", env=env, stdin="\n".join(entries) + "\n")
        # update-index skips a line it cannot read without failing: never publish a partial copy.
        listed = len(git("ls-files", env=env).splitlines())
        if listed != len(entries):
            raise PublishError(f"Only {listed} of the {len(entries)} files went into the published copy")
        return git("write-tree", *([] if write else ["--missing-ok"]), env=env)


def published_commit():
    """The commit GitHub Pages serves, fetched here if this computer has not seen it; None before the first publish."""
    listing = git("ls-remote", REMOTE, f"refs/heads/{BRANCH}", timeout=30)
    if not listing:
        return None
    commit = listing.split()[0]
    try:
        git("cat-file", "-e", f"{commit}^{{commit}}")
    except PublishError:
        git("fetch", REMOTE, f"+refs/heads/{BRANCH}:refs/remotes/{REMOTE}/{BRANCH}", timeout=600)
    return commit


def site_url():
    """Where GitHub Pages shows the copy, from origin's address."""
    match = re.search(r"github\.com[:/]([^/]+)/(.+?)(?:\.git)?/?$", git("remote", "get-url", REMOTE))
    return f"https://{match[1].lower()}.github.io/{match[2]}/" if match else None


def site_status(snapshot):
    """What a publish would change on GitHub Pages: the files, and which parts of the data."""
    files, missing = site_files(snapshot["cases"])
    tree = site_tree(snapshot, files)
    status = {"site": site_url(), "published": None, "changed": [], "data": [], "missing": missing,
              "files": len(files) + 2, "size": sum((BASE_DIR / path).stat().st_size for path in files)}
    commit = published_commit()
    if commit is None:
        status["changed"] = [*files, SNAPSHOT_FILE, ".nojekyll"]
        status["data"] = list(SNAPSHOT_PARTS.values())
        return status
    status["published"] = {"commit": commit, "date": git("show", "-s", "--format=%cI", commit),
                           "message": git("show", "-s", "--format=%s", commit)}
    published_tree = git("rev-parse", f"{commit}^{{tree}}")
    if published_tree != tree:
        status["changed"] = git("-c", "core.quotepath=off", "diff-tree", "-r", "--name-only", published_tree, tree).splitlines()
    if SNAPSHOT_FILE in status["changed"]:
        try:
            before = json.loads(git("cat-file", "blob", f"{published_tree}:{SNAPSHOT_FILE}"))
        except (PublishError, ValueError):
            before = {}
        status["data"] = [label for key, label in SNAPSHOT_PARTS.items() if before.get(key) != snapshot[key]]
    return status


def publish(snapshot):
    """Push the published copy to gh-pages, on top of the one there. Returns the commit, or
    None when GitHub Pages already shows exactly this."""
    files, _ = site_files(snapshot["cases"])
    tree = site_tree(snapshot, files, write=True)
    previous = published_commit()
    if previous and git("rev-parse", f"{previous}^{{tree}}") == tree:
        return None
    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    source = git("rev-parse", "--short", "HEAD")
    # The previous publish as parent tells git what GitHub already has, so only the files
    # that changed are uploaded. Without one, every publish sent the whole copy (~50 MB).
    parent = ["-p", previous] if previous else []
    commit = git("commit-tree", tree, *parent, "-m", f"Published copy of the viewer, {stamp} (code at {source})")
    # No --force: a copy published meanwhile from elsewhere is refused, not overwritten.
    git("push", REMOTE, f"{commit}:refs/heads/{BRANCH}", timeout=900)
    # Keeps the commit reachable here, so the next status need not fetch it back.
    git("update-ref", f"refs/remotes/{REMOTE}/{BRANCH}", commit)
    return commit


def main():
    parser = argparse.ArgumentParser(description="Build a published, static copy of the viewer.")
    parser.add_argument("--out", default="dist", help="folder to write (default: dist); it is emptied first")
    parser.add_argument("--data-dir", default=os.environ.get("TRACKER_DATA_DIR", "").strip() or str(BASE_DIR),
                        help="folder holding the tracker file (default: TRACKER_DATA_DIR, else this folder)")
    parser.add_argument("--publish", action="store_true", help=f"push the copy to the {BRANCH} branch of {REMOTE}")
    parser.add_argument("--status", action="store_true", help="say what a publish would change, and stop")
    args = parser.parse_args()

    try:
        tracker_file = tracker_file_in(Path(args.data_dir).expanduser().resolve())
        team, settings = read_tracker_file(tracker_file)
        cases = load_cases()
        snapshot = make_snapshot(team, settings, cases)
        print(f"From {tracker_file}: {len(team.get('chars') or [])} agents, {len(cases)} cases, {len(snapshot['sounds'])} sounds")

        if args.status:
            status = site_status(snapshot)
            published = status["published"]
            print(f"Published: {published['date']}" if published else "Not published yet")
            print(f"Changed: {', '.join(status['data']) or 'no data'}; {len(status['changed'])} files" if status["changed"] else "Up to date")
            for path in status["changed"]:
                print(f"  {path}")
            return

        out = (BASE_DIR / args.out).resolve()
        if out == BASE_DIR or BASE_DIR.is_relative_to(out):
            raise PublishError("Choose an output folder of its own: it is emptied before each build")
        _, missing = build(out, snapshot)
        size = sum(item.stat().st_size for item in out.rglob("*") if item.is_file())
        print(f"Published copy built in {out} ({size / 1024 / 1024:.0f} MB)")
        for path in missing:
            print(f"  missing scan, shown as a placeholder: {path}")
        if args.publish:
            commit = publish(snapshot)
            print(f"Pushed to {BRANCH} on {REMOTE}: {site_url()}" if commit else "Nothing to publish: GitHub Pages already shows this")
    except PublishError as error:
        raise SystemExit(str(error)) from None


if __name__ == "__main__":
    main()
