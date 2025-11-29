// charSystem.js
// Responsibilities: create & mutate character DOM, triangles, top-character logic, reset

import { saveSettings } from './storage.js';
import { playSfx } from './soundEffects.js';

export function createTriangle(isMerit) {
  const t = document.createElement('div');
  t.className = isMerit ? 'triangle' : 'triangle-down';
  t.textContent = '0';
  t.dataset.type = isMerit ? 'merit' : 'demerit';

  const charBox = () => t.closest('.char');
  const applyEffects = () => { updateTint(charBox()); saveSettings(); updateTopCharacters(); };

  t.addEventListener('click', () => {
    const n = parseInt(t.textContent) || 0;
    t.textContent = n + 1;
    animateTriangle(t);
    applyEffects();
    playSfx(isMerit ? 'audio/merit.mp3' : 'audio/demerit.mp3');
	document.dispatchEvent(new CustomEvent('triangle-action', { detail: { type: isMerit ? 'merit' : 'demerit', element: t } }));
  });

  t.addEventListener('contextmenu', e => {
    e.preventDefault();
    const n = parseInt(t.textContent) || 0;
    t.textContent = Math.max(0, n - 1);
    applyEffects();
  });

  return t;
}

export function animateTriangle(el) { el.classList.remove('animate'); void el.offsetWidth; el.classList.add('animate'); }

export const MERIT_TINT = 'merit';
export const DEMERIT_TINT = 'demerit';

export function updateTint(c) {
  if(!c) return;
  const m = parseInt(c.querySelector('.triangle')?.textContent) || 0;
  const d = parseInt(c.querySelector('.triangle-down')?.textContent) || 0;
  c.classList.remove(MERIT_TINT, DEMERIT_TINT);
  if (m > d) c.classList.add(MERIT_TINT);
  else if (d > m) c.classList.add(DEMERIT_TINT);
}

// addChar expects a global charContainer in DOM
export function addChar(data = {}) {
  const charContainer = document.getElementById('charContainer');
  if(!charContainer) throw new Error('charContainer element not found');

  const MAX_CHARS = 41;
  const currentCount = charContainer.querySelectorAll('.char').length;
  if (currentCount >= MAX_CHARS) return;

  const c = document.createElement('div');
  c.className = 'char';

  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'X';
  removeBtn.className = 'remove-btn';
  removeBtn.onclick = () => { c.remove(); saveSettings(); updateTopCharacters(); };

  const img = document.createElement('img');
img.src = (data?.icon && data.icon !== '') ? data.icon : './images/pfp.jpg';
  img.ondragover = e => e.preventDefault();
  img.ondrop = e => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.type?.startsWith('image')) {
      const reader = new FileReader();
      reader.onload = () => { img.src = reader.result; saveSettings(); };
      reader.readAsDataURL(f);
    }
  };


  const stats = ['name','anomaly','reality','competency'];
  const root = getComputedStyle(document.documentElement);
	const colorVars = {
	  'competency': root.getPropertyValue('--competency-color').trim(),
	  'reality':    root.getPropertyValue('--reality-color').trim(),
	  'anomaly':    root.getPropertyValue('--anomaly-color').trim()
	};
	
  const statDivs = stats.map((s,i) => {
    const div = document.createElement('div'); div.className = 'stat';
    const label = document.createElement('span'); label.className = 'label'; label.textContent = s.toUpperCase();//s.charAt(0).toUpperCase() + s.slice(1);
    // color mapping is optional; access CSS variables if you want
    const value = document.createElement('input'); value.className = 'value'; value.value = data?.[s] || ''; value.style.width = '80px';
    div.append(label, value);
	 if (colorVars[s]) {
    label.style.color = colorVars[s];
    value.style.color = colorVars[s];
  }
  div.append(label, value);
    return div;
  });

  const merit = createTriangle(true);
  const demerit = createTriangle(false);
  if (data) { merit.textContent = data.merit || 0; demerit.textContent = data.demerit || 0; }

  const meritCounter = document.createElement('input');
  meritCounter.className = 'counter-input merit';
  meritCounter.type = 'number';
  meritCounter.value = data?.sessionMerit || 0;
  meritCounter.addEventListener('input', () => saveSettings());

  const demeritCounter = document.createElement('input');
  demeritCounter.className = 'counter-input demerit';
  demeritCounter.type = 'number';
  demeritCounter.value = data?.sessionDemerit || 0;
  demeritCounter.addEventListener('input', () => saveSettings());

  const trackerRow = document.createElement('div'); trackerRow.className = 'tracker-row';
  trackerRow.append(merit, meritCounter, demerit, demeritCounter);

  c.append(removeBtn, img, ...statDivs, trackerRow);

  // death UI
  const deathBtn = document.createElement('button');
  deathBtn.className = 'death-btn'; deathBtn.textContent='✖'; deathBtn.title='Toggle death state';
  const deathOverlay = document.createElement('div'); deathOverlay.className='death-overlay'; deathOverlay.textContent='SICK LEAVE';
  deathBtn.onclick = () => c.classList.toggle('dead');
  c.append(deathOverlay, deathBtn);

  charContainer.appendChild(c);
  saveSettings();
  updateTopCharacters();
}

export function updateTopCharacters() {
  const chars = [...document.querySelectorAll('.char')];
  let maxMerit = -1, maxDemerit = -1, meritCount = 0, demeritCount = 0;

  chars.forEach(c => {
    const m = parseInt(c.querySelector('.triangle')?.textContent) || 0;
    const d = parseInt(c.querySelector('.triangle-down')?.textContent) || 0;
    if (m > maxMerit) { maxMerit = m; meritCount = 1; } else if (m === maxMerit) meritCount++;
    if (d > maxDemerit) { maxDemerit = d; demeritCount = 1; } else if (d === maxDemerit) demeritCount++;
  });

  // clear
  chars.forEach(c => {
    c.classList.remove('star','tilt','crooked','top-merit','top-demerit');
    c.querySelectorAll('.thumb').forEach(t => t.remove());
    c.querySelectorAll('.shine-overlay, .broken-overlay, .vignette-overlay').forEach(e => e.remove());
  });

  // apply
  chars.forEach(c => {
    const m = parseInt(c.querySelector('.triangle')?.textContent) || 0;
    const d = parseInt(c.querySelector('.triangle-down')?.textContent) || 0;

    if (m === maxMerit && meritCount === 1 && maxMerit > 0) {
      c.classList.add('star','top-merit');
      const thumb = document.createElement('div'); thumb.className='thumb'; thumb.textContent='👍'; c.appendChild(thumb);
      if (!c.querySelector('.shine-overlay')) { const s=document.createElement('div'); s.className='shine-overlay'; s.setAttribute('aria-hidden','true'); c.appendChild(s); }
    }

    if (d === maxDemerit && demeritCount === 1 && maxDemerit > 0) {
      c.classList.add('tilt','top-demerit','crooked');
      if (!c.querySelector('.vignette-overlay')){ const v=document.createElement('div'); v.className='vignette-overlay'; v.setAttribute('aria-hidden','true'); c.appendChild(v); }
    }

    updateTint(c);
  });
}

export function resetChar() {
  document.querySelectorAll('.char').forEach(c => {
    c.querySelector('.triangle').textContent='0';
    c.querySelector('.triangle-down').textContent='0';
	c.querySelector('.counter-input.merit').value='0';
	c.querySelector('.counter-input.demerit').value='0';
    c.classList.remove(MERIT_TINT,DEMERIT_TINT,'star','tilt');
    c.querySelectorAll('.thumb').forEach(t=>t.remove());
	
    c.querySelectorAll('.stat input').forEach(input => input.value = '');
    const img = c.querySelector('img');
	img.src = './images/pfp.jpg';
  });
  saveSettings();
  updateTopCharacters();
}
