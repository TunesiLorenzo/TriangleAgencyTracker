// settings.js
// The /settings page: assigns sounds to tracker events, viewer buttons (one submenu
// per viewer tab) and competency cues, tunes the amplifier keep-alive tone, manages
// the audio library, tunes the visual effects, sets the room-light cues sent
// to LightRPG, and sets up the login screen (badge picture, timing of each step).
// Every edit updates a local draft,
// previews immediately, and is saved (debounced) to the server, which pushes it to
// open viewers.

import {
  BUTTON_GROUPS, COMPETENCIES, DEFAULT_CONFIG, GRA_CHAOS_EFFECTS, LIGHT_ACTIONS, LIGHT_EFFECTS, LIGHT_EVENTS,
  LIGHT_TARGETS, RISK_LEVELS, SOUND_EVENTS, competencyFile, getConfig, isCompetencyFolderFile,
  getConfigRevision, mergeConfig, onConfigChange, reloadConfig, saveConfig, setLocalConfig, setSoundFiles,
  startConfigSync
} from '/js/config.js';
import { sendLightCue, sendLightScene } from '/js/lights.js';
import { playSlot, resolveSlot } from '/js/soundEffects.js';
import { SYNTHS } from '/js/synth.js';
import { COMPETENCY_INFO } from '/js/competencies.js';
import { setVoiceMeeterLevel } from '/js/voicemeeter.js';

const TAB_KEY = 'ta-settings-tab';
const BUTTON_GROUP_KEY = 'ta-settings-button-group';
const SETTINGS_FILE_FORMAT = 'triangle-agency-tracker-settings';
const SETTINGS_FILE_VERSION = 1;
const TRACKER_FILE_FORMAT = 'triangle-agency-tracker';   // the server's file: team and settings
const MAX_SETTINGS_FILE_BYTES = 512 * 1024;

const KEEP_ALIVE_FIELDS = [
  { key: 'enabled', label: 'Drone on', type: 'toggle' },
  { key: 'level', label: 'Drone volume', min: 0, max: 0.05, step: 0.001, percent: true, decimals: 1 },
  { key: 'frequency', label: 'Drone pitch', min: 20, max: 250, step: 5, unit: 'Hz' }
];

// The Lights tab: the general switches, then the sliders each cue action shows.
const LIGHT_GENERAL_FIELDS = [
  { key: 'enabled', label: 'Event lights on', type: 'toggle' },
  { key: 'autoStart', label: 'Start LightRPG with the tracker', type: 'toggle' },
  { key: 'target', label: 'Lights to use', type: 'select', options: LIGHT_TARGETS }
];
const LIGHT_FIELDS = {
  hue: { label: 'Hue', min: 0, max: 360, step: 5, unit: '°' },
  saturation: { label: 'Saturation', min: 0, max: 100, step: 5, unit: '%' },
  brightness: { label: 'Brightness', min: 1, max: 100, step: 1, unit: '%' },
  temperature: { label: 'Temperature', min: 2500, max: 6500, step: 100, unit: 'K' },
  led: { label: 'LED colour', min: 0, max: 360, step: 5, unit: '°' },
  seconds: { label: 'Hold', min: 0, max: 30, step: 0.5, unit: 's', zeroLabel: 'keep' },
  blackout: { label: 'Screen off: dark for', min: 0, max: 10, step: 0.5, unit: 's' },
  fade: { label: 'Standby light fades up over', min: 0, max: 15, step: 0.5, unit: 's' }
};
// Session lights (lights.session): the cue behind each step of the scenes in lights.py.
// `scene` is what the test button runs; `strip: false` marks a cue only bulbs show.
const SESSION_LIGHTS = [
  { key: 'powerOn', label: 'Power on', hint: 'Bulbs pulse between the standby light and this; the LED strip breathes it', actions: ['none', 'color'], scene: 'powerOn' },
  { key: 'loginCenter', label: 'Login screen: centre bulb', hint: 'Once the picture has settled; the LED strip follows this one', actions: ['none', 'color', 'white', 'off'], scene: 'login' },
  { key: 'loginSides', label: 'Login screen: side bulbs', hint: 'Top-left and bottom-right', actions: ['none', 'color', 'white', 'off'], scene: 'login', strip: false },
  { key: 'severed', label: 'Log Out: link severed', hint: 'Bulbs and LED strip breathe this during the countdown', actions: ['none', 'color'], scene: 'severed' },
  { key: 'standby', label: 'Standby', hint: 'Screen off: all dark, then the centre bulb alone fades up to this', actions: ['none', 'color', 'white'], scene: 'shutdown', strip: false }
];
const BULB_ONLY_CUES = new Set(SESSION_LIGHTS.filter(row => row.strip === false).map(row => `lights.session.${row.key}`));
// What the bulbs take; the LED strip only ever gets a hue (see stripHue).
const LIGHT_ACTION_FIELDS = {
  none: [],
  color: ['hue', 'saturation', 'brightness'],
  white: ['temperature', 'brightness'],
  effect: [],
  off: []
};

// Effects made for a single mission. The Effects tab has only the picked one's cards out
// (effects.mission); `switch` is the setting that starts each, kept off for the others.
const MISSIONS = [
  { key: 'gra', label: 'G.R.A.', switch: 'effects.graTakeover.enabled' },
  { key: 'silence', label: 'Silenzio di Tomba', switch: 'effects.silence.enabled' }
];

// Slider/toggle definitions for the Effects tab. A group with `sound` also gets a sound
// slot, saved as effects.<group>.sound; one with `mission` belongs to that mission effect.
const EFFECT_GROUPS = [
  {
    key: 'graTakeover', mission: 'gra', title: 'G.R.A. takeover', eyebrow: 'DISPLAY OVERRIDE',
    hint: 'Let the anomaly seize every open viewer. Switching this on or off saves immediately and starts the transition sound, while the display stays signed in. The two marks are seconds into that sound: the toll barrier covers the screen and the new mode loads behind it, then the barriers lift. The scene dissolves as the sound ends, or about 2.5 s after the barriers lift when there is no sound or it is shorter. Choose a built-in sound or a file from the Sounds library. "Chaos effects" picks what a taken-over display does with chaos: the G.R.A. incidents (next card), the usual tracker effects (shake, grain, scanlines, critical glitch), or both.',
    fields: [
      { key: 'enabled', label: 'Take over viewer displays', type: 'toggle' },
      { key: 'chaosEffects', label: 'Chaos effects while taken over', type: 'select', options: GRA_CHAOS_EFFECTS },
      { key: 'coverAt', label: 'Toll barrier covers the screen at', min: 0, max: 30, step: 0.1, unit: 's' },
      { key: 'openAt', label: 'Barriers lift at', min: 0, max: 60, step: 0.1, unit: 's' }
    ],
    sound: { label: 'Barrier transition sound', hint: 'Starts the transition, in either direction' }
  },
  {
    key: 'graIncidents', mission: 'gra', title: 'G.R.A. incidents', eyebrow: 'WHILE THE TAKEOVER IS ON',
    hint: 'Things that happen at random on a taken-over viewer, unless the takeover is set to the usual chaos effects only. Strength is the first slider plus the share of the second that the Chaos counter has reached (see "Chaos for full intensity" on the Chaos atmosphere card), up to 100%. The three rates are times a minute at full strength; less strength means fewer incidents and milder, shorter breakdowns (3.5 to 10 seconds, one at a time). Vehicles play a recording from <code>audio/GRA</code>, a file with "truck" in its name for lorries and one with "car" for the rest, pitched to their speed: at 100% traffic speed they pass at about the pace of the recordings. None of this touches the tracker\'s data.',
    fields: [
      { key: 'baseStrength', label: 'Strength with no chaos', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'chaosStrength', label: 'Added at full chaos', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'carsPerMinute', label: 'Traffic', min: 0, max: 12, step: 0.5, unit: '/min', zeroLabel: 'off' },
      { key: 'popupsPerMinute', label: 'Autoverrox pop-ups', min: 0, max: 12, step: 0.5, unit: '/min', zeroLabel: 'off' },
      { key: 'glitchesPerMinute', label: 'Breakdowns', min: 0, max: 12, step: 0.5, unit: '/min', zeroLabel: 'off' },
      { key: 'trafficSpeed', label: 'Traffic speed', min: 0.4, max: 2.5, step: 0.05, percent: true },
      { key: 'trafficVolume', label: 'Traffic sound volume', min: 0, max: 1, step: 0.05, percent: true }
    ]
  },
  {
    key: 'silence', mission: 'silence', title: 'Silenzio di Tomba', eyebrow: 'DISPLAY OVERRIDE',
    hint: 'The anomaly that stops every sound, and with it the heart. On every open viewer the tracker\'s own sounds are swallowed and the display loses its colour: by the first slider, plus the share of the second that the Chaos counter has reached (see "Chaos for full intensity" on the Chaos atmosphere card), up to fully black and white. The heart is yours to play. Switched on, it fades in and beats at the rate set here: heard, drawn under the title, and letting a breath of colour through on each beat; a merit lands as one strong beat, a demerit as a missed one. Switched off, it fades away. "Trigger a flatline" makes it falter while darkness closes in from the edges, then stops it: the display stops too, fully black and white, under the long tone of a heart monitor, until the heart fades back in and everything moves again. None of this touches the tracker\'s data.',
    fields: [
      { key: 'enabled', label: 'Silence viewer displays', type: 'toggle' },
      { key: 'baseGrey', label: 'Black and white with no chaos', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'chaosGrey', label: 'Added at full chaos', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'heartbeat', label: 'Heartbeat', type: 'toggle' },
      { key: 'bpm', label: 'Heart rate', min: 30, max: 180, step: 2, unit: 'bpm' },
      { key: 'volume', label: 'Heartbeat volume', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'fadeSeconds', label: 'Heartbeat fades in and out over', min: 0, max: 15, step: 0.5, unit: 's', zeroLabel: 'at once' },
      { key: 'flatlineAt', label: 'Stop the heart', type: 'trigger', action: 'Trigger a flatline' },
      { key: 'failSeconds', label: 'Darkness closes in for', min: 0, max: 20, step: 0.5, unit: 's' },
      { key: 'flatlineSeconds', label: 'The heart stays stopped for', min: 1, max: 30, step: 0.5, unit: 's' },
      { key: 'flatlineVolume', label: 'Flatline tone volume', min: 0, max: 1, step: 0.05, percent: true, zeroLabel: 'off' }
    ]
  },
  {
    key: 'voicemeeter', title: 'VoiceMeeter music level', eyebrow: 'LOCAL TEST',
    hint: 'Fades one strip through the VoiceMeeter bridge running on this laptop. start_lan.bat starts the bridge in room and all modes. The command goes from this browser straight to 127.0.0.1, without crossing the LAN or visiting the desktop server.',
    fields: [
      { key: 'strip', label: 'Strip (first is 0)', min: 0, max: 15, step: 1 },
      { key: 'drop', label: 'Dropped level', min: -60, max: 0, step: 1, unit: 'dB' },
      { key: 'normal', label: 'Normal level', min: -60, max: 12, step: 1, unit: 'dB' },
      { key: 'fadeSeconds', label: 'Fade', min: 0, max: 10, step: 0.5, unit: 's', zeroLabel: 'at once' },
      { key: 'test', label: 'Try it', type: 'actions', actions: [{ key: 'drop', label: 'Drop' }, { key: 'restore', label: 'Restore' }] }
    ]
  },
  {
    key: 'meritLock', title: 'Merit and demerit lock', eyebrow: 'AGENT CARDS',
    hint: 'Each agent\'s merit and demerit triangles show a padlock instead of this mission\'s count, on every open viewer. They keep counting underneath, and the totals in the boxes beside them stay visible. The net score under them keeps its arrow but not its number, and the Agent Performance bars drift instead of holding still, so a standing can be guessed but not read. The padlock and key on the right of the task panel switch this too.',
    fields: [
      { key: 'enabled', label: 'Show a padlock instead of the counts', type: 'toggle' }
    ],
    sound: { label: 'Reveal sound', hint: 'Plays on every viewer when the counts are shown again' }
  },
  {
    key: 'atmosphere', title: 'Chaos atmosphere', eyebrow: 'ONE INTENSITY FOR EVERYTHING',
    hint: 'Chaos is turned into one intensity from 0 to 100%. These set what each layer does at full intensity.',
    fields: [
      { key: 'maxChaos', label: 'Chaos for full intensity', min: 4, max: 40, step: 1 },
      { key: 'easeSeconds', label: 'Response time', min: 0, max: 2, step: 0.05, unit: 's' },
      { key: 'grain', label: 'Film grain', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'grainFps', label: 'Grain frame rate', min: 4, max: 60, step: 1, unit: 'fps' },
      { key: 'vignette', label: 'Edge darkening', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'panelBlur', label: 'Blur behind panels', min: 0, max: 20, step: 0.5, unit: 'px' },
      { key: 'scanlines', label: 'Scanline overlay', min: 0, max: 1, step: 0.05, percent: true },
      { key: 'crtSpeed', label: 'CRT band speed', min: 0, max: 800, step: 10, unit: 'px/s' }
    ]
  },
  {
    key: 'shake', title: 'Screen shake', eyebrow: 'CHAOS',
    hint: 'Smooth drift plus sharp bursts that come more often as chaos rises.',
    fields: [
      { key: 'enabled', label: 'Shake enabled', type: 'toggle' },
      { key: 'drift', label: 'Drift distance', min: 0, max: 6, step: 0.1, unit: 'px' },
      { key: 'driftRotation', label: 'Drift rotation', min: 0, max: 2, step: 0.05, unit: '°' },
      { key: 'burstsPerSecond', label: 'Bursts per second', min: 0, max: 4, step: 0.1 },
      { key: 'burstSize', label: 'Burst distance', min: 0, max: 20, step: 0.5, unit: 'px' },
      { key: 'burstRotation', label: 'Burst rotation', min: 0, max: 4, step: 0.1, unit: '°' }
    ]
  },
  {
    key: 'glitch', title: 'Critical glitch', eyebrow: 'MISSION RISK',
    hint: 'At high Mission Risk, bursts split the screen into red/blue fringes and tear the title.',
    fields: [
      { key: 'enabled', label: 'Glitch enabled', type: 'toggle' },
      { key: 'minRisk', label: 'Starts at risk level', type: 'select', options: RISK_LEVELS.slice(1) },
      { key: 'burstsPerSecond', label: 'Glitches per second', min: 0, max: 4, step: 0.1 },
      { key: 'rgbSplit', label: 'Colour fringe', min: 0, max: 15, step: 0.5, unit: 'px' },
      { key: 'titleTear', label: 'Tear the title', type: 'toggle' }
    ]
  },
  {
    key: 'gates', title: 'Security gates', eyebrow: 'PREVIOUS CASES',
    hint: 'Seconds from the click, matched to the gate sounds. The doors speed up until the slam, then slow down to the end.',
    fields: [
      { key: 'disengageAt', label: 'Opening: locks release', min: 0, max: 10, step: 0.1, unit: 's' },
      { key: 'openStartAt', label: 'Opening: doors start moving', min: 0, max: 10, step: 0.1, unit: 's' },
      { key: 'openSlamAt', label: 'Opening: slam', min: 0, max: 15, step: 0.1, unit: 's' },
      { key: 'openEndAt', label: 'Opening: fully open', min: 0, max: 15, step: 0.1, unit: 's' },
      { key: 'closeStartAt', label: 'Closing: doors start moving', min: 0, max: 10, step: 0.1, unit: 's' },
      { key: 'closeSlamAt', label: 'Closing: slam', min: 0, max: 15, step: 0.1, unit: 's' },
      { key: 'closeEndAt', label: 'Closing: fully closed', min: 0, max: 15, step: 0.1, unit: 's' },
      { key: 'slamShare', label: 'Travel done at the slam', min: 0.3, max: 1, step: 0.05, percent: true }
    ]
  },
  {
    key: 'witnessHue', title: 'Witness colour', eyebrow: 'WITNESSES',
    hint: 'Witnesses tint the background from red, through magenta, to blue.',
    fields: [
      { key: 'maxWitnesses', label: 'Witnesses for full blue', min: 5, max: 50, step: 1 },
      { key: 'maxShift', label: 'Colour shift', min: 0, max: 180, step: 5, unit: '°' },
      { key: 'settleSeconds', label: 'Settle time', min: 0.1, max: 4, step: 0.1, unit: 's' },
      { key: 'overshoot', label: 'Overshoot on new witness', min: 0, max: 45, step: 1, unit: '°' },
      { key: 'pulse', label: 'Brightness pulse', type: 'toggle' }
    ]
  },
  {
    key: 'video', title: 'Background video', eyebrow: 'CHAOS',
    hint: 'The calm video crossfades to the strong one at this chaos level.',
    fields: [
      { key: 'strongAtChaos', label: 'Strong video from chaos', min: 0, max: 20, step: 1 },
      { key: 'fadeSeconds', label: 'Crossfade time', min: 0, max: 10, step: 0.5, unit: 's' }
    ]
  }
];

// The Login tab: seconds for each step of the sign-in (login.js), in the order they play.
const LOGIN_TIMING_FIELDS = [
  { key: 'typingStart', label: 'Pause before typing', min: 0, max: 3, step: 0.05, unit: 's' },
  { key: 'userCharacter', label: 'Username: each character', min: 0.01, max: 0.3, step: 0.005, unit: 's' },
  { key: 'fieldGap', label: 'Pause between the fields', min: 0, max: 2, step: 0.02, unit: 's' },
  { key: 'passwordCharacter', label: 'Password: each character', min: 0.01, max: 0.3, step: 0.005, unit: 's' },
  { key: 'credentialsHold', label: 'Credentials accepted: pause', min: 0, max: 3, step: 0.05, unit: 's' },
  { key: 'badgeEnter', label: 'Badge drops in on its lanyard', min: 0.2, max: 3, step: 0.02, unit: 's' },
  { key: 'badgeInsert', label: 'Badge slides into the reader', min: 0.1, max: 2, step: 0.02, unit: 's' },
  { key: 'badgeRead', label: 'Reader reads the badge', min: 0.2, max: 4, step: 0.05, unit: 's' },
  { key: 'badgeEject', label: 'Badge pushed back out', min: 0.1, max: 2, step: 0.02, unit: 's' },
  { key: 'scannerRise', label: 'Retina scanner rises (with the badge pushed out)', min: 0.1, max: 3, step: 0.02, unit: 's' },
  { key: 'lensOpen', label: 'Lens shutters open', min: 0.1, max: 3, step: 0.02, unit: 's' },
  { key: 'scanPass', label: 'Scan: each beam sweep', min: 0.2, max: 3, step: 0.05, unit: 's' },
  { key: 'scanPasses', label: 'Scan: number of sweeps', min: 1, max: 8, step: 1 },
  { key: 'verifiedHold', label: 'Badge stamped: pause', min: 0, max: 3, step: 0.05, unit: 's' },
  { key: 'grantedHold', label: 'Access granted: pause', min: 0, max: 5, step: 0.05, unit: 's' },
  { key: 'exit', label: 'Badge, reader and scanner leave', min: 0.1, max: 2, step: 0.02, unit: 's' },
  { key: 'windowOpen', label: 'Window opens on the main screen', min: 0.3, max: 5, step: 0.1, unit: 's' },
  { key: 'windowClose', label: 'Log Out: window closes', min: 0.3, max: 5, step: 0.1, unit: 's' }
];

let draft = structuredClone(DEFAULT_CONFIG);
let sounds = [];
let saveTimer = 0;
let saving = false;
let savePromise = null;
let draftRevision = -1;   // the saved revision the draft was last in step with
// The saved settings changed under this page's edits. Nothing more is sent until one copy is chosen.
let conflicted = false;
let buttonGroup = BUTTON_GROUPS[0].key;   // the Buttons submenu on show

const $ = selector => document.querySelector(selector);
const escapeHtml = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

function getPath(object, path) { return path.split('.').reduce((node, key) => node?.[key], object); }
function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((node, key) => node[key], object)[last] = value;
}

/* ---------- saving ---------- */
function setStatus(text, state) {
  const status = $('#saveStatus');
  status.textContent = text;
  status.dataset.state = state;
}

function showConflict(on) {
  conflicted = on;
  $('#saveConflict').hidden = !on;
  if (on) setStatus('Changed on another page — nothing was overwritten', 'error');
}

function persistConfig(config, { overwrite = false } = {}) {
  // Keep saves in order. A slider edit may schedule another save while the previous
  // request is still in flight, and a loaded file must always be written last.
  const previous = savePromise;
  const request = (previous ? previous.catch(() => {}) : Promise.resolve())
    .then(() => saveConfig(config, { expectedRevision: draftRevision, overwrite }))
    .then(saved => { draftRevision = saved; });
  savePromise = request;
  saving = true;
  return request.finally(() => {
    if (savePromise === request) {
      savePromise = null;
      saving = false;
    }
  });
}

function scheduleSave() {
  setLocalConfig(draft);
  if (conflicted) return;   // edits stay on this page until a copy is chosen
  setStatus('Saving…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    try {
      await persistConfig(structuredClone(draft));
      if (!savePromise) setStatus('Saved', 'saved');
    } catch (error) {
      console.error(error);
      if (error.name === 'SaveConflictError') showConflict(true);
      else if (!savePromise && !conflicted) setStatus('Not saved — is the server running?', 'error');
    }
  }, 350);
}

/** Settle a conflict: take the saved settings, or replace them with the ones on this page. */
async function resolveConflict(keepMine) {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (savePromise) await savePromise.catch(() => {});
  try {
    if (keepMine) {
      setStatus('Saving…', 'saving');
      await persistConfig(structuredClone(draft), { overwrite: true });
    } else {
      draft = structuredClone(await reloadConfig());
      draftRevision = getConfigRevision();
      renderAll();
    }
    showConflict(false);
    setStatus('Saved', 'saved');
  } catch (error) {
    console.error(error);
    setStatus('Could not reach the tracker server — nothing was overwritten', 'error');
  }
}

/* ---------- portable settings file ---------- */
async function saveSettingsToFile() {
  const payload = {
    format: SETTINGS_FILE_FORMAT,
    version: SETTINGS_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    config: structuredClone(draft)
  };
  const contents = JSON.stringify(payload, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `triangle-agency-settings-${stamp}.json`;

  // Chromium-based browsers can save straight into a synced Drive folder. Other
  // browsers fall back to a normal JSON download.
  if ('showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON settings file', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
      setStatus(`Saved ${handle.name}`, 'saved');
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      throw error;
    }
  }

  const blob = new Blob([contents], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
  setStatus('Settings file downloaded', 'saved');
}

function configFromSettingsFile(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('That JSON file does not contain settings.');
  }
  // A tracker file holds the team too; its settings are the part loaded here.
  if (payload.format === TRACKER_FILE_FORMAT) {
    if (!payload.settings || typeof payload.settings !== 'object' || Array.isArray(payload.settings)) {
      throw new Error('That tracker file holds no settings.');
    }
    payload = { config: payload.settings.config };
  }
  if (payload.format && payload.format !== SETTINGS_FILE_FORMAT) {
    throw new Error('That JSON file belongs to a different application.');
  }
  if (payload.version && payload.version > SETTINGS_FILE_VERSION) {
    throw new Error('This settings file was made by a newer tracker version.');
  }

  // Accept both files exported here and the server's earlier tracker_config.json.
  const candidate = payload.config && typeof payload.config === 'object' && !Array.isArray(payload.config)
    ? payload.config
    : payload;
  const knownSections = Object.keys(DEFAULT_CONFIG);
  if (!knownSections.some(key => Object.hasOwn(candidate, key))) {
    throw new Error('That JSON file has no recognised tracker settings.');
  }
  return mergeConfig(DEFAULT_CONFIG, candidate);
}

async function loadSettingsFromFile(file) {
  if (!file) return;
  if (file.size > MAX_SETTINGS_FILE_BYTES) {
    throw new Error('That settings file is too large.');
  }

  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const imported = configFromSettingsFile(payload);
  if (!confirm(`Load settings from ${file.name}? This replaces the current settings.`)) return;

  clearTimeout(saveTimer);
  saveTimer = 0;
  if (savePromise) await savePromise.catch(() => {});
  setStatus('Loading settings file…', 'saving');
  // Replacing the saved settings is what was just confirmed, whatever they have become.
  await persistConfig(imported, { overwrite: true });
  draft = structuredClone(imported);
  showConflict(false);
  renderAll();
  setStatus('Settings file loaded', 'saved');
}

/* ---------- source pickers ---------- */
function sourceOptions(selected, { defaultLabel, includeNone = true, competencyFirst = false, buttonsFirst = false } = {}) {
  const option = (value, label) =>
    `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  let html = '';
  if (defaultLabel) html += option('', defaultLabel);
  if (includeNone) html += option('none', 'None (silent)');
  const fileOption = s => option(`file:${s.file}`, s.file);
  // Competency cues list audio/Competencies first; other slots keep one file list.
  const folderFiles = competencyFirst ? sounds.filter(s => isCompetencyFolderFile(s.file)) : [];
  if (competencyFirst) {
    html += `<optgroup label="audio/Competencies">${folderFiles.map(fileOption).join('')}</optgroup>`;
  }
  // Button slots list the short button voices first.
  const synthGroup = (label, list) =>
    `<optgroup label="${label}">${list.map(s => option(`synth:${s.id}`, s.label)).join('')}</optgroup>`;
  const buttonVoices = synthGroup('Built-in: buttons', SYNTHS.filter(s => s.button));
  const effectVoices = synthGroup('Built-in: effects', SYNTHS.filter(s => !s.button));
  html += buttonsFirst ? buttonVoices + effectVoices : effectVoices + buttonVoices;
  const files = sounds.filter(s => !folderFiles.includes(s)).map(fileOption);
  // Keep a saved file visible even if it has since been removed from disk.
  if (selected?.startsWith('file:') && !sounds.some(s => `file:${s.file}` === selected)) {
    files.push(option(selected, `${selected.slice(5)} (missing)`));
  }
  html += `<optgroup label="${competencyFirst ? 'Other files' : 'Files'}">${files.join('')}</optgroup>`;
  return html;
}

function volumeControl(path, value) {
  return `<label class="volume" title="Volume">
    <span aria-hidden="true">&#128266;</span>
    <input type="range" min="0" max="1" step="0.05" value="${value}" data-path="${path}" data-kind="number" aria-label="Volume">
    <output data-out="${path}">${Math.round(value * 100)}%</output>
  </label>`;
}

/* ---------- renderers ---------- */
function renderMaster() {
  $('#masterVolume').innerHTML = volumeControl('sounds.masterVolume', draft.sounds.masterVolume);
}

function renderKeepAlive() {
  $('#keepAlive').innerHTML = KEEP_ALIVE_FIELDS.map(field => renderField(`sounds.keepAlive.${field.key}`, field)).join('');
}

function renderButtonVolume() {
  $('#buttonVolume').innerHTML = volumeControl('sounds.buttonVolume', draft.sounds.buttonVolume);
}

/** The Buttons submenu (one entry per viewer tab) and the sound slots of the group on show. */
function renderButtons() {
  const group = BUTTON_GROUPS.find(g => g.key === buttonGroup) || BUTTON_GROUPS[0];
  buttonGroup = group.key;

  $('#buttonGroupTabs').innerHTML = BUTTON_GROUPS.map(g => `<button type="button" role="tab"
    class="subtab${g === group ? ' is-active' : ''}" aria-selected="${g === group}" data-button-group="${g.key}">${escapeHtml(g.label)}</button>`).join('');
  $('#buttonGroupTitle').textContent = group.label;
  $('#buttonGroupHint').textContent = group.hint || '';
  $('#buttonGroupHint').hidden = !group.hint;

  $('#buttonSlots').innerHTML = group.buttons.map(({ key, label, hint }) => {
    const path = `sounds.buttons.${group.key}.${key}`;
    const slot = draft.sounds.buttons[group.key][key];
    return `<div class="slot button-slot">
      <div class="slot-name"><strong>${escapeHtml(label)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>
      <select data-path="${path}.source" aria-label="${escapeHtml(label)} sound">${sourceOptions(slot.source, { buttonsFirst: true })}</select>
      ${volumeControl(`${path}.volume`, slot.volume)}
      <button type="button" class="play" data-test-button="${group.key}.${key}" aria-label="Play ${escapeHtml(label)}">&#9654;</button>
    </div>`;
  }).join('');
}

function showButtonGroup(key) {
  buttonGroup = key;
  try { localStorage.setItem(BUTTON_GROUP_KEY, key); } catch { /* ignore */ }
  renderButtons();
}

function renderEvents() {
  $('#eventSlots').innerHTML = SOUND_EVENTS.map(({ key, label, hint }) => {
    const path = `sounds.events.${key}`;
    const slot = draft.sounds.events[key];
    return `<div class="slot">
      <div class="slot-name"><strong>${escapeHtml(label)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>
      <select data-path="${path}.source" aria-label="${escapeHtml(label)} sound">${sourceOptions(slot.source)}</select>
      <label class="then"><span>then</span><select data-path="${path}.next" aria-label="${escapeHtml(label)} follow-up sound">
        ${sourceOptions(slot.next || '', { defaultLabel: '—', includeNone: false })}
      </select></label>
      ${volumeControl(`${path}.volume`, slot.volume)}
      <button type="button" class="play" data-test-event="${key}" aria-label="Play ${escapeHtml(label)}">&#9654;</button>
    </div>`;
  }).join('');
}

function renderCompetencies() {
  const cue = (name, kind, label, fallback) => {
    const path = escapeHtml(`sounds.competencies.${name}.${kind}`);
    const slot = draft.sounds.competencies[name][kind];
    const matched = competencyFile(name, kind, sounds.map(s => s.file));
    const defaultLabel = `Default (${matched ? matched.split('/').pop().replace(/\.[^.]+$/, '') : fallback})`;
    return `<div class="cue ${kind}">
      <span class="cue-label">${label}</span>
      <select data-path="${path}.source" aria-label="${escapeHtml(name)} ${label}">${sourceOptions(slot.source, { defaultLabel, competencyFirst: true })}</select>
      ${volumeControl(`${path}.volume`, slot.volume)}
      <button type="button" class="play" data-test-cue="${kind}" data-competency="${escapeHtml(name)}" aria-label="Play ${escapeHtml(name)} ${label}">&#9654;</button>
    </div>`;
  };
  $('#competencySlots').innerHTML = COMPETENCIES.map(name => `
    <div class="competency">
      <h3>${escapeHtml(name)} <small>${escapeHtml(COMPETENCY_INFO[name]?.department || '')} · ${escapeHtml(COMPETENCY_INFO[name]?.prime.title || '')}</small></h3>
      ${cue(name, 'prime', 'Prime Directive', 'demerit')}
      ${cue(name, 'encouraged', 'Encouraged Behavior', 'merit')}
    </div>`).join('');
}

function renderLibrary() {
  const library = $('#library');
  if (!sounds.length) {
    library.innerHTML = '<p class="empty">No sound files yet. Upload some to get started.</p>';
    return;
  }
  library.innerHTML = sounds.map(sound => `
    <div class="library-item">
      <button type="button" class="play small" data-play-file="${escapeHtml(sound.file)}" aria-label="Play ${escapeHtml(sound.file)}">&#9654;</button>
      <span>${escapeHtml(sound.file)}</span>
    </div>`).join('');
}

function formatValue(field, value) {
  if (field.zeroLabel && Number(value) === 0) return field.zeroLabel;
  if (field.percent) return `${(value * 100).toFixed(field.decimals || 0)}%`;
  const rounded = Number.isInteger(field.step) ? value : Number(value).toFixed(String(field.step).split('.')[1]?.length || 0);
  return `${rounded}${field.unit ? ` ${field.unit}` : ''}`;
}

/** One slider, toggle, dropdown or trigger row bound to `path` in the draft. */
function renderField(path, field) {
  const value = getPath(draft, path);
  if (field.type === 'trigger') {
    // A button for something that happens once: pressing it saves the moment it was pressed.
    return `<div class="field"><span>${field.label}</span>
      <button type="button" class="secondary" data-trigger="${path}">${field.action}</button></div>`;
  }
  if (field.type === 'text') {
    return `<label class="field"><span>${field.label}</span>
      <input type="text" value="${escapeHtml(value ?? '')}" data-path="${path}" spellcheck="false"></label>`;
  }
  if (field.type === 'actions') {
    // Buttons that ask the server to do something now; pressing them saves nothing.
    const group = path.split('.')[1];
    return `<div class="field"><span>${field.label}</span><span class="field-actions">${field.actions
      .map(action => `<button type="button" class="secondary" data-server-action="${group}.${action.key}">${action.label}</button>`).join('')}</span></div>`;
  }
  if (field.type === 'toggle') {
    return `<label class="field toggle"><span>${field.label}</span>
      <input type="checkbox" data-path="${path}" data-kind="boolean"${value ? ' checked' : ''}><i aria-hidden="true"></i></label>`;
  }
  if (field.type === 'select') {
    // Options are plain values, or { key, label } where the value differs from the label.
    const options = field.options.map(o => typeof o === 'string' ? { key: o, label: o[0].toUpperCase() + o.slice(1) } : o);
    return `<label class="field"><span>${field.label}</span>
      <select data-path="${path}">${options.map(o => `<option value="${o.key}"${o.key === value ? ' selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}</select></label>`;
  }
  return `<label class="field"><span>${field.label}</span>
    <input type="range" min="${field.min}" max="${field.max}" step="${field.step}" value="${value}" data-path="${path}" data-kind="number">
    <output data-out="${path}">${formatValue(field, value)}</output></label>`;
}

/** The sound slot of an effect group that has one (`sound` in EFFECT_GROUPS). */
function renderEffectSound(group) {
  const path = `effects.${group.key}.sound`;
  const slot = draft.effects[group.key].sound;
  const { label, hint } = group.sound;
  return `<div class="slot button-slot">
    <div class="slot-name"><strong>${escapeHtml(label)}</strong><small>${escapeHtml(hint)}</small></div>
    <select data-path="${path}.source" aria-label="${escapeHtml(label)}">${sourceOptions(slot.source)}</select>
    ${volumeControl(`${path}.volume`, slot.volume)}
    <button type="button" class="play" data-test-slot="${path}" aria-label="Play ${escapeHtml(label)}">&#9654;</button>
  </div>`;
}

/** The mission whose cards are out: the one picked, unless another one is switched on (then that one). */
function currentMission() {
  const on = MISSIONS.filter(mission => getPath(draft, mission.switch) === true);
  const picked = MISSIONS.find(mission => mission.key === draft.effects.mission);
  if (picked && (!on.length || on.includes(picked))) return picked.key;
  return on[0]?.key || 'none';
}

function renderEffects() {
  const mission = currentMission();
  draft.effects.mission = mission;
  const choices = [{ key: 'none', label: 'None' }, ...MISSIONS]
    .map(choice => `<option value="${choice.key}"${choice.key === mission ? ' selected' : ''}>${escapeHtml(choice.label)}</option>`).join('');
  const picker = `<div class="card effect-card mission-card">
      <div class="section-heading"><div><span class="eyebrow">ONE AT A TIME</span><h2>Mission effect</h2></div></div>
      <p class="hint">Effects made for a single mission. Pick one to bring out its settings; the others are put away and switched off. Picking one does not start it: the switch on its own card does.</p>
      <div class="fields"><label class="field"><span>Mission</span><select data-path="effects.mission">${choices}</select></label></div>
    </div>`;

  $('#effectGroups').innerHTML = picker + EFFECT_GROUPS.filter(group => !group.mission || group.mission === mission).map(group => {
    const rows = group.fields.map(field => renderField(`effects.${group.key}.${field.key}`, field)).join('');
    return `<div class="card effect-card">
      <div class="section-heading">
        <div><span class="eyebrow">${group.eyebrow}</span><h2>${group.title}</h2></div>
        <button type="button" class="secondary small" data-reset-group="${group.key}">Reset</button>
      </div>
      <p class="hint">${group.hint}</p>
      <div class="fields">${rows}</div>
      ${group.sound ? renderEffectSound(group) : ''}
    </div>`;
  }).join('');
}

/* ---------- lights ---------- */
const usesBulbs = () => draft.lights.target !== 'strip';
const usesStrip = () => ['all', 'strip'].includes(draft.lights.target);

/**
 * The hue the LED strip shows for a cue, or null when the cue leaves it alone. The strip
 * is not a bulb: it has no white and always runs at full saturation and brightness
 * (lights.py), so a Colour cue shows its own hue and White or a bulb effect the LED colour.
 */
function stripHue(cue, path) {
  if (!usesStrip() || BULB_ONLY_CUES.has(path)) return null;
  if (cue.action === 'color') return cue.hue;
  if (cue.action === 'white' || (cue.action === 'effect' && !cue.effect.startsWith('strip:'))) return cue.led;
  return null;
}

/** Roughly what the cue looks like, for the round swatch beside it; a ring is the LED strip. */
function swatchStyle(cue, path) {
  const led = stripHue(cue, path);
  const ledColor = led === null ? '' : `hsl(${led} 100% 50%)`;
  const level = 25 + cue.brightness * 0.3;
  let fill = '';
  if (!usesBulbs()) fill = ledColor || (cue.action === 'effect' ? 'conic-gradient(#f33, #fd0, #3c6, #39f, #c3f, #f33)' : '');
  else if (cue.action === 'color') fill = `hsl(${cue.hue} ${cue.saturation}% ${level}%)`;
  else if (cue.action === 'white') {
    const t = (cue.temperature - 2500) / 4000;   // warm amber to cool blue-white
    fill = `hsl(${35 + t * 185} ${90 - t * 50}% ${level + 15}%)`;
  } else if (cue.action === 'effect') fill = 'conic-gradient(#f33, #fd0, #3c6, #39f, #c3f, #f33)';
  if (!fill) return '';
  return `background: ${fill}${ledColor && usesBulbs() ? `; box-shadow: 0 0 0 3px ${ledColor}` : ''}`;
}

function lightFieldKeys(cue, { hold, path }) {
  const keys = usesBulbs() ? [...LIGHT_ACTION_FIELDS[cue.action]] : cue.action === 'color' ? ['hue'] : [];
  if (stripHue(cue, path) !== null && cue.action !== 'color') keys.push('led');
  if (hold && cue.action !== 'none') keys.push('seconds');
  return keys;
}

function effectOptions(selected) {
  const groups = [...new Set(LIGHT_EFFECTS.map(effect => effect.group))];
  return groups.map(group => `<optgroup label="${group}">${LIGHT_EFFECTS.filter(effect => effect.group === group)
    .map(effect => `<option value="${effect.key}"${effect.key === selected ? ' selected' : ''}>${escapeHtml(effect.label)}</option>`).join('')}</optgroup>`).join('');
}

/**
 * One cue editor: the action, its sliders, a swatch and (for events) a test button.
 * `only` limits the actions on offer; `scene` makes the test button run that scene.
 */
function lightCueRow(path, cue, { label, hint, hold = true, test = true, only, scene }) {
  const actions = LIGHT_ACTIONS.filter(action => !only || only.includes(action.key)).map(action =>
    `<option value="${action.key}"${action.key === cue.action ? ' selected' : ''}>${action.label}</option>`).join('');
  const fields = lightFieldKeys(cue, { hold, path }).map(key => renderField(`${path}.${key}`, LIGHT_FIELDS[key])).join('');
  const tested = scene ? `data-test-scene="${scene}"` : `data-test-light="${path.replace('lights.', '')}"`;
  const effect = cue.action === 'effect'
    ? `<label class="field"><span>Effect</span><select data-path="${path}.effect">${effectOptions(cue.effect)}</select></label>` : '';
  return `<div class="light-slot">
    ${label ? `<div class="slot-name"><strong>${escapeHtml(label)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>` : ''}
    <select data-path="${path}.action" aria-label="${escapeHtml(label || 'Ambient')} light">${actions}</select>
    <span class="light-swatch" data-swatch="${path}" style="${swatchStyle(cue, path)}" aria-hidden="true"></span>
    ${test ? `<button type="button" class="play" ${tested} aria-label="Try the ${escapeHtml(label)} light">&#9654;</button>` : ''}
    <div class="light-fields">${effect}${fields}</div>
  </div>`;
}

function renderLights() {
  const outcomeEvents = new Set(['captured', 'killed', 'escaped']);
  $('#lightGeneral').innerHTML = LIGHT_GENERAL_FIELDS.map(field => renderField(`lights.${field.key}`, field)).join('');
  $('#lightAmbient').innerHTML = lightCueRow('lights.ambient', draft.lights.ambient, { hold: false, test: false });
  $('#sessionLightSlots').innerHTML = SESSION_LIGHTS.map(({ key, label, hint, actions, scene }) =>
    lightCueRow(`lights.session.${key}`, draft.lights.session[key], { label, hint, hold: false, only: actions, scene })).join('');
  $('#sessionLightFields').innerHTML = ['blackout', 'fade'].map(key => renderField(`lights.session.${key}`, LIGHT_FIELDS[key])).join('');
  $('#missionOutcomeLightSlots').innerHTML = LIGHT_EVENTS.filter(({ key }) => outcomeEvents.has(key)).map(({ key, label, hint }) =>
    lightCueRow(`lights.events.${key}`, draft.lights.events[key], { label, hint })).join('');
  $('#lightSlots').innerHTML = LIGHT_EVENTS.filter(({ key }) => !outcomeEvents.has(key)).map(({ key, label, hint }) =>
    lightCueRow(`lights.events.${key}`, draft.lights.events[key], { label, hint })).join('');
}

let lightStatusTimer = 0;

/** Apply the configured address; a loopback target lives on the tracker, not this browser. */
function setLightRPGLink(rawUrl, local) {
  const link = $('#openLightRPG');
  try {
    const url = new URL(rawUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported protocol');
    if (local) url.hostname = location.hostname;
    link.href = url.href;
    link.hidden = false;
    return url.host;
  } catch {
    link.removeAttribute('href');
    link.hidden = true;
    return 'the configured address';
  }
}

async function refreshLightStatus() {
  const status = $('#lightStatus');
  try {
    const data = await (await fetch('/api/lights/status', { cache: 'no-store' })).json();
    const address = setLightRPGLink(data.url, data.local);
    const bulbs = Object.values(data.bulbs || {}).filter(Boolean).length;
    if (data.reachable) {
      const parts = [`${bulbs} bulb${bulbs === 1 ? '' : 's'}`, data.strip ? 'LED strip' : 'no strip'];
      status.textContent = data.lastError ? `Last cue failed: ${data.lastError}` : `Connected to ${address} · ${parts.join(' · ')}`;
      status.dataset.state = data.lastError ? 'error' : 'saved';
    } else {
      status.textContent = !data.local
        ? `LightRPG is not reachable at ${address}`
        : !data.installed
          ? 'LightRPG folder not found'
          : data.starting ? 'LightRPG is starting…' : 'LightRPG is not running';
      status.dataset.state = data.starting ? 'saving' : 'error';
    }
    $('#startLightRPG').hidden = data.reachable || !data.startable;
  } catch {
    status.textContent = 'Tracker server not reachable';
    status.dataset.state = 'error';
  }
}

/** Poll LightRPG only while the Lights tab is on show. */
function watchLightStatus(active) {
  clearInterval(lightStatusTimer);
  lightStatusTimer = 0;
  if (!active) return;
  refreshLightStatus();
  lightStatusTimer = setInterval(refreshLightStatus, 4000);
}

async function testLight(button) {
  const key = button.dataset.testLight;
  // 'ambient' or 'events.<event>'; the ambient light has no hold, so it just stays.
  const cue = key === 'ambient' ? { ...draft.lights.ambient, seconds: 0 } : key && getPath(draft.lights, key);
  button.classList.add('playing');
  // A session light's button runs its whole scene (lights.py).
  const result = await (cue ? sendLightCue(cue, draft.lights) : sendLightScene(button.dataset.testScene, draft.lights));
  if (!result.ok) setStatus(result.message || 'Light cue failed', 'error');
  // The server queues the cue; give the bulbs a moment, then show how it went.
  setTimeout(() => { button.classList.remove('playing'); refreshLightStatus(); }, 1500);
}

/* ---------- login ---------- */
function renderLogin() {
  const picture = draft.login.badgePicture;
  $('#badgePreview').innerHTML = picture
    ? `<img src="/${escapeHtml(picture)}" alt="Manager badge picture">`
    : '<span>No picture: the badge shows a silhouette</span>';
  $('#badgeRemove').hidden = !picture;
  $('#loginTiming').innerHTML = LOGIN_TIMING_FIELDS.map(field => renderField(`login.timing.${field.key}`, field)).join('');
}

async function uploadBadgePicture(file) {
  if (!file) return;
  setStatus('Uploading picture…', 'saving');
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await fetch('/api/badge', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message);
    draft.login.badgePicture = data.file;
    renderLogin();
    scheduleSave();
  } catch (error) {
    console.error('Badge picture upload failed', error);
    setStatus(error.message || 'Upload failed', 'error');
  }
}

function renderAll() {
  renderMaster();
  renderKeepAlive();
  renderEvents();
  renderButtonVolume();
  renderButtons();
  renderCompetencies();
  renderLibrary();
  renderEffects();
  renderLights();
  renderLogin();
}

/* ---------- editing ---------- */
/** The slider definition behind an effects or keep-alive path; volumes have none. */
function fieldFor(path) {
  if (path.startsWith('sounds.keepAlive.')) return KEEP_ALIVE_FIELDS.find(f => path === `sounds.keepAlive.${f.key}`);
  if (path.startsWith('lights.')) return LIGHT_FIELDS[path.split('.').pop()] || null;
  if (path.startsWith('login.timing.')) return LOGIN_TIMING_FIELDS.find(f => path === `login.timing.${f.key}`);
  if (!path.startsWith('effects.')) return null;
  const [, groupKey, fieldKey] = path.split('.');
  return EFFECT_GROUPS.find(g => g.key === groupKey)?.fields.find(f => f.key === fieldKey);
}

function handleEdit(event) {
  const input = event.target.closest('[data-path]');
  if (!input) return;
  // Sliders save on 'input' (live); selects and toggles on 'change' only.
  const discrete = input.matches('select, input[type=checkbox]');
  if (discrete !== (event.type === 'change')) return;
  const path = input.dataset.path;
  let value = input.value;
  if (input.dataset.kind === 'number') value = Number(value);
  if (input.dataset.kind === 'boolean') value = input.checked;
  setPath(draft, path, value);

  const output = document.querySelector(`output[data-out="${path}"]`);
  if (output) output.textContent = formatValue(fieldFor(path) || { percent: true }, value);
  if (path === 'effects.mission') {
    // The missions put away are switched off, so nothing runs out of sight.
    MISSIONS.filter(mission => mission.key !== value).forEach(mission => setPath(draft, mission.switch, false));
    renderEffects();
  }
  if (path.startsWith('lights.')) {
    // A new action, effect or target shows different sliders; other edits only recolour the swatch.
    if (/\.(action|effect)$/.test(path) || path === 'lights.target') renderLights();
    const cuePath = path.slice(0, path.lastIndexOf('.'));
    const swatch = document.querySelector(`[data-swatch="${cuePath}"]`);
    if (swatch) swatch.style.cssText = swatchStyle(getPath(draft, cuePath), cuePath);
  }
  scheduleSave();
}

async function playFor(button) {
  if (button.dataset.testLight || button.dataset.testScene) return testLight(button);
  button.classList.add('playing');
  try {
    if (button.dataset.testSlot) {
      await playSlot(getPath(draft, button.dataset.testSlot));
    } else if (button.dataset.testEvent) {
      await playSlot(draft.sounds.events[button.dataset.testEvent]);
    } else if (button.dataset.testButton) {
      const [group, key] = button.dataset.testButton.split('.');
      await playSlot(draft.sounds.buttons[group][key], { gain: draft.sounds.buttonVolume });
    } else if (button.dataset.testCue) {
      await playSlot(resolveSlot(button.dataset.testCue, { competency: button.dataset.competency }));
    } else if (button.dataset.playFile) {
      await playSlot({ source: `file:${button.dataset.playFile}`, volume: 1 });
    }
  } finally {
    button.classList.remove('playing');
  }
}

/* ---------- sound library ---------- */
async function loadSounds() {
  try {
    const response = await fetch('/api/sounds', { cache: 'no-store' });
    sounds = (await response.json()).sounds || [];
  } catch {
    sounds = [];
  }
}

async function uploadFiles(files, folder = 'uploads') {
  const list = [...files].filter(Boolean);
  if (!list.length) return;
  setStatus(`Uploading ${list.length} file${list.length > 1 ? 's' : ''}…`, 'saving');
  let failed = 0;
  for (const file of list) {
    const form = new FormData();
    form.append('file', file);
    form.append('folder', folder);
    try {
      const response = await fetch('/api/sounds', { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message);
      sounds = data.sounds;
      setSoundFiles(sounds);
    } catch (error) {
      failed++;
      console.error('Upload failed', file.name, error);
    }
  }
  renderAll();
  setStatus(failed ? `${failed} upload${failed > 1 ? 's' : ''} failed` : 'Uploaded', failed ? 'error' : 'saved');
}

/* ---------- tabs ---------- */
function showTab(name) {
  const tabs = [...document.querySelectorAll('[data-tab]')];
  if (!tabs.some(tab => tab.dataset.tab === name)) name = 'sounds';
  tabs.forEach(tab => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelectorAll('[data-tab-panel]').forEach(panel => { panel.hidden = panel.dataset.tabPanel !== name; });
  watchLightStatus(name === 'lights');
  try { localStorage.setItem(TAB_KEY, name); } catch { /* ignore */ }
}

/* ---------- init ---------- */
async function init() {
  let tab = 'sounds';
  try {
    tab = localStorage.getItem(TAB_KEY) || tab;
    buttonGroup = localStorage.getItem(BUTTON_GROUP_KEY) || buttonGroup;
  } catch { /* ignore */ }
  showTab(tab);

  await Promise.all([startConfigSync({ pollMs: 4000 }), loadSounds()]);
  draft = structuredClone(getConfig());
  renderAll();
  setStatus('Saved', 'saved');

  // Adopt changes saved from another device, unless this page has edits in flight. Those are
  // then built on settings that have moved on, which their save reports as a conflict.
  onConfigChange(config => {
    if (saveTimer || saving || conflicted) return;
    draftRevision = getConfigRevision();
    if (JSON.stringify(config) === JSON.stringify(draft)) return;
    draft = structuredClone(config);
    renderAll();
  });

  $('#loadSavedSettings').addEventListener('click', () => resolveConflict(false));
  $('#keepMySettings').addEventListener('click', () => resolveConflict(true));

  document.addEventListener('input', handleEdit);
  document.addEventListener('change', handleEdit);

  document.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) showTab(tabButton.dataset.tab);

    const groupButton = event.target.closest('[data-button-group]');
    if (groupButton) showButtonGroup(groupButton.dataset.buttonGroup);

    const play = event.target.closest('.play');
    if (play) playFor(play);

    const action = event.target.closest('[data-server-action]');
    if (action) {
      const [group, key] = action.dataset.serverAction.split('.');
      if (group === 'voicemeeter') {
        setVoiceMeeterLevel(key, draft.effects.voicemeeter)
          .then(data => setStatus(data.message, 'saved'))
          .catch(error => setStatus(error.message || 'VoiceMeeter bridge is not running on this laptop', 'error'));
      } else {
        // Other one-shot actions belong to the tracker server.
        fetch('/api/' + group, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...draft.effects[group], action: key })
        })
          .then(async response => {
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || 'Command failed');
            setStatus(data.message, 'saved');
          })
          .catch(() => setStatus('Could not reach the tracker server', 'error'));
      }
    }

    const trigger = event.target.closest('[data-trigger]');
    if (trigger) {
      setPath(draft, trigger.dataset.trigger, Date.now());
      scheduleSave();
    }

    const reset = event.target.closest('[data-reset-group]');
    if (reset) {
      const key = reset.dataset.resetGroup;
      draft.effects[key] = structuredClone(DEFAULT_CONFIG.effects[key]);
      renderEffects();
      scheduleSave();
    }
  });

  $('#resetButtonGroup').addEventListener('click', () => {
    draft.sounds.buttons[buttonGroup] = structuredClone(DEFAULT_CONFIG.sounds.buttons[buttonGroup]);
    renderButtons();
    scheduleSave();
  });

  $('#resetLights').addEventListener('click', () => {
    draft.lights.events = structuredClone(DEFAULT_CONFIG.lights.events);
    renderLights();
    scheduleSave();
  });

  $('#startLightRPG').addEventListener('click', async () => {
    try {
      const data = await (await fetch('/api/lights/start', { method: 'POST' })).json();
      setStatus(data.message, data.ok ? 'saved' : 'error');
    } catch {
      setStatus('Could not reach the tracker server', 'error');
    }
    refreshLightStatus();
  });

  $('#competencyUpload').addEventListener('change', event => {
    uploadFiles(event.target.files, 'Competencies');
    event.target.value = '';
  });
  $('#uploadInput').addEventListener('change', event => {
    uploadFiles(event.target.files);
    event.target.value = '';
  });
  const library = $('#library').closest('.card');
  library.addEventListener('dragover', event => { event.preventDefault(); library.classList.add('drop-target'); });
  library.addEventListener('dragleave', () => library.classList.remove('drop-target'));
  library.addEventListener('drop', event => {
    event.preventDefault();
    library.classList.remove('drop-target');
    uploadFiles(event.dataTransfer.files);
  });

  $('#badgeUpload').addEventListener('change', event => {
    uploadBadgePicture(event.target.files[0]);
    event.target.value = '';
  });
  $('#badgeRemove').addEventListener('click', () => {
    draft.login.badgePicture = '';
    renderLogin();
    scheduleSave();
  });
  const badgeCard = $('#badgePreview').closest('.card');
  badgeCard.addEventListener('dragover', event => { event.preventDefault(); badgeCard.classList.add('drop-target'); });
  badgeCard.addEventListener('dragleave', () => badgeCard.classList.remove('drop-target'));
  badgeCard.addEventListener('drop', event => {
    event.preventDefault();
    badgeCard.classList.remove('drop-target');
    uploadBadgePicture(event.dataTransfer.files[0]);
  });
  $('#resetLoginTiming').addEventListener('click', () => {
    draft.login.timing = structuredClone(DEFAULT_CONFIG.login.timing);
    renderLogin();
    scheduleSave();
  });

  $('#saveSettingsFile').addEventListener('click', async () => {
    try {
      await saveSettingsToFile();
    } catch (error) {
      console.error('Settings file could not be saved', error);
      setStatus(error.message || 'Settings file could not be saved', 'error');
    }
  });
  $('#loadSettingsButton').addEventListener('click', () => $('#loadSettingsFile').click());
  $('#loadSettingsFile').addEventListener('change', async event => {
    const input = event.target;
    try {
      await loadSettingsFromFile(input.files[0]);
    } catch (error) {
      console.error('Settings file could not be loaded', error);
      setStatus(error.message || 'Settings file could not be loaded', 'error');
    } finally {
      input.value = '';
    }
  });

  $('#resetAll').addEventListener('click', () => {
    if (!confirm('Reset every sound assignment and effect setting to the defaults?')) return;
    draft = structuredClone(DEFAULT_CONFIG);
    renderAll();
    scheduleSave();
  });
}

// Say so instead of sitting on "Loading…" forever.
init().catch(error => {
  console.error('Settings failed to load', error);
  setStatus('Could not load. Restart the tracker server, then reload this page.', 'error');
});
