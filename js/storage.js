// storage.js
// save/load settings for chars + world

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
		dead: c.classList.contains('dead') //
      };
    });

    const branchName = (document.getElementById('branchName')?.value || 0);
    const witness = Number(document.getElementById('witnessCounter')?.textContent || 0);
    const chaos = Number(document.getElementById('chaosCounter')?.textContent || 0);

    localStorage.setItem('rpgSettings', JSON.stringify({ chars, world: { branchName, witness, chaos } }));
  } catch (err) {
    console.error('saveSettings failed', err);
  }
}

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


export function loadSettings() {
  const raw = localStorage.getItem('rpgSettings');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}



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
        localStorage.setItem('rpgSettings', JSON.stringify(data));
        console.log("Settings loaded from file:", data);
		loadSettings();
		location.reload();
      } catch (err) {
        console.error("Invalid JSON file", err);
      }
    };
    reader.readAsText(file);
  };

  input.click();
  
  
}

