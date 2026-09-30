import { toast } from './ui.js';
import { normalizeAnomalyState } from './anomalyState.js';

const STORAGE_KEY = 'rpgSettings';
const HANDLE_DB_NAME = 'triangleAgencyTracker';
const HANDLE_STORE_NAME = 'fileHandles';
const TEAM_FILE_HANDLE_KEY = 'teamSaveFile';
let pendingSave = 0;
let pendingFileSave = 0;
let automaticFileHandle = null;
let automaticFileReady = false;
let automaticFileButton = null;
let fileSaveAnnounced = false;
let fileWriteChain = Promise.resolve();
// Set once a loaded team file is in storage and the page is reloading, so the save that runs
// when the page is left can't overwrite that file with the agents still on screen.
let savesSuspended = false;

function isEditableElement(element) {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || element?.isContentEditable;
}

function setAutomaticFileStatus(status, title = '') {
  if (!automaticFileButton) return;
  automaticFileButton.textContent = status;
  automaticFileButton.title = title;
}

function openHandleDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB_NAME, 1);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        request.result.createObjectStore(HANDLE_STORE_NAME);
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

async function readStoredFileHandle() {
  const database = await openHandleDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HANDLE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(HANDLE_STORE_NAME).get(TEAM_FILE_HANDLE_KEY);
    request.addEventListener('success', () => resolve(request.result || null));
    request.addEventListener('error', () => reject(request.error));
    transaction.addEventListener('complete', () => database.close());
  });
}

async function storeFileHandle(handle) {
  const database = await openHandleDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HANDLE_STORE_NAME, 'readwrite');
    transaction.objectStore(HANDLE_STORE_NAME).put(handle, TEAM_FILE_HANDLE_KEY);
    transaction.addEventListener('complete', () => {
      database.close();
      resolve();
    });
    transaction.addEventListener('error', () => reject(transaction.error));
  });
}

async function deleteStoredFileHandle() {
  const database = await openHandleDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(HANDLE_STORE_NAME, 'readwrite');
    transaction.objectStore(HANDLE_STORE_NAME).delete(TEAM_FILE_HANDLE_KEY);
    transaction.addEventListener('complete', () => {
      database.close();
      resolve();
    });
    transaction.addEventListener('error', () => reject(transaction.error));
  });
}

function showAutomaticFileOn(handle) {
  setAutomaticFileStatus('File Save: On', `Automatically saving to ${handle.name}. Click to unlink it.`);
}

async function writeSettingsToAutomaticFile() {
  const handle = automaticFileHandle;
  if (!automaticFileReady || !handle) return false;

  try {
    const writable = await handle.createWritable();
    const formattedSettings = JSON.stringify(loadSettings() || {}, null, 2);
    await writable.write(formattedSettings);
    await writable.close();
    if (handle !== automaticFileHandle) return true;   // unlinked while this write was running
    showAutomaticFileOn(handle);
    if (!fileSaveAnnounced) toast(`Auto-saving to ${handle.name}`);
    fileSaveAnnounced = true;
    return true;
  } catch (error) {
    if (handle !== automaticFileHandle) return false;
    automaticFileReady = false;
    fileSaveAnnounced = false;
    setAutomaticFileStatus('Reconnect Save File', 'Click to restore permission to the automatic save file.');
    toast('Lost access to the save file. Click "Reconnect Save File".', { kind: 'warn', duration: 6000 });
    console.error('Failed to automatically save the team file', error);
    return false;
  }
}

function queueAutomaticFileSave(delay = 300) {
  if (!automaticFileReady) return;
  window.clearTimeout(pendingFileSave);
  pendingFileSave = window.setTimeout(() => {
    pendingFileSave = 0;
    fileWriteChain = fileWriteChain.then(writeSettingsToAutomaticFile);
  }, delay);
}

export function getCharacterData(character) {
  const stat = key => character.querySelector(`[data-stat="${key}"]`)?.value || '';
  return {
    id: character._id,
    name: stat('name'),
    player: stat('player'),
    anomaly: stat('anomaly'),
    reality: stat('reality'),
    competency: stat('competency'),
    merit: Number.parseInt(character.querySelector('.triangle')?.textContent, 10) || 0,
    demerit: Number.parseInt(character.querySelector('.triangle-down')?.textContent, 10) || 0,
    sessionMerit: Number.parseInt(character.querySelector('.counter-input.merit')?.value, 10) || 0,
    sessionDemerit: Number.parseInt(character.querySelector('.counter-input.demerit')?.value, 10) || 0,
    // The attribute, not .src: .src is absolute, which ties the default portrait to this server's port.
    icon: character.querySelector('img')?.getAttribute('src') || '',
    dead: character.classList.contains('dead'),
    primeDirective: character.dataset.primeDirective || '',
    encouragedBehavior: character.dataset.encouragedBehavior || '',
    realityDose: character._realityDose || 0,
    competencyProgress: character._competencyProgress || 0,
    anomalyState: normalizeAnomalyState(character._anomalyState),
    // Copies, so a snapshot (undo, export) isn't changed by later edits.
    relationships: (character._relationships || []).map(relationship => ({ ...relationship }))
  };
}

function downloadJson(data, filename) {
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function chooseJsonFile(onData, invalidMessage) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener('load', () => {
      try {
        onData(JSON.parse(reader.result));
      } catch (error) {
        console.error(invalidMessage, error);
        toast(invalidMessage, { kind: 'error' });
      }
    });
    reader.readAsText(file);
  });
  input.click();
}

export function loadSettings() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

let lastSaveErrorToast = 0;

function reportSaveError(error) {
  console.error('Failed to save settings', error);
  // Throttle so a burst of failing saves shows one message, not dozens.
  if (Date.now() - lastSaveErrorToast < 5000) return;
  lastSaveErrorToast = Date.now();
  const quotaFull = error?.name === 'QuotaExceededError' || error?.code === 22;
  toast(
    quotaFull
      ? 'Browser storage is full. Changes are NOT being saved. Use smaller portraits or export a Team CV.'
      : 'Changes could not be saved. Export a Team CV to keep a backup.',
    { kind: 'error', duration: 7000 }
  );
}

/**
 * updateSettings - the single read-modify-write path for the saved state.
 * Every module that persists data goes through here so the automatic save
 * file stays in sync and storage errors are reported consistently.
 */
export function updateSettings(mutate) {
  if (savesSuspended) return false;
  try {
    const settings = loadSettings() || {};
    if (!settings.world || typeof settings.world !== 'object') settings.world = {};
    mutate(settings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    queueAutomaticFileSave();
    return true;
  } catch (error) {
    reportSaveError(error);
    return false;
  }
}

// Save-file key -> counter element id for every world counter.
const WORLD_COUNTER_IDS = {
  witness: 'witnessCounter',
  chaos: 'chaosCounter',
  globalWitness: 'globalWitnessCounter',
  captured: 'capturedCounter',
  killed: 'killedCounter',
  escaped: 'escapedCounter'
};

function readWorldCounters() {
  return Object.fromEntries(Object.entries(WORLD_COUNTER_IDS).map(([key, id]) =>
    [key, Number(document.getElementById(id)?.textContent || 0)]
  ));
}

export function saveSettings() {
  return updateSettings(settings => {
    settings.chars = [...document.querySelectorAll('.char:not(.leaving)')].map(getCharacterData);
    Object.assign(settings.world, {
      branchName: document.getElementById('branchName')?.value ?? '',
      ...readWorldCounters()
    });
  });
}

/**
 * Install a single persistence safety net for the whole tracker.
 *
 * Individual controls still save immediately where needed. This delegated
 * listener also covers controls added in the future, while the lifecycle
 * handlers flush the latest DOM state before the page is left.
 */
export function initLocalStorage() {
  const queueSave = event => {
    if (!isEditableElement(event.target)) return;
    window.clearTimeout(pendingSave);
    pendingSave = window.setTimeout(() => {
      pendingSave = 0;
      saveSettings();
    }, 150);
  };

  document.addEventListener('input', queueSave);
  document.addEventListener('change', queueSave);

  const flushSave = () => {
    window.clearTimeout(pendingSave);
    pendingSave = 0;
    saveSettings();
  };

  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

/** Restore a previously approved team file without prompting the user. */
export async function initAutomaticFileSave(button) {
  automaticFileButton = button;

  if (!('showSaveFilePicker' in window) || !('indexedDB' in window)) {
    setAutomaticFileStatus('File Save Unsupported', 'Use Team CV to download a manual backup in this browser.');
    if (automaticFileButton) automaticFileButton.disabled = true;
    return false;
  }

  try {
    automaticFileHandle = await readStoredFileHandle();
    if (!automaticFileHandle) {
      setAutomaticFileStatus('Connect Save File', 'Choose a JSON file to keep updated automatically.');
      return false;
    }

    automaticFileReady = (await automaticFileHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
    if (automaticFileReady) {
      showAutomaticFileOn(automaticFileHandle);
      queueAutomaticFileSave(0);
    } else {
      setAutomaticFileStatus('Reconnect Save File', 'Click to restore permission to the automatic save file.');
    }
    return automaticFileReady;
  } catch (error) {
    console.error('Failed to restore the automatic save file', error);
    setAutomaticFileStatus('Connect Save File', 'Choose a JSON file to keep updated automatically.');
    return false;
  }
}

/** Stop keeping the connected file updated. The data saved in this browser is untouched. */
async function unlinkAutomaticSaveFile() {
  const handle = automaticFileHandle;
  window.clearTimeout(pendingFileSave);
  pendingFileSave = 0;
  automaticFileHandle = null;
  automaticFileReady = false;
  fileSaveAnnounced = false;
  setAutomaticFileStatus('Connect Save File', 'Choose a JSON file to keep updated automatically.');

  try {
    await deleteStoredFileHandle();
  } catch (error) {
    console.error('Failed to forget the automatic save file', error);
  }

  toast(`Stopped auto-saving to ${handle.name}. Your data is still saved in this browser.`, {
    duration: 6000,
    action: {
      label: 'Undo',
      onClick: () => {
        if (automaticFileHandle) return;   // another file was connected in the meantime
        automaticFileHandle = handle;
        connectAutomaticSaveFile();
      }
    }
  });
}

/**
 * The save-file button: connects a file (asking once, then keeping it synchronized),
 * restores permission to a remembered one, or, while saving, unlinks it.
 */
export async function connectAutomaticSaveFile() {
  if (!('showSaveFilePicker' in window)) return false;

  if (automaticFileReady) {
    await unlinkAutomaticSaveFile();
    return false;
  }

  try {
    if (automaticFileHandle) {
      const permission = await automaticFileHandle.requestPermission({ mode: 'readwrite' });
      automaticFileReady = permission === 'granted';
    }

    if (!automaticFileReady) {
      automaticFileHandle = await window.showSaveFilePicker({
        suggestedName: 'triangle-agency-team.json',
        types: [{
          description: 'Triangle Agency team data',
          accept: { 'application/json': ['.json'] }
        }]
      });
      automaticFileReady = true;
    }

    await storeFileHandle(automaticFileHandle);
    await writeSettingsToAutomaticFile();
    return automaticFileReady;
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error('Failed to connect the automatic save file', error);
      toast('The automatic save file could not be connected. Your browser-local data is still safe.', { kind: 'error', duration: 6000 });
    }
    return false;
  }
}

export function saveSettingsFile(filename) {
  try {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      '-',
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0')
    ].join('');
    downloadJson(localStorage.getItem(STORAGE_KEY) || '{}', filename || `rpgSettings-${stamp}.json`);
    return true;
  } catch (error) {
    console.error('Failed to export settings', error);
    return false;
  }
}

export function loadSettingsFile() {
  chooseJsonFile(data => {
    if (!data || typeof data !== 'object') throw new Error('Invalid settings file');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    savesSuspended = true;
    location.reload();
  }, 'Failed to load settings file: invalid JSON or structure.');
}

export function saveCharacterToFile(character, filename) {
  try {
    const char = getCharacterData(character);
    const wrapper = {
      meta: { kind: 'single-agent', version: 1, created: new Date().toISOString() },
      char
    };
    const safeName = filename || `${(char.name || 'agent').replace(/\s+/g, '_')}.agent.json`;
    downloadJson(JSON.stringify(wrapper, null, 2), safeName);
    return true;
  } catch (error) {
    console.error('Failed to export agent', error);
    return false;
  }
}

export function loadCharacterFile(onLoad) {
  chooseJsonFile(data => {
    if (!data?.char || typeof data.char !== 'object') throw new Error('Invalid agent file');
    onLoad(data.char);
    saveSettings();
  }, 'Invalid Agent file');
}
