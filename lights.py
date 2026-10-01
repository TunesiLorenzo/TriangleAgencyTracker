"""Bridge from tracker events to LightRPG (the Tapo bulbs and the BLEDOM strip).

LightRPG stays its own program: it owns the Bluetooth strip and the bulb
connections, and already serves a REST API on port 5000. The tracker only sends
it commands, so both keep working on their own and LightRPG's page stays
available for manual control.

A cue is what one tracker event does to the lights:
    {"action": "none" | "color" | "white" | "effect" | "off",
     "hue": 0-360, "saturation": 0-100, "brightness": 1-100,
     "temperature": 2500-6500, "effect": "bulb:<name>" | "strip:<name>",
     "led": 0-360, the LED strip's hue for "white" and bulb effects,
     "seconds": 0 = keep it, else return to the ambient cue after that long}

The LED strip is not a bulb: it has no white and dimmed or pastel colours look wrong
on it, so it always runs at 100% saturation and brightness. A colour cue shows its hue
on it; white and bulb effects show the cue's "led" hue; strip effects run at full power.

Tapo bulbs need a few hundred milliseconds per command, so cues run one at a
time on a worker thread and only the newest waiting cue is kept: a burst of
events never builds a backlog, and a new cue cuts short a timed one.
"""

import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

LIGHTRPG_URL = os.environ.get("LIGHTRPG_URL", "http://127.0.0.1:5000").rstrip("/")
LIGHTRPG_DIR = Path(os.environ.get("LIGHTRPG_DIR", Path(__file__).resolve().parent.parent / "LightRPG"))

BULB_IDS = ("top_left", "center", "bottom_right")
TARGETS = ("all", "all_bulbs", "strip", *BULB_IDS)
BULB_EFFECTS = ("bonfire", "mystic", "police", "flicker", "breathe", "thunderstorm", "aurora", "room_wave")
ACTIONS = ("none", "color", "white", "effect", "off")
REQUEST_TIMEOUT = 40      # LightRPG itself gives a device 35 s to answer
STATUS_TTL = 5            # seconds a status reply is reused


class LightRPGError(RuntimeError):
    pass


def clamp(value, low, high, default):
    try:
        return max(low, min(high, float(value)))
    except (TypeError, ValueError):
        return default


def call(method, path, payload=None, timeout=REQUEST_TIMEOUT):
    """One request to LightRPG. Raises LightRPGError with LightRPG's own message."""
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        LIGHTRPG_URL + path, data=data, method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            return json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        try:
            message = json.loads(error.read()).get("message")
        except ValueError:
            message = None
        raise LightRPGError(message or f"LightRPG answered HTTP {error.code}") from error
    except (urllib.error.URLError, OSError, ValueError) as error:
        raise LightRPGError(f"LightRPG is not reachable at {LIGHTRPG_URL}") from error


def strip_color(hue):
    """The LED strip in one colour, always at full saturation and brightness."""
    call("POST", "/api/color", {"hue": hue, "saturation": 100, "brightness": 100, "target": "strip"})


class LightBridge:
    def __init__(self, logger):
        self.logger = logger
        self.condition = threading.Condition()
        self.pending = None          # (cue, ambient, target) waiting to run
        self.last_error = ""
        self.status_cache = (0.0, None)
        self.process = None
        threading.Thread(target=self._worker, daemon=True, name="lightrpg-cues").start()

    # ---------- status and launching ----------
    def status(self, fresh=False):
        checked_at, cached = self.status_cache
        if not fresh and cached is not None and time.monotonic() - checked_at < STATUS_TTL:
            return cached
        try:
            reply = call("GET", "/api/status", timeout=3)
            result = {
                "reachable": True,
                "bulbs": {key: bool(info.get("configured")) for key, info in (reply.get("bulbs") or {}).items()},
                "strip": bool(reply.get("strip_connected")),
            }
        except LightRPGError:
            result = {"reachable": False, "bulbs": {}, "strip": False}
        self.status_cache = (time.monotonic(), result)
        return result

    def report(self):
        return {
            **self.status(fresh=True),
            "url": LIGHTRPG_URL,
            "installed": (LIGHTRPG_DIR / "web.py").is_file(),
            "starting": self.process is not None and self.process.poll() is None,
            "lastError": self.last_error,
        }

    def start_lightrpg(self):
        """Launch LightRPG's web mode in its own console window, unless it already answers."""
        if self.status(fresh=True)["reachable"]:
            return "LightRPG is already running"
        if self.process is not None and self.process.poll() is None:
            return "LightRPG is starting"
        script = LIGHTRPG_DIR / "web.py"
        if not script.is_file():
            raise LightRPGError(f"LightRPG was not found in {LIGHTRPG_DIR}")
        flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        self.process = subprocess.Popen([sys.executable, str(script)], cwd=LIGHTRPG_DIR, creationflags=flags)
        return "LightRPG is starting in its own window"

    # ---------- cues ----------
    def submit(self, cue, ambient, target):
        """Queue a cue; a cue still waiting to run is replaced, a timed one is cut short."""
        with self.condition:
            self.pending = (cue, ambient, target)
            self.condition.notify()

    def _worker(self):
        restore = None   # (ambient, target) to apply when a timed cue runs out
        while True:
            with self.condition:
                deadline = restore and restore[2]
                while self.pending is None:
                    remaining = None if not deadline else deadline - time.monotonic()
                    if remaining is not None and remaining <= 0:
                        break
                    self.condition.wait(remaining)
                job, self.pending = self.pending, None

            if job is None:                       # the hold ran out with nothing new
                ambient, target, _ = restore
                restore = None
                self._run(ambient, target)
                continue

            cue, ambient, target = job
            restore = None
            self._run(cue, target)
            seconds = clamp(cue.get("seconds"), 0, 600, 0)
            if seconds > 0 and ambient and ambient.get("action", "none") != "none":
                restore = (ambient, target, time.monotonic() + seconds)

    def _run(self, cue, target):
        try:
            self.apply(cue, target)
            self.last_error = ""
        except Exception as error:   # keep the worker alive whatever LightRPG says
            self.last_error = str(error)
            self.logger.warning("Light cue failed: %s", error)

    def apply(self, cue, target):
        """Send one cue to LightRPG right now (blocking)."""
        action = cue.get("action", "none")
        if action == "none":
            return
        if action not in ACTIONS:
            raise ValueError(f"Unknown light action {action!r}")
        target = cue.get("target") or target
        if target not in TARGETS:
            raise ValueError(f"Unknown light target {target!r}")

        status = self.status()
        if not status["reachable"]:
            raise LightRPGError(f"LightRPG is not reachable at {LIGHTRPG_URL}")
        # Only address devices LightRPG has set up, so one missing device never
        # blocks the others (LightRPG rejects the whole command otherwise).
        if target in ("all", "all_bulbs"):
            bulbs = [key for key in BULB_IDS if status["bulbs"].get(key)]
        elif target in BULB_IDS:
            bulbs = [target] if status["bulbs"].get(target) else []
        else:
            bulbs = []
        strip = target in ("all", "strip") and status["strip"]
        if not bulbs and not strip:
            raise LightRPGError("No connected light for this target; set them up on the LightRPG page")

        brightness = round(clamp(cue.get("brightness"), 1, 100, 100))
        hue = round(clamp(cue.get("hue"), 0, 360, 0))
        led = round(clamp(cue.get("led"), 0, 360, 30))
        if action == "color":
            if bulbs:
                call("POST", "/api/color", {"hue": hue, "saturation": round(clamp(cue.get("saturation"), 0, 100, 100)),
                                            "brightness": brightness, "targets": bulbs})
            if strip:
                strip_color(hue)
        elif action == "white":
            if bulbs:
                temperature = round(clamp(cue.get("temperature"), 2500, 6500, 2700))
                call("POST", "/api/bulb/white", {"temperature": temperature, "brightness": brightness, "targets": bulbs})
            if strip:   # the strip has no white channel: it shows the cue's LED colour instead
                strip_color(led)
        elif action == "off":
            if bulbs:
                call("POST", "/api/bulb/power", {"on": False, "targets": bulbs})
        elif action == "effect":
            kind, _, name = str(cue.get("effect", "")).partition(":")
            if kind == "bulb":
                if name not in BULB_EFFECTS:
                    raise ValueError(f"Unknown bulb effect {name!r}")
                # The strip first: a colour stops LightRPG's Room Wave, so it must not follow the effect.
                if strip:
                    strip_color(led)
                if bulbs:
                    call("POST", "/api/bulb/effect", {"effect": name, "targets": bulbs, "sound": False})
            elif kind == "strip" and strip:
                # Its brightness setting outlasts the effect, so anything below 100 would dim every later colour.
                call("POST", "/api/strip/effect", {"effect": name, "speed": round(clamp(cue.get("speed"), 0, 100, 50)),
                                                   "brightness": 100})
