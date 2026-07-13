import { addChar, resetChar, updateTopCharacters } from './charSystem.js';
import { initDashboard, resetDashboard } from './dashboard.js';
import {
  loadCharacterFile,
  loadSettings,
  loadSettingsFile,
  saveCharacterToFile,
  saveSettings,
  saveSettingsFile
} from './storage.js';
import { initTaskPanel, resetTasks } from './tasks.js';
import { initWorld, setWorldData, updateEffects } from './world.js';

function resetAll() {
  resetChar();
  resetTasks();
  setWorldData();
  resetDashboard();
  saveSettings();
}

function exportCharacter() {
  const characters = [...document.querySelectorAll('.char')];
  if (!characters.length) {
    alert('No agents available to save.');
    return;
  }

  const selection = prompt(
    `Which agent do you want to export?\n\n${characters
      .map((character, index) => {
        const name = character.querySelector('.stat input')?.value || 'Unnamed Agent';
        return `${index + 1}. ${name}`;
      })
      .join('\n')}\n\nEnter number:`
  );

  if (!selection) return;

  const index = Number.parseInt(selection, 10) - 1;
  if (!Number.isInteger(index) || !characters[index]) {
    alert('Invalid selection.');
    return;
  }

  saveCharacterToFile(characters[index]);
}

function bindControls() {
  document.getElementById('addAgentButton').addEventListener('click', () => addChar());
  document.getElementById('loadAgentButton').addEventListener('click', () => loadCharacterFile(addChar));
  document.getElementById('exportAgentButton').addEventListener('click', exportCharacter);
  document.getElementById('resetButton').addEventListener('click', resetAll);
  document.getElementById('loadTeamButton').addEventListener('click', loadSettingsFile);
  document.getElementById('exportTeamButton').addEventListener('click', () => saveSettingsFile());
  document.getElementById('branchName').addEventListener('input', saveSettings);
}

function init() {
  bindControls();
  initWorld();

  const saved = loadSettings();
  saved?.chars?.forEach(character => addChar(character));
  setWorldData(saved?.world);
  updateTopCharacters();
  updateEffects();
  initTaskPanel({ containerId: 'taskPanel' });
  initDashboard();

  saveSettings();
}

init();
