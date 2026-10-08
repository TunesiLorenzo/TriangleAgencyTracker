"""Local server for the Triangle Agency Tracker.

Usage:
    python serve.py [--port 5002] [--host 0.0.0.0] [--no-browser]

Opens the viewer in the default browser. The settings page is /settings, and
any phone on the same Wi-Fi can open it at http://<this-PC-IP>:<port>/settings.
"""

import argparse
import os
import tempfile
import threading
import webbrowser
from pathlib import Path

from web import app, autostart_lights, tracker_file_info


def acquire_instance_lock(port):
    """Keep two tracker servers from sharing a port on Windows.

    Werkzeug's reusable development-server socket can let several processes listen on the
    same Windows port. Requests then land on whichever version happens to receive them. A
    small OS-held file lock is released automatically when the process exits, including
    after a crash.
    """
    lock_path = Path(tempfile.gettempdir()) / f"triangle-agency-tracker-{port}.lock"
    lock_file = open(lock_path, "a+b")
    if lock_file.seek(0, os.SEEK_END) == 0:
        lock_file.write(b"\0")
        lock_file.flush()
    lock_file.seek(0)

    try:
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (OSError, IOError):
        lock_file.close()
        return None
    return lock_file


def main():
    parser = argparse.ArgumentParser(description="Serve the Triangle Agency Tracker.")
    # 5000 and 5001 are taken by LightRPG and MTG_Table on the same PC.
    parser.add_argument("--port", type=int, default=5002, help="port to listen on (default: 5002)")
    parser.add_argument("--host", default="0.0.0.0", help="interface to bind (default: all)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    args = parser.parse_args()

    # Keep this handle alive for the lifetime of the server. The operating system releases
    # the lock automatically on exit, so an unclean shutdown cannot strand it.
    instance_lock = acquire_instance_lock(args.port)
    if instance_lock is None:
        print(f"Triangle Agency Tracker is already running on port {args.port}.")
        print(f"Open http://localhost:{args.port}/ instead of starting another copy.")
        return

    url = "http://localhost:{}/".format(args.port)
    print("Triangle Agency Tracker")
    print("  Viewer:   {}".format(url))
    print("  Settings: {}settings".format(url))
    print("  Data:     {}".format(tracker_file_info()["file"]))
    print("Bound to {}:{} - other devices on the LAN can open it too. Ctrl+C or Log Out to stop.".format(args.host, args.port))

    lights_message = autostart_lights()
    if lights_message:
        print("Lights: {}".format(lights_message))

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    app.run(host=args.host, port=args.port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
