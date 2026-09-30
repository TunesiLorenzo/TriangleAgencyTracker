// settings.js
// The /settings page: assigns sounds to tracker events, viewer buttons (one submenu
// per viewer tab) and competency cues, tunes the amplifier keep-alive tone, manages
// the audio library, and tunes the visual effects. Every edit updates a local draft,
// previews immediately, and is saved (debounced) to the server, which pushes it to
// open viewers.

import {
  BUTTON_GROUPS, COMPETENCIES, DEFAULT_CONFIG, RISK_LEVELS, SOUND_EVENTS,
  competencyFile, getConfig, isCompetencyFolderFile, onConfigChange, saveConfig,
  setLocalConfig, setSoundFiles, startConfigSync
} from '/js/config.js';
import { playSlot, resolveSlot } from '/js/soundEffects.js';
import { SYNTHS } from '/js/synth.js';
import { COMPETENCY_INFO } from '/js/competencies.js';

const TAB_KEY = 'ta-settings-tab';
const BUTTON_GROUP_KEY = 'ta-settings-button-group';

const KEEP_ALIVE_FIELDS = [
  { key: 'enabled', label: 'Drone on', type: 'toggle' },
  { key: 'level', label: 'Drone volume', min: 0, max: 0.05, step: 0.001, percent: true, decimals: 1 },
  { key: 'frequency', label: 'Drone pitch', min: 20, max: 250, step: 5, unit: 'Hz' }
];

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

let draft = structuredClone(DEFAULT_CONFIG);
let sounds = [];
let saveTimer = 0;
let saving = false;
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

function scheduleSave() {
  setLocalConfig(draft);
  setStatus('Saving…', 'saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    saving = true;
    try {
      await saveConfig(structuredClone(draft));
      setStatus('Saved', 'saved');
    } catch (error) {
      console.error(error);
      setStatus('Not saved — is the server running?', 'error');
    } finally {
      saving = false;
    }
  }, 350);
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
    return `<label class="field"><span>${field.label}</span>
      <select data-path="${path}">${field.options.map(o => `<option value="${o}"${o === value ? ' selected' : ''}>${o[0].toUpperCase() + o.slice(1)}</option>`).join('')}</select></label>`;
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

function renderAll() {
  renderMaster();
  renderKeepAlive();
  renderEvents();
  renderButtonVolume();
  renderButtons();
  renderCompetencies();
  renderLibrary();
  renderEffects();
}

/* ---------- editing ---------- */
/** The slider definition behind an effects or keep-alive path; volumes have none. */
function fieldFor(path) {
  if (path.startsWith('sounds.keepAlive.')) return KEEP_ALIVE_FIELDS.find(f => path === `sounds.keepAlive.${f.key}`);
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
  scheduleSave();
}

async function playFor(button) {
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
