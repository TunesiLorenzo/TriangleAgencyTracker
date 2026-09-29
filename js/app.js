import { addChar, chooseAgent, getCharElements, resetChar, updateTopCharacters } from './charSystem.js';
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
  saveSettingsFile
} from './storage.js';
import { initTaskPanel, resetTasks } from './tasks.js';
import { isServerAvailable, startConfigSync } from './config.js';
import { isMuted, setMuted } from './soundEffects.js';
import { confirmDialog, toast } from './ui.js';
import { initWorld, setWorldData, updateEffects } from './world.js';

async function resetAll() {
  const confirmed = await confirmDialog({
    title: 'Close Branch?',
    message: 'This removes every agent, task, witness, chaos point and the mission timeline. Export a Team CV first if you want a backup.',
    confirmLabel: 'Close Branch',
    danger: true
  });
  if (!confirmed) return;

  resetChar();
  resetTasks();
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

async function init() {
  // Sound and effect settings from /settings; defaults when served without the Flask app.
  await startConfigSync();
  if (!isServerAvailable()) document.getElementById('settingsLink').hidden = true;

  initLocalStorage();
  initAutomaticFileSave(document.getElementById('autoSaveFileButton'));
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
}

init();
