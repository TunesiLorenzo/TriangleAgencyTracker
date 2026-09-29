// config.js
// Shared settings for the viewer and the /settings page: defaults, loading from
// the server, saving, and live updates. The server stores only what was saved;
// everything is merged over DEFAULT_CONFIG here, so new options get defaults.
//
// Sound sources are strings:
//   ''            use the fallback (competency slots: their audio/Competencies file, else merit/demerit)
//   'none'        silent
//   'synth:<id>'  a built-in sound generated in the browser (see synth.js)
//   'file:<path>' a file under audio/

export const COMPETENCIES = ['PR', 'R&D', 'Caffetteria', 'CDA', 'Stagisti', 'Smaltimento', 'Reception', 'Centralino', 'Clown'];

export const RISK_LEVELS = ['controlled', 'unstable', 'compromised', 'critical', 'catastrophic'];

const slot = (source, volume = 1, next = '') => ({ source, volume, next });

export const SOUND_EVENTS = [
  { key: 'merit', label: 'Merit', hint: 'Merit triangle clicked or a merit task applied' },
  { key: 'demerit', label: 'Demerit', hint: 'Demerit triangle clicked or a demerit task applied' },
  { key: 'sickLeave', label: 'Sick leave', hint: 'Agent put on sick leave' },
  { key: 'return', label: 'Back from sick leave', hint: 'Agent returns' },
  { key: 'witness', label: 'Witness', hint: 'Local witness added' },
  { key: 'chaos', label: 'Chaos', hint: 'Chaos added' },
  { key: 'globalWitness', label: 'Global witness', hint: 'Global witness added' },
  { key: 'captured', label: 'Anomaly captured', hint: '' },
  { key: 'killed', label: 'Anomaly killed', hint: '' },
  { key: 'escaped', label: 'Anomaly escaped', hint: '' },
  { key: 'counterDown', label: 'Counter decreased', hint: 'Any counter right-clicked down' },
  { key: 'glitch', label: 'Critical glitch', hint: 'Screen-tear burst at high risk' }
];

function competencyDefaults() {
  return Object.fromEntries(COMPETENCIES.map(name => [name, { prime: slot(''), encouraged: slot('') }]));
}

export const DEFAULT_CONFIG = {
  sounds: {
    masterVolume: 0.8,
    events: {
      merit: slot('file:merit_new.mp3'),
      demerit: slot('file:demerit_new.mp3'),
      sickLeave: slot('file:flatline.mp3'),
      return: slot('file:ufo.mp3', 1, 'file:cash.mp3'),
      witness: slot('synth:eye', 0.8),
      chaos: slot('synth:static', 0.7),
      globalWitness: slot('synth:globe', 0.8),
      captured: slot('synth:lock', 0.9),
      killed: slot('synth:thud', 0.9),
      escaped: slot('synth:alarm', 0.7),
      counterDown: slot('synth:tick', 0.5),
      glitch: slot('synth:glitch', 0.35)
    },
    competencies: competencyDefaults()
  },
  effects: {
    atmosphere: {
      maxChaos: 16,        // chaos at which everything is fully intense
      easeSeconds: 0.25,   // how quickly effects follow a chaos change
      grain: 0.55,         // film grain opacity at full intensity
      grainFps: 12,
      vignette: 0.9,       // edge darkening at full intensity
      panelBlur: 8,        // px of background blur behind panels at full intensity
      scanlines: 0.25,     // scanline overlay opacity at full intensity
      crtSpeed: 260        // extra px/s of the sweeping CRT band at full intensity
    },
    shake: {
      enabled: true,
      drift: 1.6,          // px of smooth drift at full intensity
      driftRotation: 0.25, // deg
      burstsPerSecond: 0.9,
      burstSize: 5,        // px
      burstRotation: 0.9   // deg
    },
    witnessHue: {
      maxWitnesses: 20,    // witnesses at which the tint is fully blue
      maxShift: 120,       // deg; 120 turns red into blue via magenta
      settleSeconds: 1,
      overshoot: 14,       // deg past the target on a new witness
      pulse: true
    },
    video: {
      strongAtChaos: 2,    // chaos at which the strong background video takes over
      fadeSeconds: 5
    },
    glitch: {
      enabled: true,
      minRisk: 'critical', // lowest Mission Risk level that glitches
      burstsPerSecond: 0.5,
      rgbSplit: 4,         // px of red/blue color fringe
      titleTear: true
    }
  }
};

/* ---------- merge ---------- */
function isObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }

// Saved values override defaults only where the type matches; unknown keys are dropped.
export function mergeConfig(defaults, saved) {
  if (!isObject(defaults)) {
    return typeof saved === typeof defaults ? saved : defaults;
  }
  const result = {};
  for (const key of Object.keys(defaults)) {
    result[key] = isObject(saved) && key in saved ? mergeConfig(defaults[key], saved[key]) : structuredClone(defaults[key]);
  }
  return result;
}

/* ---------- competency sound files ----------
   audio/Competencies/<Competency>_Bad.* is the Prime Directive sound and
   <Competency>_Good.* the Encouraged Behavior sound (e.g. PR_Bad.wav), used
   whenever a competency slot is left on "Default". */
// File names may use the Italian name or these English/short forms (case-insensitive).
const COMPETENCY_ALIASES = {
  'PR': ['PublicRelations', 'PubblicheRelazioni'],
  'R&D': ['R&S', 'RD', 'RS', 'RnD', 'Research'],
  'Caffetteria': ['Coffee', 'Caffe', 'Caffè', 'Barista', 'Bar'],
  'CDA': ['Board', 'Executive', 'ConsiglioDiAmministrazione'],
  'Stagisti': ['Intern', 'Interns', 'Stagista'],
  'Smaltimento': ['Custodial', 'Disposal', 'Janitor'],
  'Reception': ['Receptionist'],
  'Centralino': ['Hotline', 'Switchboard'],
  'Clown': ['Clowns']
};
const CUE_SUFFIXES = { prime: ['bad', 'prime', 'demerit'], encouraged: ['good', 'encouraged', 'merit'] };
const COMPETENCY_FOLDER = 'competencies/';

let soundFiles = [];
export function getSoundFiles() { return soundFiles; }
export function setSoundFiles(list) { soundFiles = (list || []).map(item => item.file ?? item); }

export function isCompetencyFolderFile(file) { return file.toLowerCase().startsWith(COMPETENCY_FOLDER); }

/** The audio/Competencies file named for this competency and cue, or ''. */
export function competencyFile(competency, kind, files = soundFiles) {
  const normalize = text => String(text).toLowerCase().replace(/\s+/g, '');
  const names = [competency, ...(COMPETENCY_ALIASES[competency] || [])].map(normalize);
  const suffixes = CUE_SUFFIXES[kind] || [];
  return files.find(file => {
    if (!isCompetencyFolderFile(file)) return false;
    const stem = normalize(file.slice(COMPETENCY_FOLDER.length).replace(/\.[^.]+$/, ''));
    const split = stem.lastIndexOf('_');
    return split > 0 && names.includes(stem.slice(0, split)) && suffixes.includes(stem.slice(split + 1));
  }) || '';
}

/* ---------- live state ---------- */
let current = structuredClone(DEFAULT_CONFIG);
let revision = -1;
let serverAvailable = true;
const listeners = new Set();
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('triangle-agency-config') : null;

function apply(savedConfig, newRevision) {
  current = mergeConfig(DEFAULT_CONFIG, savedConfig);
  revision = newRevision;
  listeners.forEach(listener => listener(current));
}

export function getConfig() { return current; }

/** Use settings locally without saving (the settings page previews edits this way). */
export function setLocalConfig(config) {
  current = mergeConfig(DEFAULT_CONFIG, config);
}
export function isServerAvailable() { return serverAvailable; }

/** Call listener now and on every change. Returns an unsubscribe function. */
export function onConfigChange(listener) {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

async function fetchConfig() {
  const response = await fetch('/api/config', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/**
 * Load settings and keep them live: instant updates from a settings tab in the
 * same browser (BroadcastChannel) and polling for changes made on another device.
 * Without the Flask server (e.g. a plain static server) the defaults are used.
 */
export async function startConfigSync({ pollMs = 2000 } = {}) {
  try {
    const data = await fetchConfig();
    setSoundFiles(data.sounds);
    apply(data.config, data.revision);
  } catch {
    serverAvailable = false;
    return current;
  }

  channel?.addEventListener('message', event => {
    if (event.data?.revision > revision) apply(event.data.config, event.data.revision);
  });

  setInterval(async () => {
    try {
      const data = await fetchConfig();
      setSoundFiles(data.sounds);
      if (data.revision !== revision) apply(data.config, data.revision);
    } catch { /* server stopped; keep the last settings */ }
  }, pollMs);

  return current;
}

/** Save the full settings object and notify other open pages. */
export async function saveConfig(config) {
  const response = await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
  apply(config, data.revision);
  channel?.postMessage({ config, revision: data.revision });
  return data.revision;
}
