import { addChar, chooseAgent, getAgentStats, getCharElements, resetChar, updateTopCharacters } from './charSystem.js';
import { initDashboard, resetDashboard } from './dashboard.js';
import {
  connectAutomaticSaveFile,
  initAutomaticFileSave,
  initLocalStorage,
  loadCharacterFile,
  loadSettings,
  loadSettingsFile,
  saveCharacterToFile,
  saveSettings,
  saveSettingsFile,
  setCaseArchiveSource,
  syncCaseArchive
} from './storage.js';
import { initTaskPanel, resetTasks } from './tasks.js';
import { isServerAvailable, startConfigSync } from './config.js';
import { initRelationships, renderRelationships } from './relationships.js';
import { initAnomalies, renderAnomalies } from './anomalies.js';
import { awardMissionDistinctions, initAgency, renderAgency, resetAgency } from './agency.js';
import { closePreviousCases, exportCaseArchive, importCaseArchive, initPreviousCases, renderPreviousCases, setArchiveChangeHandler } from './previousCases.js';
import { initLogin, whenSignedIn } from './login.js';
import { initButtonSounds, initKeepAlive, isMuted, playEvent, setMuted } from './soundEffects.js';
import { confirmDialog, openModal, toast } from './ui.js';
import { finishMissionWorld, initWorld, setWorldData, updateEffects } from './world.js';
import { initMotionPreference } from './motion.js';

initMotionPreference();

const VIEW_KEY = 'ta-view';

/**
 * Ask how a team file's case archive should meet this machine's archive.
 * Resolves to 'merge', 'replace', or null to leave the local archive alone.
 */
function askCaseImportMode(incoming, local) {
  return new Promise(resolve => {
    const body = document.createElement('p');
    body.className = 'modal-message';
    body.textContent = local
      ? `The team file holds ${incoming} ${incoming === 1 ? 'case' : 'cases'} and this terminal has ${local}. Merging keeps what is filed here and adds the rest; replacing makes the archive match the team file. Scans stay on the terminal that filed them, so imported pages show a placeholder until the cases folder is copied across.`
      : `The team file holds ${incoming} ${incoming === 1 ? 'case' : 'cases'}. Scans stay on the terminal that filed them, so imported pages show a placeholder until the cases folder is copied across.`;
    let choice = null;
    openModal({
      title: 'Case archive',
      content: body,
      closeLabel: 'Skip',
      actions: [
        ...(local ? [{ label: 'Replace Archive', variant: 'danger', onClick: () => { choice = 'replace'; } }] : []),
        { label: local ? 'Merge' : 'Import Cases', variant: 'primary', onClick: () => { choice = 'merge'; } }
      ],
      onClose: () => resolve(choice)
    });
  });
}

/**
 * Bring the case archive in a loaded team file into this terminal's archive.
 *
 * The archive is server-side, so this runs after the agents are on screen and only when the
 * file actually carries cases. Nothing is imported without the user picking merge or replace.
 */
async function importCasesFromSettings(saved) {
  const incoming = Array.isArray(saved?.cases) ? saved.cases : [];
  if (!incoming.length || !isServerAvailable()) return;

  // Every case in the file is already filed here: nothing to ask about.
  const localCases = await exportCaseArchive();
  const localIds = new Set(localCases.map(entry => entry.id));
  if (incoming.every(entry => localIds.has(entry.id))) return;

  const mode = await askCaseImportMode(incoming.length, localCases.length);
  if (!mode) return;

  try {
    const { added, kept } = await importCaseArchive(incoming, mode);
    await renderPreviousCases();
    toast(added
      ? `Filed ${added} ${added === 1 ? 'case' : 'cases'} from the team file${kept ? `, kept ${kept} already here` : ''}.`
      : 'The case archive was already up to date.');
  } catch (error) {
    console.error('Failed to import the case archive', error);
    toast('The case archive could not be imported. The cases already here are unchanged.', { kind: 'error', duration: 6000 });
  }
}

let missionDialogOpen = false;

function nextMission() {
  if (missionDialogOpen) return;
  missionDialogOpen = true;
  let completed = false;
  const content = document.createElement('p');
  content.className = 'modal-message';
  content.textContent = 'How did the anomaly mission end? The selected outcome increases its counter, plays its assigned sound and triggers its configured room-light cue. Mission witnesses, merit, demerit and chaos are then carried forward or reset as usual.';
  openModal({
    title: 'Mission outcome',
    content,
    className: 'mission-modal',
    closeLabel: 'Annulla',
    actions: [
      ...[['Captured', 'captured'], ['Killed', 'killed'], ['Escaped', 'escaped']].map(([label, outcome]) => ({
        label,
        variant: outcome,
        onClick: () => {
          // Ignore additional clicks while the dialog plays its closing animation.
          if (completed) return;
          completed = true;
          // The Distinzioni go by this mission's triangles, so read them before they are reset.
          const stats = getAgentStats();
          const distinctions = {
            mvp: stats.find(agent => agent.isTopMerit)?.el ?? null,
            suspended: stats.find(agent => agent.isTopDemerit)?.el ?? null
          };
          resetTasks();
          getCharElements().forEach(character => {
            // Triangles track this mission; adjacent inputs hold global totals.
            [['.triangle', '.merit'], ['.triangle-down', '.demerit']].forEach(([missionSelector, totalSelector]) => {
              const mission = character.querySelector(missionSelector);
              const total = character.querySelector(`.counter-input${totalSelector}`);
              total.value = (Number.parseInt(total.value, 10) || 0) + (Number.parseInt(mission.textContent, 10) || 0);
              mission.textContent = 0;
            });
          });
          finishMissionWorld(outcome);
          playEvent(outcome);
          awardMissionDistinctions(distinctions);
          updateTopCharacters();
          resetDashboard();
          if (saveSettings()) toast(`Next mission ready. Anomalia: ${label}.`);
        }
      }))
    ],
    onClose: () => { missionDialogOpen = false; }
  });
}

async function resetAll() {
  const confirmed = await confirmDialog({
    title: 'Close Branch?',
    message: 'This removes every agent, task, witness, chaos point and the mission timeline, and puts the Agency items back to the standard kit with no MVP or Sospeso. Export a Team CV first if you want a backup.',
    confirmLabel: 'Close Branch',
    danger: true
  });
  if (!confirmed) return;

  resetChar();
  resetTasks();
  resetAgency();
  setWorldData();
  resetDashboard();
  saveSettings();
  toast('Branch closed. A fresh branch is ready.');
}

async function exportCharacter() {
  if (!getCharElements().length) {
    toast('No agents available to export.', { kind: 'warn' });
    return;
  }
  const character = await chooseAgent('Export Agent CV');
  if (character) saveCharacterToFile(character);
}

function bindControls() {
  document.getElementById('nextMissionButton').addEventListener('click', nextMission);
  document.getElementById('addAgentButton').addEventListener('click', () => addChar());
  document.getElementById('loadAgentButton').addEventListener('click', () => loadCharacterFile(addChar));
  document.getElementById('exportAgentButton').addEventListener('click', exportCharacter);
  document.getElementById('resetButton').addEventListener('click', resetAll);
  document.getElementById('loadTeamButton').addEventListener('click', loadSettingsFile);
  document.getElementById('exportTeamButton').addEventListener('click', () => saveSettingsFile());
  document.getElementById('autoSaveFileButton').addEventListener('click', connectAutomaticSaveFile);
  document.getElementById('branchName').addEventListener('input', saveSettings);

  const muteButton = document.getElementById('muteButton');
  const showMute = () => {
    muteButton.textContent = isMuted() ? '🔇 Sound off' : '🔊 Sound on';
    muteButton.setAttribute('aria-pressed', String(isMuted()));
  };
  muteButton.addEventListener('click', () => { setMuted(!isMuted()); showMute(); });
  showMute();
}

/** Main view tabs; the choice is remembered on this device. */
function initViewTabs() {
  const tabs = [...document.querySelectorAll('.view-tabs [role="tab"]')];
  let switching = false;
  const select = async (tab, { focus = false } = {}) => {
    if (switching) return;
    const selectedTab = tabs.find(item => item.getAttribute('aria-selected') === 'true');
    // Clicking Relationships while it is already open goes back from an agent's page to the overview.
    const reselected = tab.getAttribute('aria-selected') === 'true';
    if (selectedTab?.id === 'previousCasesTab' && tab !== selectedTab) {
      switching = true;
      try {
        await closePreviousCases();
      } finally {
        switching = false;
      }
    }
    tabs.forEach(t => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      t.tabIndex = selected ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    });
    // The branch panel, the graphs and Next Mission only show on the Agents tab (layout.css).
    document.body.dataset.view = tab.id;
    if (focus) tab.focus();
    if (tab.id === 'relationshipsTab') renderRelationships({ overview: reselected });
    if (tab.id === 'anomalyTab') renderAnomalies();
    if (tab.id === 'agencyTab') renderAgency();
    if (tab.id === 'previousCasesTab') renderPreviousCases();
    try { localStorage.setItem(VIEW_KEY, tab.id); } catch { /* storage unavailable */ }
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => { select(tab); });
    tab.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      select(tabs[(i + step + tabs.length) % tabs.length], { focus: true });
    });
  });

  let saved = null;
  try { saved = localStorage.getItem(VIEW_KEY); } catch { /* storage unavailable */ }
  select(tabs.find(tab => tab.id === saved) || tabs[0]);
}

async function init() {
  // Right-click is a tracker control on counters and tracks. Let those handlers run,
  // but do not open the browser's context menu over the tabletop display.
  document.addEventListener('contextmenu', event => event.preventDefault());

  // First: every load starts locked behind the login screen.
  initLogin();
  // Before the awaits, so a remembered tab is shown without first flashing the other one.
  initRelationships();
  initAnomalies();
  initAgency();
  initPreviousCases();
  initViewTabs();
  // Also before the awaits: a click while settings load should still wake the amp and click.
  initKeepAlive();
  initButtonSounds();

  // Sound and effect settings from /settings; defaults when served without the Flask app.
  await startConfigSync();
  if (!isServerAvailable()) document.getElementById('settingsLink').hidden = true;

  initLocalStorage();
  // On LAN HTTP this may load the desktop-hosted team save before anything is rendered.
  await initAutomaticFileSave(document.getElementById('autoSaveFileButton'));
  bindControls();
  initWorld();

  const saved = loadSettings();
  saved?.chars?.forEach((character, index) => addChar(character, { delay: index * 70 }));
  setWorldData(saved?.world);
  updateTopCharacters();
  updateEffects();
  initTaskPanel({ containerId: 'taskPanel' });
  initDashboard();

  saveSettings();

  // Cases live on the server, so they are handled after the rest of the state is on screen.
  setCaseArchiveSource(exportCaseArchive);
  // Any case filed, edited or deleted during the session goes into the save file too.
  setArchiveChangeHandler(() => { syncCaseArchive(); });
  if (isServerAvailable()) {
    // The merge-or-replace question would sit unseen behind the login screen.
    await whenSignedIn();
    await importCasesFromSettings(saved);
    // Keep the saved copy current, including cases filed only on this terminal.
    await syncCaseArchive();
  }
}

init();
