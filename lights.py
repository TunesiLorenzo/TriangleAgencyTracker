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

A scene is a short programme for the room, run on the same worker and ended by whatever
comes next. The viewer's login screen asks for them (js/login.js), with the cues picked
under "Session lights" on /settings:
    powerOn   the screen switching on: the bulbs pulse between the standby light and a colour
    login     the login screen: one cue on the centre bulb and the strip, another on the side bulbs
    severed   Log Out's countdown: the bulbs and the strip breathe a colour
    shutdown  the screen switching off: everything dark, then the centre bulb alone fades up
              to the standby light
"""

import ipaddress
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

# The standard two-computer layout keeps LightRPG beside the room display. The
# launcher overrides this with loopback when both services intentionally share a PC.
LIGHTRPG_URL = os.environ.get("LIGHTRPG_URL", "http://Laptop-Lorenzo:5000").rstrip("/")
LIGHTRPG_DIR = Path(os.environ.get("LIGHTRPG_DIR", Path(__file__).resolve().parent.parent / "LightRPG"))

BULB_IDS = ("top_left", "center", "bottom_right")
CENTER_BULB = "center"
SIDE_BULBS = ("top_left", "bottom_right")
SCENES = ("powerOn", "login", "severed", "shutdown")
# The strip controller's own breathing programmes, by the hue each one shows.
STRIP_BREATHE = ((0, "crossfade_red"), (60, "crossfade_yellow"), (120, "crossfade_green"),
                 (180, "crossfade_cyan"), (240, "crossfade_blue"), (300, "crossfade_magenta"))
PULSE_HOLD = 0.5          # seconds the power-on pulse rests on each of its two looks
PULSE_LIMIT = 20          # seconds it runs for when no login scene ends it
FADE_STEPS = 8            # brightness steps of the standby light fading up
TARGETS = ("all", "all_bulbs", "strip", *BULB_IDS)
BULB_EFFECTS = ("bonfire", "mystic", "police", "flicker", "breathe", "thunderstorm", "aurora", "room_wave")
ACTIONS = ("none", "color", "white", "effect", "off")
REQUEST_TIMEOUT = 40      # LightRPG itself gives a device 35 s to answer
STATUS_TTL = 5            # seconds a status reply is reused


class LightRPGError(RuntimeError):
    pass


class Superseded(Exception):
    """A newer cue or scene is waiting: the running scene stops where it is."""


def is_local_url(url):
    """Return whether a LightRPG URL points back to this computer.

    Only loopback addresses are locally startable. A LAN hostname may resolve
    to another computer (and change address through DHCP), so an outage there
    must not make the tracker launch a second LightRPG process locally.
    """
    try:
        host = urllib.parse.urlsplit(url).hostname
        if not host:
            return False
        if host.casefold() == "localhost":
            return True
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


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


def strip_breathe(hue):
    """The LED strip fading in and out in the controller's colour nearest to this hue."""
    effect = min(STRIP_BREATHE, key=lambda entry: abs((hue - entry[0] + 180) % 360 - 180))[1]
    # Brightness 100: the strip keeps that setting for every colour that follows.
    call("POST", "/api/strip/effect", {"effect": effect, "speed": 50, "brightness": 100})


def scene_cue(session, key):
    cue = session.get(key)
    return cue if isinstance(cue, dict) else {"action": "none"}


class LightBridge:
    def __init__(self, logger):
        self.logger = logger
        self.condition = threading.Condition()
        self.pending = None          # ("cue", cue, ambient, target) or ("scene", name, session, target) waiting to run
        self.busy = False            # the worker is sending a cue or running a scene
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
        installed = (LIGHTRPG_DIR / "web.py").is_file()
        local = is_local_url(LIGHTRPG_URL)
        return {
            **self.status(fresh=True),
            "url": LIGHTRPG_URL,
            "local": local,
            "installed": installed,
            "startable": local and installed,
            "starting": self.process is not None and self.process.poll() is None,
            "lastError": self.last_error,
        }

    def start_lightrpg(self):
        """Launch LightRPG's web mode in its own console window, unless it already answers."""
        if self.status(fresh=True)["reachable"]:
            return "LightRPG is already running"
        if not is_local_url(LIGHTRPG_URL):
            raise LightRPGError(
                f"LightRPG is configured on another computer at {LIGHTRPG_URL}; start it there"
            )
        if self.process is not None and self.process.poll() is None:
            return "LightRPG is starting"
        script = LIGHTRPG_DIR / "web.py"
        if not script.is_file():
            raise LightRPGError(f"LightRPG was not found in {LIGHTRPG_DIR}")
        flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
        self.process = subprocess.Popen([sys.executable, str(script)], cwd=LIGHTRPG_DIR, creationflags=flags)
        return "LightRPG is starting in its own window"

    def stop_lightrpg(self):
        """Ask LightRPG to stop, wherever it runs (Log Out, once the lights are done)."""
        try:
            call("POST", "/api/shutdown", timeout=5)
        except LightRPGError as error:
            self.logger.info("LightRPG was not stopped: %s", error)

    # ---------- cues ----------
    def submit(self, cue, ambient, target):
        """Queue a cue; a cue still waiting to run is replaced, a timed one is cut short."""
        with self.condition:
            self.pending = ("cue", cue, ambient, target)
            self.condition.notify_all()

    def submit_scene(self, name, session, target):
        """Queue a scene; like a cue, it replaces whatever is waiting or running."""
        with self.condition:
            self.pending = ("scene", name, session, target)
            self.condition.notify_all()

    def wait_idle(self, timeout):
        """Block until nothing is waiting or running (Log Out's lights finish before the server stops)."""
        with self.condition:
            self.condition.wait_for(lambda: self.pending is None and not self.busy, timeout)

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
                self.busy = True

            if job is None:                       # the hold ran out with nothing new
                ambient, target, _ = restore
                restore = None
                self._run(ambient, target)
            elif job[0] == "scene":
                restore = None
                self._run_scene(*job[1:])
            else:
                _, cue, ambient, target = job
                restore = None
                self._run(cue, target)
                seconds = clamp(cue.get("seconds"), 0, 600, 0)
                if seconds > 0 and ambient and ambient.get("action", "none") != "none":
                    restore = (ambient, target, time.monotonic() + seconds)

            with self.condition:
                self.busy = False
                self.condition.notify_all()

    def _run(self, cue, target):
        try:
            self.apply(cue, target)
            self.last_error = ""
        except Exception as error:   # keep the worker alive whatever LightRPG says
            self.last_error = str(error)
            self.logger.warning("Light cue failed: %s", error)

    def apply(self, cue, target):
        """Send one cue to LightRPG right now (blocking)."""
        if cue.get("action", "none") == "none":
            return
        bulbs, strip = self._devices(cue.get("target") or target)
        self._send(cue, bulbs, strip)

    def _devices(self, target):
        """The bulbs a target reaches and whether it reaches the strip, among those LightRPG has set up."""
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
        return bulbs, strip

    def _send(self, cue, bulbs, strip):
        """One cue on exactly these bulbs, and on the strip if asked."""
        action = cue.get("action", "none")
        if action == "none":
            return
        if action not in ACTIONS:
            raise ValueError(f"Unknown light action {action!r}")
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

    # ---------- scenes ----------
    def _run_scene(self, name, session, target):
        try:
            bulbs, strip = self._devices(target)
            getattr(self, f"_scene_{name}")(session, bulbs, strip)
            self.last_error = ""
        except Superseded:
            pass
        except Exception as error:
            self.last_error = str(error)
            self.logger.warning("Light scene %s failed: %s", name, error)

    def _pause(self, seconds=0):
        """Wait inside a scene; a newer cue or scene ends the scene instead."""
        deadline = time.monotonic() + seconds
        with self.condition:
            while self.pending is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return
                self.condition.wait(remaining)
        raise Superseded

    def _bulbs_off(self, bulbs):
        if bulbs:
            call("POST", "/api/bulb/power", {"on": False, "targets": bulbs})

    def _standby_look(self, standby, bulbs):
        """What Log Out leaves behind: the centre bulb on the standby light, the side bulbs off."""
        if CENTER_BULB in bulbs:
            if standby.get("action", "none") in ("none", "off"):
                self._bulbs_off([CENTER_BULB])
            else:
                self._send(standby, [CENTER_BULB], False)
        self._bulbs_off([key for key in bulbs if key in SIDE_BULBS])

    def _scene_powerOn(self, session, bulbs, strip):
        """Pulse between the standby look, which is how Log Out left the room, and a colour."""
        pulse = scene_cue(session, "powerOn")
        if pulse.get("action", "none") == "none":
            return
        standby = scene_cue(session, "standby")
        if strip:
            strip_breathe(round(clamp(pulse.get("hue"), 0, 360, 0)))
        deadline = time.monotonic() + PULSE_LIMIT
        while time.monotonic() < deadline:
            self._send(pulse, bulbs, False)
            self._pause(PULSE_HOLD)
            self._standby_look(standby, bulbs)
            self._pause(PULSE_HOLD)

    def _scene_login(self, session, bulbs, strip):
        self._send(scene_cue(session, "loginCenter"), [key for key in bulbs if key == CENTER_BULB], strip)
        self._pause()
        self._send(scene_cue(session, "loginSides"), [key for key in bulbs if key in SIDE_BULBS], False)

    def _scene_severed(self, session, bulbs, strip):
        cue = scene_cue(session, "severed")
        if cue.get("action", "none") == "none":
            return
        if bulbs:
            # LightRPG's Breathe pulses whatever colour the bulbs are on, from dim to full.
            self._send({**cue, "brightness": 100}, bulbs, False)
            call("POST", "/api/bulb/effect", {"effect": "breathe", "targets": bulbs, "sound": False})
        if strip:
            strip_breathe(round(clamp(cue.get("hue"), 0, 360, 0)))

    def _scene_shutdown(self, session, bulbs, strip):
        standby = scene_cue(session, "standby")
        fades = CENTER_BULB in bulbs and standby.get("action") in ("color", "white")
        # Left on the standby light at its dimmest, the centre bulb comes back without a
        # flash of the colour it had.
        if fades:
            self._send({**standby, "brightness": 1}, [CENTER_BULB], False)
        self._bulbs_off(bulbs)
        if strip:
            call("POST", "/api/strip/power", {"on": False})
        self._pause(clamp(session.get("blackout"), 0, 30, 2))
        if not fades:
            return
        full = clamp(standby.get("brightness"), 1, 100, 60)
        fade = clamp(session.get("fade"), 0, 30, 4)
        started = time.monotonic()
        for step in range(1, FADE_STEPS + 1):
            share = step / FADE_STEPS
            # squared: the eye reads the low end of a bulb's range as most of the change
            self._send({**standby, "brightness": max(1, round(full * share * share))}, [CENTER_BULB], False)
            self._pause(max(0, started + fade * share - time.monotonic()))
