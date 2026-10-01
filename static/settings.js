// settings.js
// The /settings page: assigns sounds to tracker events, viewer buttons (one submenu
// per viewer tab) and competency cues, tunes the amplifier keep-alive tone, manages
// the audio library, tunes the visual effects, sets the room-light cues sent
// to LightRPG, and sets up the login screen (badge picture, timing of each step).
// Every edit updates a local draft,
// previews immediately, and is saved (debounced) to the server, which pushes it to
// open viewers.

import {
  BUTTON_GROUPS, COMPETENCIES, DEFAULT_CONFIG, LIGHT_ACTIONS, LIGHT_EFFECTS, LIGHT_EVENTS,
  LIGHT_TARGETS, RISK_LEVELS, SOUND_EVENTS, competencyFile, getConfig, isCompetencyFolderFile,
  mergeConfig, onConfigChange, saveConfig, setLocalConfig, setSoundFiles, startConfigSync
} from '/js/config.js';
import { sendLightCue } from '/js/lights.js';
import { playSlot, resolveSlot } from '/js/soundEffects.js';
import { SYNTHS } from '/js/synth.js';
import { COMPETENCY_INFO } from '/js/competencies.js';

const TAB_KEY = 'ta-settings-tab';
const BUTTON_GROUP_KEY = 'ta-settings-button-group';
const SETTINGS_FILE_FORMAT = 'triangle-agency-tracker-settings';
const SETTINGS_FILE_VERSION = 1;
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
  seconds: { label: 'Hold', min: 0, max: 30, step: 0.5, unit: 's', zeroLabel: 'keep' }
};
// What the bulbs take; the LED strip only ever gets a hue (see stripHue).
const LIGHT_ACTION_FIELDS = {
  none: [],
  color: ['hue', 'saturation', 'brightness'],
  white: ['temperature', 'brightness'],
  effect: [],
  off: []
};

// Slider/toggle definitions for the Effects tab.
const EFFECT_GROUPS = [
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

function persistConfig(config) {
  // Keep saves in order. A slider edit may schedule another save while the previous
  // request is still in flight, and a loaded file must always be written last.
  const previous = savePromise;
  const request = (previous ? previous.catch(() => {}) : Promise.resolve())
    .then(() => saveConfig(config));
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
  setStatus('Saving…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    try {
      await persistConfig(structuredClone(draft));
      if (!savePromise) setStatus('Saved', 'saved');
    } catch (error) {
      console.error(error);
      if (!savePromise) setStatus('Not saved — is the server running?', 'error');
    }
  }, 350);
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
  if (payload.format && payload.format !== SETTINGS_FILE_FORMAT) {
    throw new Error('That JSON file belongs to a different application.');
  }
  if (payload.version && payload.version > SETTINGS_FILE_VERSION) {
    throw new Error('This settings file was made by a newer tracker version.');
  }

  // Accept both files exported here and the server's existing tracker_config.json.
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
  await persistConfig(imported);
  draft = structuredClone(imported);
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

/** One slider, toggle or dropdown row bound to `path` in the draft. */
function renderField(path, field) {
  const value = getPath(draft, path);
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

function renderEffects() {
  $('#effectGroups').innerHTML = EFFECT_GROUPS.map(group => {
    const rows = group.fields.map(field => renderField(`effects.${group.key}.${field.key}`, field)).join('');
    return `<div class="card effect-card">
      <div class="section-heading">
        <div><span class="eyebrow">${group.eyebrow}</span><h2>${group.title}</h2></div>
        <button type="button" class="secondary small" data-reset-group="${group.key}">Reset</button>
      </div>
      <p class="hint">${group.hint}</p>
      <div class="fields">${rows}</div>
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
function stripHue(cue) {
  if (!usesStrip()) return null;
  if (cue.action === 'color') return cue.hue;
  if (cue.action === 'white' || (cue.action === 'effect' && !cue.effect.startsWith('strip:'))) return cue.led;
  return null;
}

/** Roughly what the cue looks like, for the round swatch beside it; a ring is the LED strip. */
function swatchStyle(cue) {
  const led = stripHue(cue);
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

function lightFieldKeys(cue, { hold }) {
  const keys = usesBulbs() ? [...LIGHT_ACTION_FIELDS[cue.action]] : cue.action === 'color' ? ['hue'] : [];
  if (stripHue(cue) !== null && cue.action !== 'color') keys.push('led');
  if (hold && cue.action !== 'none') keys.push('seconds');
  return keys;
}

function effectOptions(selected) {
  const groups = [...new Set(LIGHT_EFFECTS.map(effect => effect.group))];
  return groups.map(group => `<optgroup label="${group}">${LIGHT_EFFECTS.filter(effect => effect.group === group)
    .map(effect => `<option value="${effect.key}"${effect.key === selected ? ' selected' : ''}>${escapeHtml(effect.label)}</option>`).join('')}</optgroup>`).join('');
}

/** One cue editor: the action, its sliders, a swatch and (for events) a test button. */
function lightCueRow(path, cue, { label, hint, hold = true, test = true }) {
  const actions = LIGHT_ACTIONS.map(action =>
    `<option value="${action.key}"${action.key === cue.action ? ' selected' : ''}>${action.label}</option>`).join('');
  const fields = lightFieldKeys(cue, { hold }).map(key => renderField(`${path}.${key}`, LIGHT_FIELDS[key])).join('');
  const effect = cue.action === 'effect'
    ? `<label class="field"><span>Effect</span><select data-path="${path}.effect">${effectOptions(cue.effect)}</select></label>` : '';
  return `<div class="light-slot">
    ${label ? `<div class="slot-name"><strong>${escapeHtml(label)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>` : ''}
    <select data-path="${path}.action" aria-label="${escapeHtml(label || 'Ambient')} light">${actions}</select>
    <span class="light-swatch" data-swatch="${path}" style="${swatchStyle(cue)}" aria-hidden="true"></span>
    ${test ? `<button type="button" class="play" data-test-light="${path.replace('lights.', '')}" aria-label="Try the ${escapeHtml(label)} light">&#9654;</button>` : ''}
    <div class="light-fields">${effect}${fields}</div>
  </div>`;
}

function renderLights() {
  const outcomeEvents = new Set(['captured', 'killed', 'escaped']);
  $('#lightGeneral').innerHTML = LIGHT_GENERAL_FIELDS.map(field => renderField(`lights.${field.key}`, field)).join('');
  $('#lightAmbient').innerHTML = lightCueRow('lights.ambient', draft.lights.ambient, { hold: false, test: false });
  $('#missionOutcomeLightSlots').innerHTML = LIGHT_EVENTS.filter(({ key }) => outcomeEvents.has(key)).map(({ key, label, hint }) =>
    lightCueRow(`lights.events.${key}`, draft.lights.events[key], { label, hint })).join('');
  $('#lightSlots').innerHTML = LIGHT_EVENTS.filter(({ key }) => !outcomeEvents.has(key)).map(({ key, label, hint }) =>
    lightCueRow(`lights.events.${key}`, draft.lights.events[key], { label, hint })).join('');
  $('#openLightRPG').href = `${location.protocol}//${location.hostname}:5000/`;
}

let lightStatusTimer = 0;

async function refreshLightStatus() {
  const status = $('#lightStatus');
  try {
    const data = await (await fetch('/api/lights/status', { cache: 'no-store' })).json();
    const bulbs = Object.values(data.bulbs || {}).filter(Boolean).length;
    if (data.reachable) {
      const parts = [`${bulbs} bulb${bulbs === 1 ? '' : 's'}`, data.strip ? 'LED strip' : 'no strip'];
      status.textContent = data.lastError ? `Last cue failed: ${data.lastError}` : `Connected · ${parts.join(' · ')}`;
      status.dataset.state = data.lastError ? 'error' : 'saved';
    } else {
      status.textContent = !data.installed ? 'LightRPG folder not found' : data.starting ? 'LightRPG is starting…' : 'LightRPG is not running';
      status.dataset.state = data.starting ? 'saving' : 'error';
    }
    $('#startLightRPG').hidden = data.reachable || !data.installed;
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
  const cue = key === 'ambient' ? { ...draft.lights.ambient, seconds: 0 } : getPath(draft.lights, key);
  button.classList.add('playing');
  const result = await sendLightCue(cue, draft.lights);
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
  if (path.startsWith('lights.')) {
    // A new action, effect or target shows different sliders; other edits only recolour the swatch.
    if (/\.(action|effect)$/.test(path) || path === 'lights.target') renderLights();
    const cuePath = path.slice(0, path.lastIndexOf('.'));
    const swatch = document.querySelector(`[data-swatch="${cuePath}"]`);
    if (swatch) swatch.style.cssText = swatchStyle(getPath(draft, cuePath));
  }
  scheduleSave();
}

async function playFor(button) {
  if (button.dataset.testLight) return testLight(button);
  button.classList.add('playing');
  try {
    if (button.dataset.testEvent) {
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

  // Adopt changes saved from another device, unless this page has edits in flight.
  onConfigChange(config => {
    if (saveTimer || saving || JSON.stringify(config) === JSON.stringify(draft)) return;
    draft = structuredClone(config);
    renderAll();
  });

  document.addEventListener('input', handleEdit);
  document.addEventListener('change', handleEdit);

  document.addEventListener('click', event => {
    const tabButton = event.target.closest('[data-tab]');
    if (tabButton) showTab(tabButton.dataset.tab);

    const groupButton = event.target.closest('[data-button-group]');
    if (groupButton) showButtonGroup(groupButton.dataset.buttonGroup);

    const play = event.target.closest('.play');
    if (play) playFor(play);

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
