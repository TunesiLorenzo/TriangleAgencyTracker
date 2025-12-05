
import {updateTopCharacters} from './charSystem.js'

export function saveSettingsFile(filename) {
  const raw = localStorage.getItem('rpgSettings') || '{}';
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
  const safeName = filename || `rpgSettings-${stamp}.json`;

  try {
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // allow freeing the blob URL
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error('exportSettingsToFile failed', err);
    return false;
  }
}

// storage.js (patch)

// keep your existing exports/imports above...

// Helper: read current saved object (safe default)
export function loadSettings() {
  const raw = localStorage.getItem('rpgSettings');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

// Replace saveSettings with this merged version
export function saveSettings() {
  try {
    const chars = [...document.querySelectorAll('.char')].map(c => {
      const inputs = c.querySelectorAll('.stat input');
      return {
        name: inputs[0]?.value || '',
        anomaly: inputs[1]?.value || '',
        reality: inputs[2]?.value || '',
        competency: inputs[3]?.value || '',
        merit: parseInt(c.querySelector('.triangle')?.textContent) || 0,
        demerit: parseInt(c.querySelector('.triangle-down')?.textContent) || 0,
        sessionMerit: parseInt(c.querySelector('.counter-input.merit')?.value) || 0,
        sessionDemerit: parseInt(c.querySelector('.counter-input.demerit')?.value) || 0,
        icon: c.querySelector('img')?.src || '',
        dead: c.classList.contains('dead'),
        // SAVE back-face contents
        primeDirective: c.dataset.primeDirective || '',
        encouragedBehavior: c.dataset.encouragedBehavior || ''
      };
    });

    // gather world values from the page
    const branchName = document.getElementById('branchName')?.value ?? '';
    const witness = Number(document.getElementById('witnessCounter')?.textContent || 0);
    const chaos = Number(document.getElementById('chaosCounter')?.textContent || 0);

    // preserve previously-saved world fields (like tasks) by merging
    const existing = loadSettings() || {};
    const existingWorld = existing.world && typeof existing.world === 'object' ? existing.world : {};

    const newWorld = {
      ...existingWorld,
      branchName,
      witness,
      chaos
    };

    const saveObj = { ...existing, chars, world: newWorld };
    localStorage.setItem('rpgSettings', JSON.stringify(saveObj));
  } catch (err) {
    console.error('saveSettings failed', err);
  }
}

// Replace loadSettingsFile with this improved version that applies the data if possible
export function loadSettingsFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';

  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = JSON.parse(event.target.result);

        // Basic validation: ensure it's an object with at least world or chars
        if (typeof data !== 'object' || data === null) {
          throw new Error('Invalid settings file');
        }

        // Write the file content directly to localStorage
        localStorage.setItem('rpgSettings', JSON.stringify(data));
        console.log("Settings loaded from file:", data);

        // Try to apply without reloading if you have an apply function
        // This keeps UX smoother. If not present, reload the page.
        // applySettingsToDOM is optional — your project may implement something like it.
        if (typeof window.applySettingsToDOM === 'function') {
          try {
            // call your app-level function to re-populate the UI
            window.applySettingsToDOM(data);
          } catch (e) {
            console.warn('applySettingsToDOM failed, reloading instead', e);
            location.reload();
          }
        } else {
          // no apply function available — reload so startup code reads storage
          location.reload();
        }
      } catch (err) {
        console.error("Invalid JSON file", err);
        alert('Failed to load settings file: invalid JSON or structure.');
      }
    };
    reader.readAsText(file);
  };

  input.click();
}

// -------------------------------
// SAVE A SINGLE CHARACTER TO FILE
// -------------------------------
export function saveCharacterToFile(charElement, filename) {
  try {
    const inputs = charElement.querySelectorAll('.stat input');
    const charObj = {
      name: inputs[0]?.value || '',
      anomaly: inputs[1]?.value || '',
      reality: inputs[2]?.value || '',
      competency: inputs[3]?.value || '',
      merit: parseInt(charElement.querySelector('.triangle')?.textContent) || 0,
      demerit: parseInt(charElement.querySelector('.triangle-down')?.textContent) || 0,
      sessionMerit: parseInt(charElement.querySelector('.counter-input.merit')?.value) || 0,
      sessionDemerit: parseInt(charElement.querySelector('.counter-input.demerit')?.value) || 0,
      icon: charElement.querySelector('img')?.src || '',
      tint: charElement.dataset.tint || "",
      dead: charElement.classList.contains('dead'),
      primeDirective: charElement.dataset.primeDirective || '',
      encouragedBehavior: charElement.dataset.encouragedBehavior || ''
    };

    const wrapper = {
      meta: { kind: "single-agent", version: 1, created: new Date().toISOString() },
      char: charObj
    };

    const safeName = filename || `${(charObj.name || "agent").replace(/\s+/g, "_")}.agent.json`;

    const blob = new Blob([JSON.stringify(wrapper, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);

    return true;
  } catch (err) {
    console.error("saveCharacterToFile error", err);
    return false;
  }
}


// -------------------------------
// LOAD A SINGLE CHARACTER FILE
// -------------------------------
export function loadCharacterFile() {
  const input = document.createElement('input');
  input.type = "file";
  input.accept = ".json,application/json";

  input.onchange = e => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      try {
        const data = JSON.parse(event.target.result);

        if (!data || (data.type !== "single-agent" && !data.char)) {
          alert("Invalid Agent file");
          return;
        }

        const charData = data.char || data;

        if (typeof window.addChar === "function") {
          // create the new character in DOM
          window.addChar(charData);

          // persist current DOM state (this function must be available in the same module)
          if (typeof saveSettings === "function") {
            try {
              saveSettings();
            } catch (err) {
              console.warn("saveSettings threw an error after import:", err);
            }
          } else {
            // if saveSettings isn't in this module, try to call it from window (if exported there)
            if (typeof window.saveSettings === "function") {
              try { window.saveSettings(); } catch (err) { console.warn(err); }
            }
          }

          // reload so your normal startup reads from storage and fully initializes
          // (this prevents any subtle differences between runtime-added DOM and load-time initialization)
          updateTopCharacters();
        } else {
          alert("addChar() not found!");
        }

      } catch (err) {
        console.error("Invalid Agent file", err);
        alert("Invalid Agent file");
      }
    };

    reader.readAsText(file);
  };

  input.click();
}

