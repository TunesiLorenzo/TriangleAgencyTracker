"""Local server for the Triangle Agency Tracker.

Usage:
    python serve.py [--port 5002] [--host 0.0.0.0] [--no-browser]

Opens the viewer in the default browser. The settings page is /settings, and
any phone on the same Wi-Fi can open it at http://<this-PC-IP>:<port>/settings.
"""

import argparse
import threading
import webbrowser

from web import app


def main():
    parser = argparse.ArgumentParser(description="Serve the Triangle Agency Tracker.")
    # 5000 and 5001 are taken by LightRPG and MTG_Table on the same PC.
    parser.add_argument("--port", type=int, default=5002, help="port to listen on (default: 5002)")
    parser.add_argument("--host", default="0.0.0.0", help="interface to bind (default: all)")
    parser.add_argument("--no-browser", action="store_true", help="do not open a browser window")
    args = parser.parse_args()

    url = "http://localhost:{}/".format(args.port)
    print("Triangle Agency Tracker")
    print("  Viewer:   {}".format(url))
    print("  Settings: {}settings".format(url))
    print("Bound to {}:{} - other devices on the LAN can open it too. Ctrl+C to stop.".format(args.host, args.port))

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    app.run(host=args.host, port=args.port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
