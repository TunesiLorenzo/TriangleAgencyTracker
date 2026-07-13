const STORAGE_KEY = 'rpgSettings';

function getCharacterData(character) {
  const inputs = character.querySelectorAll('.stat input');
  return {
    name: inputs[0]?.value || '',
    anomaly: inputs[1]?.value || '',
    reality: inputs[2]?.value || '',
    competency: inputs[3]?.value || '',
    merit: Number.parseInt(character.querySelector('.triangle')?.textContent, 10) || 0,
    demerit: Number.parseInt(character.querySelector('.triangle-down')?.textContent, 10) || 0,
    sessionMerit: Number.parseInt(character.querySelector('.counter-input.merit')?.value, 10) || 0,
    sessionDemerit: Number.parseInt(character.querySelector('.counter-input.demerit')?.value, 10) || 0,
    icon: character.querySelector('img')?.src || '',
    dead: character.classList.contains('dead'),
    primeDirective: character.dataset.primeDirective || '',
    encouragedBehavior: character.dataset.encouragedBehavior || ''
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
        alert(invalidMessage);
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

export function saveSettings() {
  try {
    const chars = [...document.querySelectorAll('.char')].map(getCharacterData);
    const previous = loadSettings() || {};
    const previousWorld = previous.world && typeof previous.world === 'object' ? previous.world : {};
    const world = {
      ...previousWorld,
      branchName: document.getElementById('branchName')?.value ?? '',
      witness: Number(document.getElementById('witnessCounter')?.textContent || 0),
      chaos: Number(document.getElementById('chaosCounter')?.textContent || 0)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...previous, chars, world }));
  } catch (error) {
    console.error('Failed to save settings', error);
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
