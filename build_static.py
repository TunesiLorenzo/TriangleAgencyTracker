"""Build a published copy of the viewer: a folder any static host can serve.

Usage:
    python build_static.py [--out dist] [--data-dir <folder>] [--publish] [--status]

The viewer is a plain static page; what it normally asks the tracker server for is written
once into snapshot.json beside it: the settings, the sound list, the team and the case
archive, as they are in the tracker file right now. The viewer looks for that file first
(js/config.js) and, finding it, runs as a published copy, for looking only: every page can
be opened and heard, but nothing can be changed (js/readOnly.js), saved, or sent to the
lights. The settings page, the room lights and the rulebook scans of Materiale/ are left out.
The players' accounts (the Players tab of /settings) go in sealed: each can only be opened
with its own username and password, typed at the login screen (js/access.js).

--publish commits the published copy to the gh-pages branch of origin, on top of the last
one, and pushes it: GitHub Pages serves it from there. --status says what has changed since the last
publish. The tracker server does both from /publish, and serves the copy, live, on /public.
"""

import argparse
import base64
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.parse
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"       # the tracker file, unless TRACKER_DATA_DIR puts it elsewhere
CASES_DIR = DATA_DIR / "cases"     # the case archive, published as cases/
# Published as they are, beside index.html; of cases/, only the scans the archive names.
ASSET_FOLDERS = ("css", "js", "audio", "images", "texts", "various")
AUDIO_EXTENSIONS = {".mp3", ".wav", ".ogg", ".m4a", ".webm"}   # as web.py's sound library
SNAPSHOT_FORMAT = "triangle-agency-snapshot"
SNAPSHOT_FILE = "snapshot.json"
MESSAGE_ARCHIVE_FORMAT = "triangle-agency-message-archive"
MESSAGE_ARCHIVE_FILE = "messages.json"
# What the snapshot holds, as the publish status names it.
SNAPSHOT_PARTS = {"team": "team", "config": "settings", "cases": "cases", "sounds": "sound list", "access": "player accounts"}
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
    return (read_json(CASES_DIR / "cases.json") or {}).get("cases") or []


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


# -----------------------------
# PLAYER ACCOUNTS
# -----------------------------
# Security is not the point (it is a game), only that the players' credentials and the
# messages left for them cannot simply be read out of snapshot.json. js/access.js works
# out the same keys from what is typed at the login screen.
def account_keys(username, password):
    """(id, key) of an account: the id the viewer finds it by, the key that opens it."""
    secret = hashlib.sha256(f"triangle-agency\n{username.strip().lower()}\n{password}".encode("utf-8")).digest()
    return hashlib.sha256(b"id" + secret).hexdigest(), hashlib.sha256(b"key" + secret).digest()


def seal(key, data):
    """`data` under a SHA-256 keystream. The nonce comes from the data itself, so the same
    account seals the same way and an unchanged one publishes as an unchanged file."""
    nonce = hashlib.sha256(key + data).digest()[:16]
    stream = b"".join(hashlib.sha256(key + nonce + block.to_bytes(4, "big")).digest()
                      for block in range((len(data) + 31) // 32))
    return {"nonce": base64.b64encode(nonce).decode("ascii"),
            "data": base64.b64encode(bytes(a ^ b for a, b in zip(data, stream))).decode("ascii")}


def ntfy_server(address):
    """Only the scheme and host of the ntfy server: a channel pasted onto the end would
    otherwise become part of every address."""
    parts = urllib.parse.urlsplit(str(address or "").strip())
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme in ("http", "https") and parts.netloc else "https://ntfy.sh"


MANAGER = "Manager"   # who plays a relationship nobody else does (js/relationships.js)


def conversation_channel(secret, agent_id, kind, other):
    """The ntfy channel of one in-character conversation: an agent and one of their
    relationships ("npc"), or their anomaly ("anomaly"). Only the people in it find its
    name, in their sealed accounts; the secret keeps it from being worked out."""
    seed = f"{secret}\n{agent_id}\n{kind}\n{other.strip().lower()}"
    return "ta-c-" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:20]


def list_conversations(team, players):
    """Every in-character conversation the team makes: each agent with each of their
    relationships ("npc"), with their anomaly ("anomaly"), and with each other agent
    ("agent", the pair once, `agentId` the lower id). `playedBy` is the player speaking for
    the other side: the Manager when it is the Manager, nobody, or a player without an
    account (an anomaly is always the Manager's; an agent is played by whoever has its
    account, else the Manager). Nothing without the Players tab's chat secret."""
    players = players if isinstance(players, dict) else {}
    secret = str(players.get("chatSecret") or "")
    if not secret:
        return []
    chars = [char for char in (team or {}).get("chars") or [] if isinstance(char, dict) and char.get("id")]
    linked = {str(account.get("charId") or "") for account in players.get("accounts") or []
              if isinstance(account, dict) and str(account.get("username") or "").strip() and account.get("password")}
    account_players = {str(char.get("player") or "").strip().casefold(): str(char.get("player") or "").strip()
                       for char in chars if str(char["id"]) in linked and str(char.get("player") or "").strip()}
    agent_player = {str(char["id"]): (str(char.get("player") or "").strip() or MANAGER) if str(char["id"]) in linked else MANAGER
                    for char in chars}
    conversations = []
    for char in chars:
        agent = {"agentId": str(char["id"]), "agentName": str(char.get("name") or "").strip()}
        anomaly = str(char.get("anomaly") or "").strip()
        if anomaly:
            conversations.append({**agent, "kind": "anomaly", "other": anomaly, "playedBy": MANAGER,
                                  "channel": conversation_channel(secret, agent["agentId"], "anomaly", anomaly)})
        for relationship in char.get("relationships") or []:
            name = str((relationship or {}).get("name") or "").strip()
            if not name:
                continue
            played = str(relationship.get("playedBy") or "").strip()
            conversations.append({**agent, "kind": "npc", "other": name,
                                  "playedBy": account_players.get(played.casefold(), MANAGER),
                                  "channel": conversation_channel(secret, agent["agentId"], "npc", name)})
    pairs = sorted((str(char["id"]), str(char.get("name") or "").strip()) for char in chars)
    for index, (first_id, first_name) in enumerate(pairs):
        for second_id, second_name in pairs[index + 1:]:
            conversations.append({"agentId": first_id, "agentName": first_name, "kind": "agent",
                                  "otherId": second_id, "other": second_name,
                                  "agentPlayedBy": agent_player[first_id], "playedBy": agent_player[second_id],
                                  "channel": conversation_channel(secret, first_id, "agent", second_id)})
    return conversations


def account_conversations(conversations, char, player, linked):
    """The conversations one account takes part in: as their agent ("agent" side; "a" or
    "b" with another agent, by their place in the pair), and as the relationships of other
    agents that their player plays ("npc" side). `manager`: the Manager speaks for the
    other side, so the Manager gets a copy of what the player writes there."""
    char_id = str((char or {}).get("id") or "")
    mine = []
    for conversation in conversations:
        kind = conversation["kind"]
        if kind == "agent" and char_id in (conversation["agentId"], conversation["otherId"]):
            side = "a" if conversation["agentId"] == char_id else "b"
            far = conversation["playedBy"] if side == "a" else conversation["agentPlayedBy"]
            mine.append({**conversation, "side": side, "manager": far == MANAGER})
        elif kind != "agent" and conversation["agentId"] == char_id:
            mine.append({**conversation, "side": "agent", "manager": conversation["playedBy"] == MANAGER})
        elif kind == "npc" and player and conversation["playedBy"].casefold() == player.casefold():
            mine.append({**conversation, "side": "npc", "manager": conversation["agentId"] not in linked})
    for conversation in mine:
        conversation.pop("playedBy", None)
        conversation.pop("agentPlayedBy", None)
    return mine


def manager_conversations(conversations, accounts, chars):
    """The Manager's direct lines to the agents, every NPC/anomaly side assigned to the
    Manager, and an agent side whose player has no usable account. These use the same
    channels as the agent accounts, so both sides see one shared history."""
    mine = []
    for account in accounts:
        if not isinstance(account, dict):
            continue
        if not str(account.get("username") or "").strip() or not account.get("password"):
            continue
        char = chars.get(str(account.get("charId") or ""))
        channel = str(account.get("inbox") or "").strip()
        if not char or not re.fullmatch(r"[-_A-Za-z0-9]{1,64}", channel):
            continue
        mine.append({
            "channel": channel,
            "kind": "manager",
            "side": "npc",
            "agentId": str(char.get("id") or ""),
            "agentName": str(char.get("name") or "").strip(),
            "other": MANAGER,
            "manager": True,
        })
    for conversation in conversations:
        if conversation["kind"] == "agent":
            # Stand in for an agent without a usable account. If neither agent has an
            # account there is no remote participant, so the conversation is omitted.
            first = conversation["agentPlayedBy"] == MANAGER
            second = conversation["playedBy"] == MANAGER
            if first == second:
                continue
            side = "a" if first else "b"
        elif conversation["playedBy"] == MANAGER:
            side = "npc"
        else:
            continue
        item = {**conversation, "side": side, "manager": True}
        item.pop("playedBy", None)
        item.pop("agentPlayedBy", None)
        mine.append(item)
    return mine


def make_access(players, team=None):
    """What the published copy gets of the Players tab: the ntfy channels, and every
    agent or Manager account with a username and password, sealed with its conversations."""
    players = players if isinstance(players, dict) else {}
    chars = {str(char.get("id")): char for char in (team or {}).get("chars") or [] if isinstance(char, dict)}
    conversations = list_conversations(team, players)
    linked = {str(account.get("charId") or "") for account in players.get("accounts") or []
              if isinstance(account, dict) and str(account.get("username") or "").strip() and account.get("password")}
    configured_accounts = players.get("accounts") or []
    accounts = []
    manager = players.get("manager") if isinstance(players.get("manager"), dict) else {}
    manager_username = str(manager.get("username") or "").strip()
    manager_password = str(manager.get("password") or "")
    if manager_username and manager_password:
        account_id, key = account_keys(manager_username, manager_password)
        details = {
            "username": manager_username,
            "manager": True,
            "player": MANAGER,
            "conversations": manager_conversations(conversations, configured_accounts, chars),
            "charId": "",
            "badge": str(manager.get("badge") or "56776544"),
            "inbox": "",
            "messages": [],
        }
        accounts.append({"id": account_id, **seal(key, json.dumps(details, ensure_ascii=False).encode("utf-8"))})
    for account in configured_accounts:
        if not isinstance(account, dict):
            continue
        username = str(account.get("username") or "").strip()
        password = str(account.get("password") or "")
        if not username or not password:
            continue
        account_id, key = account_keys(username, password)
        message = str(account.get("message") or "").strip()
        char = chars.get(str(account.get("charId") or ""))
        player = str((char or {}).get("player") or "").strip()
        details = {
            "username": username,
            "player": player,
            "conversations": account_conversations(conversations, char, player, linked),
            "charId": str(account.get("charId") or ""),
            "badge": str(account.get("badge") or ""),
            "inbox": str(account.get("inbox") or "").strip(),
            "messages": [{"id": hashlib.sha256(message.encode("utf-8")).hexdigest()[:16], "text": message}] if message else [],
        }
        accounts.append({"id": account_id, **seal(key, json.dumps(details, ensure_ascii=False).encode("utf-8"))})
    return {
        "server": ntfy_server(players.get("server")),
        "notify": str(players.get("notify") or "").strip(),
        "notifyGuests": players.get("notifyGuests") is not False,
        "copyChats": players.get("copyChats") is not False,
        # By id, so the order says nothing about who is who.
        "accounts": sorted(accounts, key=lambda account: account["id"]),
    }


def make_message_sync(players, team=None):
    """Public collector configuration. Topic names are deliberately not treated as
    secrets: the published UI still shows only the channels granted by the signed-in
    account, while the Google Apps Script needs the complete list to archive them."""
    players = players if isinstance(players, dict) else {}
    topics = {conversation["channel"] for conversation in list_conversations(team, players)}
    for account in players.get("accounts") or []:
        if not isinstance(account, dict) or not str(account.get("username") or "").strip() or not account.get("password"):
            continue
        inbox = str(account.get("inbox") or "").strip()
        if re.fullmatch(r"[-_A-Za-z0-9]{1,64}", inbox):
            topics.add(inbox)
    return {"version": 1, "server": ntfy_server(players.get("server")), "topics": sorted(topics)}


def make_snapshot(team, settings, cases):
    """What snapshot.json holds. Nothing in it changes unless the data does, so an
    unchanged team publishes as an unchanged file."""
    config = dict(settings.get("config") or {})
    players = config.pop("players", None)   # only ever published sealed, as "access"
    return {
        "format": SNAPSHOT_FORMAT,
        "revision": int(settings.get("revision") or 0),
        "config": config,
        "access": make_access(players, team),
        "messageSync": make_message_sync(players, team),
        "sounds": list_sounds(),
        "team": {**team, "cases": cases},
        "cases": cases,
    }


def snapshot_text(snapshot):
    return json.dumps(snapshot, ensure_ascii=False)


def empty_message_archive_text():
    return json.dumps({"format": MESSAGE_ARCHIVE_FORMAT, "version": 1, "updatedAt": "", "topics": {}},
                      ensure_ascii=False, separators=(",", ":"))


def site_files(cases):
    """(files, missing): every file of the published copy that comes from this folder, as
    {path there: path here}, and the scans the archive names but lacks."""
    files = {"index.html": "index.html"}
    for folder in ASSET_FOLDERS:
        for item in sorted((BASE_DIR / folder).rglob("*")):
            if item.is_file():
                files[item.relative_to(BASE_DIR).as_posix()] = item.relative_to(BASE_DIR).as_posix()
    missing = []
    for name in case_scans(cases):
        if (CASES_DIR / name).is_file():
            files[f"cases/{name}"] = (CASES_DIR / name).relative_to(BASE_DIR).as_posix()
        else:
            missing.append(f"cases/{name}")
    return files, missing


def build(out, snapshot):
    """Write the published copy into `out`, emptying it first."""
    files, missing = site_files(snapshot["cases"])
    if out.exists():
        shutil.rmtree(out)
    for path, source in files.items():
        (out / path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(BASE_DIR / source, out / path)
    (out / SNAPSHOT_FILE).write_text(snapshot_text(snapshot), encoding="utf-8")
    (out / MESSAGE_ARCHIVE_FILE).write_text(empty_message_archive_text(), encoding="utf-8")
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


def site_tree(snapshot, files, write=False, archive_blob=None):
    """The git tree of the published copy, hashed straight from this folder: no copy is
    made. With `write` its files are stored in the repository, ready to be pushed."""
    hash_args = ["hash-object", *(["-w"] if write else [])]
    blobs = git(*hash_args, "--stdin-paths", stdin="\n".join(files.values()), timeout=600).splitlines()
    entries = [f"100644 blob {blob}\t{path}" for blob, path in zip(blobs, files)]
    entries.append(f"100644 blob {git(*hash_args, '--stdin', stdin=snapshot_text(snapshot))}\t{SNAPSHOT_FILE}")
    archive_blob = archive_blob or git(*hash_args, "--stdin", stdin=empty_message_archive_text())
    entries.append(f"100644 blob {archive_blob}\t{MESSAGE_ARCHIVE_FILE}")
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


def published_archive_blob(commit):
    """The collector owns messages.json. Carry its latest blob through a normal local
    publish instead of replacing the archive with an empty file."""
    if not commit:
        return None
    try:
        return git("rev-parse", f"{commit}:{MESSAGE_ARCHIVE_FILE}")
    except PublishError:
        return None


def site_url():
    """Where GitHub Pages shows the copy, from origin's address."""
    match = re.search(r"github\.com[:/]([^/]+)/(.+?)(?:\.git)?/?$", git("remote", "get-url", REMOTE))
    return f"https://{match[1].lower()}.github.io/{match[2]}/" if match else None


def site_status(snapshot):
    """What a publish would change on GitHub Pages: the files, and which parts of the data."""
    files, missing = site_files(snapshot["cases"])
    commit = published_commit()
    tree = site_tree(snapshot, files, archive_blob=published_archive_blob(commit))
    status = {"site": site_url(), "published": None, "changed": [], "data": [], "missing": missing,
              "files": len(files) + 3, "size": sum((BASE_DIR / source).stat().st_size for source in files.values())}
    if commit is None:
        status["changed"] = [*files, SNAPSHOT_FILE, MESSAGE_ARCHIVE_FILE, ".nojekyll"]
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
    previous = published_commit()
    tree = site_tree(snapshot, files, write=True, archive_blob=published_archive_blob(previous))
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
    parser.add_argument("--data-dir", default=os.environ.get("TRACKER_DATA_DIR", "").strip() or str(DATA_DIR),
                        help="folder holding the tracker file (default: TRACKER_DATA_DIR, else data/)")
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
