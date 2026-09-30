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

// Italian edition names (Materiale/Realtà_lista.pdf).
export const REALITIES = ['Custode', 'Stacanovista', 'Fuggitivo', 'Star', 'Squattrinato', 'Tabula Rasa', 'Romanticone', 'Pilastro', 'Creatura'];

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

// Every button in the viewer, grouped like the Buttons submenus on /settings: the controls
// shared by every tab, dialogs, then one group per main tab. A click plays the first entry
// whose selector matches the button; `fallback` entries (each tab's "Other buttons") are
// tried after all the others, so buttons added later still make a sound.
export const BUTTON_GROUPS = [
  {
    key: 'general', label: 'General', hint: 'The top bar, the main tabs, the branch panel and Next Mission, shown on every tab.',
    buttons: [
      { key: 'viewTab', label: 'Main tabs', selector: '.view-tab', sound: 'synth:switch' },
      { key: 'hireAgent', label: 'Hire Agent', selector: '#addAgentButton', sound: 'synth:stamp' },
      { key: 'recall', label: 'Recall Agent / Recall Team', selector: '#loadAgentButton, #loadTeamButton', sound: 'synth:drawer' },
      { key: 'exportCv', label: 'Agent CV / Team CV', selector: '#exportAgentButton, #exportTeamButton', sound: 'synth:typewriter' },
      { key: 'closeBranch', label: 'Close Branch', selector: '#resetButton', sound: 'synth:close' },
      { key: 'saveFile', label: 'Connect Save File', selector: '#autoSaveFileButton', sound: 'synth:click' },
      { key: 'mute', label: 'Sound on / off', selector: '#muteButton', sound: 'synth:click' },
      { key: 'settings', label: 'Settings', selector: '#settingsLink', sound: 'synth:click' },
      { key: 'restartTimeline', label: 'Restart timeline', hint: 'On the Mission Timeline graph', selector: '#restartTimelineButton', sound: 'synth:close' },
      { key: 'nextMission', label: 'Next Mission', selector: '#nextMissionButton', sound: 'synth:open' },
      { key: 'captured', label: 'Mission end: Catturata', selector: '.mission-modal .modal-btn-captured', sound: 'synth:lock', volume: 0.9 },
      { key: 'killed', label: 'Mission end: Uccisa', selector: '.mission-modal .modal-btn-killed', sound: 'synth:thud', volume: 0.9 },
      { key: 'escaped', label: 'Mission end: Liberata', selector: '.mission-modal .modal-btn-escaped', sound: 'synth:alarm', volume: 0.7 },
      // No selector: the last resort for a button no other entry matches.
      { key: 'other', label: 'Any other button', sound: 'synth:click', fallback: true }
    ]
  },
  {
    key: 'dialogs', label: 'Dialogs', hint: 'Pop-up windows opened from any tab, and Undo on notifications.',
    buttons: [
      { key: 'confirm', label: 'Confirm / Save', hint: 'The highlighted button of a dialog', selector: '.modal-panel .modal-btn-primary', sound: 'synth:confirm' },
      { key: 'danger', label: 'Delete / Close Branch', hint: 'Red confirm buttons', selector: '.modal-panel .modal-btn-danger', sound: 'synth:trash' },
      { key: 'chooseAgent', label: 'Pick an agent', hint: 'Agent picker, e.g. when applying a task', selector: '.modal-panel .chooser-item', sound: 'synth:tap' },
      { key: 'dismiss', label: 'Cancel / Close', hint: 'And any other dialog button', selector: '.modal-panel .modal-close, .modal-panel .modal-btn', sound: 'synth:cancel' },
      { key: 'undo', label: 'Undo', selector: '.toast-action', sound: 'synth:close' }
    ]
  },
  {
    key: 'agents', label: 'Agents', hint: 'Sick leave, Prime Directive and Encouraged Behavior keep their Event / Competency sounds.',
    buttons: [
      { key: 'addTask', label: '+ Add Task', selector: '#taskPanel .add-task-btn', sound: 'synth:pop' },
      { key: 'applyTask', label: 'Task', hint: 'Opens the agent picker', selector: '#taskPanel .task', sound: 'synth:tap' },
      { key: 'deleteTask', label: 'Delete task', selector: '#taskPanel .task-del', sound: 'synth:trash' },
      { key: 'flipCard', label: 'Flip agent card', selector: '.char .flip-btn', sound: 'synth:paper' },
      { key: 'exportAgent', label: 'Export agent (on the card)', selector: '.char .export-btn', sound: 'synth:typewriter' },
      { key: 'removeAgent', label: 'Remove agent', selector: '.char .remove-btn', sound: 'synth:trash' },
      { key: 'other', label: 'Other buttons', selector: '#agentsView *', sound: 'synth:click', fallback: true }
    ]
  },
  {
    key: 'relationships', label: 'Relationships', hint: '',
    buttons: [
      { key: 'openAgent', label: 'Open an agent', hint: 'A column of the overview', selector: '.rel-summary', sound: 'synth:open' },
      { key: 'switchAgent', label: 'Switch agent', selector: '.rel-switch', sound: 'synth:switch' },
      { key: 'back', label: 'Back', selector: '.rel-back', sound: 'synth:close' },
      { key: 'track', label: 'Relationship track', selector: '.rel-track', sound: 'synth:step' },
      { key: 'dose', label: 'Dose di Realtà track', selector: '#relationshipsView .dose-track', sound: 'synth:step' },
      { key: 'bonusActive', label: 'Bonus Active box', selector: '.rel-active input', sound: 'synth:switch' },
      { key: 'picture', label: 'Relationship picture', selector: '.rel-picture', sound: 'synth:click' },
      { key: 'add', label: '+ Add Relationship', selector: '#relationshipsView .rel-add', sound: 'synth:pop' },
      { key: 'openRelationship', label: 'Open a relationship', selector: '.rel-tile', sound: 'synth:paper' },
      { key: 'remove', label: 'Remove relationship', selector: '.rel-remove, .rel-remove-page', sound: 'synth:trash' },
      { key: 'other', label: 'Other buttons', selector: '#relationshipsView *', sound: 'synth:click', fallback: true }
    ]
  },
  {
    key: 'anomaly', label: 'Anomaly', hint: '',
    buttons: [
      { key: 'trackBox', label: 'Tracciato Anomalia box', selector: '.anomaly-square', sound: 'synth:typewriter' },
      { key: 'answerBox', label: 'Answer box', selector: '.answer-square', sound: 'synth:typewriter' },
      { key: 'ability', label: 'Open / close an ability', selector: '.anomaly-ability-open, .anomaly-ability-nav button', sound: 'synth:paper' },
      { key: 'used', label: 'Usata?', selector: '.anomaly-used', sound: 'synth:stamp' },
      { key: 'rules', label: 'Come usare il tracciato', selector: '#anomalyView summary', sound: 'synth:paper' },
      { key: 'add', label: '+ Aggiungi abilità', selector: '#anomalyView .rel-add', sound: 'synth:pop' },
      { key: 'edit', label: 'Modifica (own ability)', selector: '.anomaly-custom-controls .modal-btn:first-child', sound: 'synth:click' },
      { key: 'remove', label: 'Rimuovi (own ability)', selector: '.anomaly-custom-controls .modal-btn:last-child', sound: 'synth:trash' },
      { key: 'other', label: 'Other buttons', selector: '#anomalyView *', sound: 'synth:click', fallback: true }
    ]
  },
  {
    key: 'agency', label: 'Agency', hint: '',
    buttons: [
      { key: 'openAgent', label: 'Open an agent', hint: 'A tile of the overview', selector: '.agency-summary', sound: 'synth:open' },
      { key: 'switch', label: 'Switch agent / item', selector: '.agency-switch', sound: 'synth:switch' },
      { key: 'back', label: 'Back', selector: '.agency-back', sound: 'synth:close' },
      { key: 'trackBox', label: 'Tracciato Competenza box', selector: '.competency-square', sound: 'synth:typewriter' },
      { key: 'rules', label: 'Come usare il tracciato', selector: '#agencyView .agency-rules summary', sound: 'synth:paper' },
      { key: 'itemList', label: 'Open / close the item list', selector: '.agency-items > summary', sound: 'synth:drawer' },
      { key: 'openItem', label: 'Open an item', selector: '.agency-item-tile', sound: 'synth:paper' },
      { key: 'itemIcon', label: 'Item icon choice', selector: '.agency-icon-choice', sound: 'synth:tap' },
      { key: 'add', label: '+ Aggiungi oggetto', selector: '.agency-add', sound: 'synth:pop' },
      { key: 'remove', label: 'Rimuovi oggetto', selector: '.agency-remove-item', sound: 'synth:trash' },
      { key: 'promo', label: 'Promo banner controls', hint: 'Arrows, dots and pause', selector: '.promo button', sound: 'synth:tap' },
      { key: 'other', label: 'Other buttons', selector: '#agencyView *', sound: 'synth:click', fallback: true }
    ]
  },
  {
    key: 'previousCases', label: 'Previous Cases', hint: 'Delete case, Open original and File case are Dialog buttons.',
    buttons: [
      { key: 'openVault', label: 'Open archive security gates', selector: '.cases-vault-trigger', sound: 'synth:alarm', volume: 0.8 },
      { key: 'openCase', label: 'Open a case envelope', selector: '.case-envelope', sound: 'synth:paper' },
      { key: 'fileCase', label: '+ File a new case', selector: '.cases-add', sound: 'synth:drawer' },
      { key: 'other', label: 'Other buttons', selector: '#previousCasesView *', sound: 'synth:click', fallback: true }
    ]
  }
];

// These already play an Event or Competency sound, so they get no button sound on top.
export const EVENT_SOUND_BUTTONS = '.death-btn, .back-action-btn';

function competencyDefaults() {
  return Object.fromEntries(COMPETENCIES.map(name => [name, { prime: slot(''), encouraged: slot('') }]));
}

function buttonDefaults() {
  return Object.fromEntries(BUTTON_GROUPS.map(group => [
    group.key,
    Object.fromEntries(group.buttons.map(button => [button.key, slot(button.sound, button.volume ?? 1)]))
  ]));
}

export const DEFAULT_CONFIG = {
  sounds: {
    masterVolume: 0.8,
    buttonVolume: 0.6,     // on top of each button's own volume, so clicks sit under the event sounds
    // A near-silent tone that keeps auto-standby AUX/Bluetooth amplifiers awake (from MTG_Table).
    keepAlive: {
      enabled: true,
      frequency: 120,      // Hz; inside what small speakers reproduce, so the amp's standby circuit sees it
      level: 0.008         // gain
    },
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
    competencies: competencyDefaults(),
    buttons: buttonDefaults()
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
