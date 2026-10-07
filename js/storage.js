import { confirmDialog, openModal, toast } from './ui.js';
import { normalizeAnomalyState } from './anomalyState.js';

const STORAGE_KEY = 'rpgSettings';
const HANDLE_DB_NAME = 'triangleAgencyTracker';
const HANDLE_STORE_NAME = 'fileHandles';
const TEAM_FILE_HANDLE_KEY = 'teamSaveFile';
const SERVER_SAVE_STATE_KEY = 'triangleAgencyServerSave';
let pendingSave = 0;
let pendingFileSave = 0;
let automaticFileHandle = null;
let automaticFileReady = false;
let automaticFileButton = null;
let fileSaveAnnounced = false;
let fileWriteChain = Promise.resolve();
let automaticSaveBackend = 'native';
let trackerServer = false;   // the page comes from the tracker server, which keeps the shared team save
let serverSaveReady = false;
let serverSaveState = { linked: false, version: null, dirty: false };
// The team as last read from or written to the tracker computer (canonical JSON). A save that
// matches it has nothing to send, so leaving the page is not mistaken for an unsent change.
let serverSyncedTeam = null;
// Set once a loaded team file is in storage and the page is reloading, so the save that runs
// when the page is left can't overwrite that file with the agents still on screen.
let savesSuspended = false;
// Supplied by app.js: reads the case archive off the server so it can ride along in the
// save file. Injected rather than imported to keep storage.js free of a circular import.
let readCaseArchive = null;

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
  // Pulses while the file is linked but not being written, so a paused sync can't go unnoticed.
  automaticFileButton.classList.toggle('needs-attention', /^(Reconnect|Resolve)/.test(status));
}

/**
 * The save file stopped being written (the browser needs permission again, usually after a
 * restart). Changes are still kept in this browser; the file catches up once reconnected.
 */
function warnFileNotSyncing(message) {
  setAutomaticFileStatus('Reconnect Save File', 'Click to restore permission to the automatic save file.');
  toast(message, {
    kind: 'warn',
    duration: 20000,
    // A click on the toast is the user gesture the browser needs to grant permission again.
    action: { label: 'Reconnect', onClick: () => connectAutomaticSaveFile() }
  });
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

/**
 * Remember the handle for the next session. Best effort: if IndexedDB is unavailable the
 * file still works for this session, so a failure here must not abort connecting.
 */
async function rememberFileHandle(handle) {
  try {
    await storeFileHandle(handle);
  } catch (error) {
    console.error('Failed to remember the automatic save file for next time', error);
  }
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

function showServerSaveOn() {
  setAutomaticFileStatus('Desktop Save: On', 'Automatically saving the team on the tracker computer. Click to disconnect.');
}

function loadServerSaveState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SERVER_SAVE_STATE_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      return {
        linked: saved.linked === true,
        version: typeof saved.version === 'string' ? saved.version : null,
        dirty: saved.dirty === true
      };
    }
  } catch { /* start disconnected if the small metadata record is damaged */ }
  return { linked: false, version: null, dirty: false };
}

function storeServerSaveState() {
  localStorage.setItem(SERVER_SAVE_STATE_KEY, JSON.stringify(serverSaveState));
}

/** JSON with every object's keys sorted: two copies of a team compare equal however they were written. */
function canonicalJson(value) {
  return JSON.stringify(value, (key, item) => (
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]]))
      : item
  ));
}

async function fetchServerSave() {
  const response = await fetch('/api/team-save', { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
  return data;
}

async function putServerSave({ overwrite = false } = {}) {
  const team = loadSettings() || {};
  const response = await fetch('/api/team-save', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedVersion: serverSaveState.version, overwrite, team })
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 409 || data.conflict) {
    const error = new Error(data.message || 'The desktop copy changed');
    error.name = 'SaveConflictError';
    error.version = data.version ?? null;
    throw error;
  }
  if (!response.ok || !data.ok) throw new Error(data.message || `HTTP ${response.status}`);
  serverSaveState.version = data.version;
  // Still unsent if the team changed again while this copy was on its way.
  serverSyncedTeam = canonicalJson(team);
  serverSaveState.dirty = canonicalJson(loadSettings() || {}) !== serverSyncedTeam;
  serverSaveReady = true;
  storeServerSaveState();
  showServerSaveOn();
  if (!fileSaveAnnounced) toast('Auto-saving on the tracker computer');
  fileSaveAnnounced = true;
  return true;
}

async function writeSettingsToServer() {
  if (!serverSaveState.linked || !serverSaveReady) return false;
  try {
    return await putServerSave();
  } catch (error) {
    serverSaveReady = false;
    serverSaveState.dirty = true;
    storeServerSaveState();
    fileSaveAnnounced = false;
    if (error.name === 'SaveConflictError') {
      setAutomaticFileStatus('Resolve Desktop Save', 'The desktop copy changed elsewhere. Click to choose which copy to keep.');
      toast('The desktop save changed in another viewer. Nothing was overwritten; click Resolve Desktop Save.', { kind: 'warn', duration: 12000 });
    } else {
      setAutomaticFileStatus('Reconnect Desktop Save', 'The tracker computer could not be reached. Click to retry.');
      toast('The desktop save is temporarily offline. Changes are safe in this browser and will wait for reconnect.', { kind: 'warn', duration: 10000 });
    }
    console.error('Failed to save the team on the tracker computer', error);
    return false;
  }
}

/**
 * Read a handle's current contents.
 * Returns the parsed settings object, null for an empty/new file, or throws when the
 * file holds something that is not a settings object (so we never silently clobber it).
 */
async function readSettingsFromHandle(handle) {
  const file = await handle.getFile();
  const text = (await file.text()).trim();
  if (!text) return null;
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Not a team settings file');
  }
  return data;
}

/** Describe what a save file holds, for the import prompt. */
function describeSettings(data) {
  const agents = Array.isArray(data.chars) ? data.chars.length : 0;
  const branch = typeof data.world?.branchName === 'string' ? data.world.branchName.trim() : '';
  const parts = [`${agents} ${agents === 1 ? 'agent' : 'agents'}`];
  if (branch) parts.push(`branch “${branch}”`);
  return parts.join(', ');
}

/**
 * Take the file's contents as the current state: store them, then reload so every module
 * renders from the loaded data. Saves are suspended first so the pagehide flush on the way
 * out can't write the still-on-screen agents back over the file we just adopted.
 */
function adoptSettings(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  savesSuspended = true;
  location.reload();
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
    warnFileNotSyncing('Lost access to the save file: changes are only kept in this browser until you reconnect it.');
    console.error('Failed to automatically save the team file', error);
    return false;
  }
}

function queueAutomaticFileSave(delay = 300) {
  if (automaticSaveBackend === 'server') {
    if (!serverSaveState.linked) return;
    // Hiding or closing the page saves again with nothing changed. That is no news for the
    // tracker computer, and must not pass for an unsent change at the next visit, when another
    // browser may have moved the shared copy on.
    if (serverSaveReady && !serverSaveState.dirty && canonicalJson(loadSettings() || {}) === serverSyncedTeam) return;
    serverSaveState.dirty = true;
    storeServerSaveState();
    if (!serverSaveReady) return;
  } else if (!automaticFileReady) return;
  window.clearTimeout(pendingFileSave);
  pendingFileSave = window.setTimeout(() => {
    pendingFileSave = 0;
    fileWriteChain = fileWriteChain.then(
      automaticSaveBackend === 'server' ? writeSettingsToServer : writeSettingsToAutomaticFile
    );
  }, delay);
}

/** Start the save file write at once (page being hidden or closed), dropping any queued one. */
function writeAutomaticFileNow() {
  if (automaticSaveBackend === 'server') {
    if (!serverSaveState.linked || !serverSaveReady || !serverSaveState.dirty) return;
  } else if (!automaticFileReady) return;
  window.clearTimeout(pendingFileSave);
  pendingFileSave = 0;
  fileWriteChain = fileWriteChain.then(
    automaticSaveBackend === 'server' ? writeSettingsToServer : writeSettingsToAutomaticFile
  );
}

/** Register the case-archive reader used to keep `cases` in the saved state current. */
export function setCaseArchiveSource(read) {
  readCaseArchive = read;
}

/**
 * Refresh the case archive held in the saved state, then save.
 *
 * The archive lives on the server, so reading it is async and cannot happen inside the
 * synchronous updateSettings path. Callers await this at the points where the archive may
 * have changed; a server that is unreachable leaves the stored copy alone.
 */
export async function syncCaseArchive() {
  if (!readCaseArchive || savesSuspended) return false;
  try {
    const cases = await readCaseArchive();
    if (!Array.isArray(cases)) return false;
    return updateSettings(settings => { settings.cases = cases; });
  } catch (error) {
    console.error('Failed to read the case archive for the save file', error);
    return false;
  }
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
    realityProgress: character._realityProgress || 0,
    competencyProgress: character._competencyProgress || 0,
    distinctions: { mvp: 0, suspended: 0, ...character._distinctions },
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
    // Write the save file now rather than after the usual short wait: the page may be closing.
    writeAutomaticFileNow();
  };

  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
}

async function initServerSave() {
  automaticSaveBackend = 'server';
  serverSaveState = loadServerSaveState();
  if (!serverSaveState.linked) {
    setAutomaticFileStatus('Connect Desktop Save', 'Keep an automatic team save on the tracker computer.');
    return false;
  }

  try {
    const remote = await fetchServerSave();
    if (serverSaveState.dirty) {
      if (remote.version !== serverSaveState.version) {
        serverSaveReady = false;
        setAutomaticFileStatus('Resolve Desktop Save', 'Both this browser and the desktop copy changed. Click to choose which one to keep.');
        return false;
      }
      serverSaveReady = true;
      return putServerSave();
    }

    if (remote.exists && remote.version !== serverSaveState.version) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remote.team));
    }
    serverSyncedTeam = remote.exists ? canonicalJson(remote.team) : null;
    serverSaveState.version = remote.version ?? null;
    serverSaveState.dirty = false;
    serverSaveReady = true;
    storeServerSaveState();
    showServerSaveOn();
    return true;
  } catch (error) {
    serverSaveReady = false;
    setAutomaticFileStatus('Reconnect Desktop Save', 'Could not reach the team save on the tracker computer. Click to retry.');
    console.error('Failed to restore the desktop team save', error);
    return false;
  }
}

/**
 * Restore the automatic team save. With the tracker server running there is one save for every
 * browser, the copy on the tracker computer, also for a browser on that computer itself. A file
 * picked in the browser is for a tracker served without it, and for a browser that linked one
 * before: that link is kept until it is unlinked.
 */
export async function initAutomaticFileSave(button, { serverAvailable = false } = {}) {
  automaticFileButton = button;
  trackerServer = serverAvailable;

  const nativeFileAccess = window.isSecureContext
    && 'showSaveFilePicker' in window
    && 'showOpenFilePicker' in window
    && 'indexedDB' in window;
  if (!nativeFileAccess) return initServerSave();
  automaticSaveBackend = 'native';

  try {
    automaticFileHandle = await readStoredFileHandle();
    if (!automaticFileHandle) {
      // A browser already saving on the tracker computer stays with it while the server is away,
      // so what changes here in the meantime is still sent there, not to some other file.
      if (trackerServer || loadServerSaveState().linked) return initServerSave();
      setAutomaticFileStatus('Connect Save File', 'Choose a JSON file to keep updated automatically.');
      return false;
    }

    automaticFileReady = (await automaticFileHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
    if (automaticFileReady) {
      showAutomaticFileOn(automaticFileHandle);
      queueAutomaticFileSave(0);
    } else {
      warnFileNotSyncing(`${automaticFileHandle.name} is not being updated: reconnect it to keep the save file in sync.`);
    }
    return automaticFileReady;
  } catch (error) {
    console.error('Failed to restore the automatic save file', error);
    if (trackerServer && !automaticFileHandle) return initServerSave();
    setAutomaticFileStatus('Connect Save File', 'Choose a JSON file to keep updated automatically.');
    return false;
  }
}

function askServerSaveChoice(remote) {
  return new Promise(resolve => {
    const body = document.createElement('p');
    body.className = 'modal-message';
    body.textContent = `The tracker computer already holds ${describeSettings(remote.team)}. Load that copy, or explicitly replace it with the team currently in this browser.`;
    let choice = null;
    openModal({
      title: 'Desktop save conflict',
      content: body,
      closeLabel: 'Cancel',
      actions: [
        { label: 'Replace Desktop Copy', onClick: () => { choice = 'browser'; } },
        { label: 'Load Desktop Copy', variant: 'primary', onClick: () => { choice = 'desktop'; } }
      ],
      onClose: () => resolve(choice)
    });
  });
}

async function connectServerSave() {
  if (serverSaveState.linked && serverSaveReady && !serverSaveState.dirty) {
    return unlinkAutomaticSaveFile();
  }

  try {
    const remote = await fetchServerSave();

    if (serverSaveState.linked && serverSaveState.dirty && remote.version === serverSaveState.version) {
      serverSaveReady = true;
      return putServerSave();
    }

    if (serverSaveState.linked && !serverSaveState.dirty) {
      serverSaveReady = true;
      serverSaveState.version = remote.version ?? null;
      storeServerSaveState();
      if (remote.exists) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remote.team));
        savesSuspended = true;
        location.reload();
      } else {
        showServerSaveOn();
      }
      return true;
    }

    if (remote.exists) {
      const choice = await askServerSaveChoice(remote);
      if (!choice) return false;
      serverSaveState.linked = true;
      serverSaveState.version = remote.version;
      if (choice === 'desktop') {
        serverSaveState.dirty = false;
        storeServerSaveState();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(remote.team));
        savesSuspended = true;
        location.reload();
        return true;
      }
      serverSaveState.dirty = true;
      serverSaveReady = true;
      storeServerSaveState();
      return putServerSave({ overwrite: true });
    }

    serverSaveState = { linked: true, version: null, dirty: true };
    serverSaveReady = true;
    storeServerSaveState();
    return putServerSave();
  } catch (error) {
    serverSaveReady = false;
    setAutomaticFileStatus('Reconnect Desktop Save', 'Could not reach the tracker computer. Click to retry.');
    toast('Could not connect the desktop team save. Your browser-local data is unchanged.', { kind: 'error', duration: 7000 });
    console.error('Failed to connect the desktop team save', error);
    return false;
  }
}

/** Stop keeping the connected file updated. The data saved in this browser is untouched. */
async function unlinkAutomaticSaveFile() {
  if (automaticSaveBackend === 'server') {
    serverSaveState = { linked: false, version: null, dirty: false };
    serverSaveReady = false;
    serverSyncedTeam = null;
    fileSaveAnnounced = false;
    storeServerSaveState();
    setAutomaticFileStatus('Connect Desktop Save', 'Keep an automatic team save on the tracker computer.');
    toast('Disconnected the desktop save. The desktop copy and this browser copy were both kept.', { duration: 6000 });
    return false;
  }

  const handle = automaticFileHandle;
  if (!handle) return;
  window.clearTimeout(pendingFileSave);
  pendingFileSave = 0;
  automaticFileHandle = null;
  automaticFileReady = false;
  fileSaveAnnounced = false;
  if (trackerServer) {
    // With the file gone, the shared save on the tracker computer is the one on offer.
    automaticSaveBackend = 'server';
    setAutomaticFileStatus('Connect Desktop Save', 'Keep an automatic team save on the tracker computer.');
  } else {
    setAutomaticFileStatus('Connect Save File', 'Choose a JSON file to keep updated automatically.');
  }

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
        // another file, or the desktop save, was connected in the meantime
        if (automaticFileHandle || serverSaveState.linked) return;
        automaticSaveBackend = 'native';
        automaticFileHandle = handle;
        connectAutomaticSaveFile();
      }
    }
  });
}

const FILE_TYPES = [{
  description: 'Triangle Agency team data',
  accept: { 'application/json': ['.json'] }
}];

/**
 * Ask whether to connect a new save file or link an existing one. Resolves to
 * 'new', 'existing', or null when the dialog is dismissed.
 */
function askConnectMode() {
  return new Promise(resolve => {
    const body = document.createElement('p');
    body.className = 'modal-message';
    body.textContent = 'A new file starts from the agents currently on screen. An existing file is loaded first, replacing what is on screen, and is then kept up to date.';
    let choice = null;
    openModal({
      title: 'Connect save file',
      content: body,
      closeLabel: 'Cancel',
      actions: [
        { label: 'Open Existing File', onClick: () => { choice = 'existing'; } },
        { label: 'Create New File', variant: 'primary', onClick: () => { choice = 'new'; } }
      ],
      onClose: () => resolve(choice)
    });
  });
}

/**
 * Link an existing save file: its contents are imported before any write, so connecting
 * never destroys a team. An empty file is treated as a new one.
 */
async function linkExistingSaveFile() {
  const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });

  // Opening grants read access; writing needs readwrite, which is asked for while the
  // click that opened the picker still counts as a user gesture.
  if (await handle.queryPermission({ mode: 'readwrite' }) !== 'granted'
    && await handle.requestPermission({ mode: 'readwrite' }) !== 'granted') {
    toast('That file can be read but not updated. Grant write permission to keep it in sync.', { kind: 'warn', duration: 6000 });
    return false;
  }

  let data;
  try {
    data = await readSettingsFromHandle(handle);
  } catch (error) {
    console.error('Failed to read the selected save file', error);
    toast(`${handle.name} is not a readable team save file. Nothing was changed.`, { kind: 'error', duration: 7000 });
    return false;
  }

  automaticFileHandle = handle;
  automaticFileReady = true;
  await rememberFileHandle(handle);

  // Empty file: nothing to import, so it behaves like a newly created one.
  if (!data) {
    await writeSettingsToAutomaticFile();
    return true;
  }

  const importConfirmed = await confirmDialog({
    title: `Load ${handle.name}?`,
    message: `This file holds ${describeSettings(data)}. Loading it replaces the agents currently on screen, then keeps the file updated. Export a Team CV first if you need the current team.`,
    confirmLabel: 'Load File'
  });

  if (!importConfirmed) {
    // Keep it linked but don't write: the user declined replacing the on-screen team, and
    // writing now would overwrite the file they just chose to keep.
    automaticFileReady = false;
    warnFileNotSyncing(`${handle.name} is linked but not being updated. Reconnect it to start saving to it.`);
    return false;
  }

  showAutomaticFileOn(handle);
  adoptSettings(data);
  return true;
}

/** Create or overwrite a save file, seeded with the state currently on screen. */
async function createNewSaveFile() {
  automaticFileHandle = await window.showSaveFilePicker({
    suggestedName: 'triangle-agency-team.json',
    types: FILE_TYPES
  });
  automaticFileReady = true;
  await rememberFileHandle(automaticFileHandle);
  await writeSettingsToAutomaticFile();
  return true;
}

/**
 * The save-file button: reconnects a remembered file, otherwise asks whether to create a
 * new one (seeded from the current state) or open an existing one (imported first).
 * While saving, it unlinks instead.
 */
export async function connectAutomaticSaveFile() {
  if (automaticSaveBackend === 'server') return connectServerSave();
  if (!('showSaveFilePicker' in window) || !('showOpenFilePicker' in window)) return false;

  if (automaticFileReady) {
    await unlinkAutomaticSaveFile();
    return false;
  }

  try {
    // A file we already know: restoring permission is enough, and the state in this browser
    // is the newer one (it was kept while the file was unreachable), so it is written out.
    if (automaticFileHandle) {
      automaticFileReady = await automaticFileHandle.requestPermission({ mode: 'readwrite' }) === 'granted';
      if (automaticFileReady) {
        await rememberFileHandle(automaticFileHandle);
        await writeSettingsToAutomaticFile();
      }
      return automaticFileReady;
    }

    const mode = await askConnectMode();
    if (!mode) return false;
    return mode === 'existing' ? await linkExistingSaveFile() : await createNewSaveFile();
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
    if (automaticSaveBackend === 'server' && serverSaveState.linked) {
      serverSaveState.dirty = true;
      storeServerSaveState();
    }
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
