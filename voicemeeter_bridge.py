"""Loopback bridge between the room browser and the local VoiceMeeter engine.

The Triangle viewer can be served by another computer, but VoiceMeeter runs on
this one. Browsers cannot call VoiceMeeter's native API directly, so this tiny
HTTP service exposes only status and strip-gain controls on loopback, and
stops when the tracker's Log Out asks it to.
"""

import argparse
import atexit
import ctypes
import ipaddress
import os
import threading
import time
from pathlib import Path
from urllib.parse import urlsplit

from flask import Flask, jsonify, request

try:
    import winreg
except ImportError:
    winreg = None


DEFAULT_PORT = 5003
TRACKER_PORT = 5002


class VoiceMeeterError(RuntimeError):
    pass


def _installed_dll_candidates():
    """Yield the matching Remote API DLL installed with VoiceMeeter."""
    dll_name = "VoicemeeterRemote64.dll" if ctypes.sizeof(ctypes.c_void_p) == 8 else "VoicemeeterRemote.dll"
    seen = set()

    for variable in ("ProgramFiles(x86)", "ProgramFiles"):
        folder = os.environ.get(variable)
        if folder:
            candidate = Path(folder) / "VB" / "Voicemeeter" / dll_name
            key = str(candidate).casefold()
            if key not in seen:
                seen.add(key)
                yield candidate

    if winreg is None:
        return

    uninstall = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
    views = (winreg.KEY_WOW64_32KEY, winreg.KEY_WOW64_64KEY)
    for hive in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
        for view in views:
            try:
                parent = winreg.OpenKey(hive, uninstall, 0, winreg.KEY_READ | view)
            except OSError:
                continue
            with parent:
                index = 0
                while True:
                    try:
                        subkey_name = winreg.EnumKey(parent, index)
                    except OSError:
                        break
                    index += 1
                    try:
                        with winreg.OpenKey(parent, subkey_name) as subkey:
                            display = str(winreg.QueryValueEx(subkey, "DisplayName")[0])
                            if "voicemeeter" not in display.casefold():
                                continue
                            folders = []
                            try:
                                folders.append(str(winreg.QueryValueEx(subkey, "InstallLocation")[0]))
                            except OSError:
                                pass
                            try:
                                command = str(winreg.QueryValueEx(subkey, "UninstallString")[0]).strip('"')
                                folders.append(str(Path(command).parent))
                            except OSError:
                                pass
                            for folder in folders:
                                candidate = Path(folder) / dll_name
                                key = str(candidate).casefold()
                                if key not in seen:
                                    seen.add(key)
                                    yield candidate
                    except OSError:
                        continue


def find_voicemeeter_dll():
    for candidate in _installed_dll_candidates():
        if candidate.is_file():
            return candidate
    raise VoiceMeeterError("VoiceMeeter Remote API was not found. Install VoiceMeeter on this laptop.")


class VoiceMeeter:
    """Persistent, serialized access to VoiceMeeter's local Remote API."""

    def __init__(self):
        self._dll = None
        self._lock = threading.RLock()
        self._fade_lock = threading.Lock()
        self._fade_generation = {}

    def connect(self):
        with self._lock:
            if self._dll is not None:
                return
            if os.name != "nt":
                raise VoiceMeeterError("The VoiceMeeter bridge requires Windows.")
            path = find_voicemeeter_dll()
            dll = ctypes.WinDLL(str(path))
            dll.VBVMR_Login.restype = ctypes.c_long
            dll.VBVMR_Logout.restype = ctypes.c_long
            dll.VBVMR_GetVoicemeeterType.argtypes = [ctypes.POINTER(ctypes.c_long)]
            dll.VBVMR_GetVoicemeeterType.restype = ctypes.c_long
            dll.VBVMR_GetParameterFloat.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_float)]
            dll.VBVMR_GetParameterFloat.restype = ctypes.c_long
            dll.VBVMR_SetParameterFloat.argtypes = [ctypes.c_char_p, ctypes.c_float]
            dll.VBVMR_SetParameterFloat.restype = ctypes.c_long
            result = dll.VBVMR_Login()
            if result < 0:
                raise VoiceMeeterError(f"VoiceMeeter Remote API login failed ({result}).")
            self._dll = dll

    def close(self):
        with self._lock:
            if self._dll is not None:
                try:
                    self._dll.VBVMR_Logout()
                finally:
                    self._dll = None

    def status(self):
        self.connect()
        kind = ctypes.c_long()
        with self._lock:
            result = self._dll.VBVMR_GetVoicemeeterType(ctypes.byref(kind))
        if result != 0 or kind.value <= 0:
            raise VoiceMeeterError("VoiceMeeter is installed but is not running.")
        names = {1: "VoiceMeeter", 2: "VoiceMeeter Banana", 3: "VoiceMeeter Potato"}
        return names.get(kind.value, f"VoiceMeeter type {kind.value}")

    @staticmethod
    def _parameter(strip):
        if not isinstance(strip, int) or isinstance(strip, bool) or not 0 <= strip <= 15:
            raise ValueError("Strip must be a whole number from 0 to 15.")
        return f"Strip[{strip}].Gain".encode("ascii")

    def _get_gain(self, parameter):
        value = ctypes.c_float()
        with self._lock:
            result = self._dll.VBVMR_GetParameterFloat(parameter, ctypes.byref(value))
        if result != 0:
            raise VoiceMeeterError(f"VoiceMeeter could not read the strip gain ({result}).")
        return float(value.value)

    def _set_gain(self, parameter, value):
        with self._lock:
            result = self._dll.VBVMR_SetParameterFloat(parameter, ctypes.c_float(value))
        if result != 0:
            raise VoiceMeeterError(f"VoiceMeeter could not set the strip gain ({result}).")

    def fade(self, strip, target, seconds):
        self.connect()
        self.status()
        parameter = self._parameter(strip)
        target = max(-60.0, min(12.0, float(target)))
        seconds = max(0.0, min(30.0, float(seconds)))

        with self._fade_lock:
            generation = self._fade_generation.get(strip, 0) + 1
            self._fade_generation[strip] = generation

        if seconds == 0:
            self._set_gain(parameter, target)
            return

        start = self._get_gain(parameter)
        threading.Thread(
            target=self._run_fade,
            args=(strip, parameter, start, target, seconds, generation),
            name=f"VoiceMeeter strip {strip} fade",
            daemon=True,
        ).start()

    def _run_fade(self, strip, parameter, start, target, seconds, generation):
        began = time.monotonic()
        while True:
            elapsed = time.monotonic() - began
            progress = min(1.0, elapsed / seconds)
            with self._fade_lock:
                if self._fade_generation.get(strip) != generation:
                    return
            try:
                self._set_gain(parameter, start + (target - start) * progress)
            except VoiceMeeterError:
                return
            if progress >= 1.0:
                return
            time.sleep(min(0.02, max(0.001, seconds - elapsed)))


def _is_safe_tracker_origin(origin, explicitly_allowed=()):
    if not origin:
        return True
    if origin in explicitly_allowed:
        return True
    try:
        parsed = urlsplit(origin)
        if parsed.scheme not in {"http", "https"} or parsed.port != TRACKER_PORT:
            return False
        host = parsed.hostname or ""
        if host.casefold() == "localhost" or host.casefold().endswith(".local") or "." not in host:
            return True
        address = ipaddress.ip_address(host)
        return address.is_private or address.is_loopback
    except (ValueError, TypeError):
        return False


def create_app(voicemeeter=None, allowed_origins=()):
    app = Flask(__name__)
    mixer = voicemeeter or VoiceMeeter()
    allowed_origins = frozenset(allowed_origins)

    @app.before_request
    def protect_loopback_api():
        origin = request.headers.get("Origin", "")
        if origin and not _is_safe_tracker_origin(origin, allowed_origins):
            return jsonify({"ok": False, "message": "This origin may not control the local VoiceMeeter bridge."}), 403
        if request.method == "OPTIONS":
            return "", 204

    @app.after_request
    def allow_room_browser(response):
        origin = request.headers.get("Origin", "")
        if origin and _is_safe_tracker_origin(origin, allowed_origins):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    @app.get("/api/status")
    def status():
        try:
            name = mixer.status()
            return jsonify({"ok": True, "service": True, "voicemeeter": True, "name": name})
        except (VoiceMeeterError, OSError) as error:
            return jsonify({"ok": False, "service": True, "voicemeeter": False, "message": str(error)})

    @app.post("/api/voicemeeter")
    def command():
        try:
            payload = request.get_json(silent=True) or {}
            strip = payload.get("strip", 0)
            action = payload.get("action")
            if action not in {"drop", "restore"}:
                raise ValueError("Action must be drop or restore.")
            level = payload.get("drop" if action == "drop" else "normal", 0)
            seconds = payload.get("fadeSeconds", 0)
            mixer.fade(strip, level, seconds)
            return jsonify({
                "ok": True,
                "message": f"Local VoiceMeeter strip {strip} fading to {float(level):.1f} dB.",
            })
        except (TypeError, ValueError, VoiceMeeterError, OSError) as error:
            return jsonify({"ok": False, "message": str(error)}), 400

    @app.post("/api/shutdown")
    def shutdown():
        """Log Out on the tracker stops this bridge too, once the reply has left."""
        def stop():
            try:
                mixer.close()
            finally:
                os._exit(0)   # Flask's development server has no stop call

        threading.Timer(0.5, stop).start()
        return jsonify({"ok": True, "message": "The VoiceMeeter bridge is stopping."})

    return app


def main():
    parser = argparse.ArgumentParser(description="Local VoiceMeeter bridge for Triangle Agency Tracker")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--allow-origin", action="append", default=[])
    args = parser.parse_args()
    mixer = VoiceMeeter()
    atexit.register(mixer.close)
    app = create_app(mixer, args.allow_origin)
    print(f"VoiceMeeter bridge: http://127.0.0.1:{args.port}")
    app.run(host="127.0.0.1", port=args.port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
