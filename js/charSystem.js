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

/**
 * syncBack - keep the back face in visual parity (tints / top classes / dead) with the main .char element
 */
function syncBack(c) {
  if (!c) return;
  const back = c.querySelector('.backFace');
  if (!back) return;
  // copy only relevant classes so we don't duplicate structural classes
  const relevant = [MERIT_TINT, DEMERIT_TINT, 'star', 'tilt', 'crooked', 'top-merit', 'top-demerit', 'dead'];
  back.className = 'backFace'; // reset
  relevant.forEach(cl => { if (c.classList.contains(cl)) back.classList.add(cl); });
}

export function updateTint(c) {
  if(!c) return;
  const m = parseInt(c.querySelector('.triangle')?.textContent) || 0;
  const d = parseInt(c.querySelector('.triangle-down')?.textContent) || 0;
  c.classList.remove(MERIT_TINT, DEMERIT_TINT);
  if (m > d) c.classList.add(MERIT_TINT);
  else if (d > m) c.classList.add(DEMERIT_TINT);
  syncBack(c);
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
  if (data?.dead) c.classList.add('dead');

  // remove button
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'X';
  removeBtn.className = 'remove-btn';
  removeBtn.onclick = () => { c.remove(); saveSettings(); updateTopCharacters(); };

  // image
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

  // stats
  const stats = ['name','anomaly','reality','competency'];
  const root = getComputedStyle(document.documentElement);
  const colorVars = {
    'competency': root.getPropertyValue('--competency-color').trim(),
    'reality':    root.getPropertyValue('--reality-color').trim(),
    'anomaly':    root.getPropertyValue('--anomaly-color').trim()
  };

  const statDivs = stats.map((s,i) => {
    const div = document.createElement('div'); div.className = 'stat';
    const label = document.createElement('span'); label.className = 'label'; label.textContent = s.toUpperCase();
    const value = document.createElement('input'); value.className = 'value'; value.value = data?.[s] || ''; value.style.width = '80px';
    value.addEventListener('input', () => saveSettings());
    if (colorVars[s]) {
      label.style.color = colorVars[s];
      value.style.color = colorVars[s];
    }
    div.append(label, value);
    return div;
  });

  // triangles & counters
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

  // death UI
  const deathBtn = document.createElement('button');
  deathBtn.className = 'death-btn'; deathBtn.textContent='✖'; deathBtn.title='Toggle death state';
  const deathOverlay = document.createElement('div'); deathOverlay.className='death-overlay'; deathOverlay.textContent='SICK LEAVE';
  deathBtn.onclick = () => {
    c.classList.toggle('dead');
    const isNowDead = c.classList.contains('dead');
    playSfx(isNowDead ? './audio/flatline.mp3' : ['./audio/ufo.mp3','./audio/cash.mp3'] , 'sequence');
    saveSettings();
    updateTopCharacters();
  };

  // flip button (small) - toggles flipped class on character
  const flipBtn = document.createElement('button');
  flipBtn.className = 'flip-btn';
  flipBtn.textContent = '↻';
  flipBtn.title = 'Flip card';
  flipBtn.onclick = () => { c.classList.toggle('flipped'); };

  // Back face - contains Prime Directive (debit/demerit) and Encouraged Behavior (credit/merit)
  const backFace = document.createElement('div');
  backFace.className = 'backFace';
  backFace.setAttribute('aria-hidden','true');

  // helper to create a subbox with button + editable text
  function makeBackSub({ key, labelText, triggersMerit }) {
    const container = document.createElement('div');
    container.className = `back-subbox ${triggersMerit ? 'encouraged' : 'prime'}`;

    const btn = document.createElement('button');
    btn.className = 'back-action-btn';
    btn.textContent = labelText;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      // trigger corresponding triangle increment: prime => demerit (triggersMerit=false), encouraged => merit (triggersMerit=true)
      const target = c.querySelector(triggersMerit ? '.triangle' : '.triangle-down');
      const n = parseInt(target.textContent) || 0;
      target.textContent = n + 1;
      animateTriangle(target);
      updateTint(c);
      saveSettings();
      updateTopCharacters();
      playSfx(triggersMerit ? 'audio/merit.mp3' : 'audio/demerit.mp3');
      document.dispatchEvent(new CustomEvent('triangle-action', { detail: { type: triggersMerit ? 'merit' : 'demerit', element: target, source: key } }));
    });

    // editable text area
    const textWrap = document.createElement('div');
    textWrap.className = 'back-textwrap';
    const ta = document.createElement('textarea');
    ta.className = `back-text ${key}`;
    ta.rows = 3;
    ta.value = (data && data[key]) ? data[key] : '';
    ta.addEventListener('input', () => {
      // mirror to dataset so storage implementations that read dataset can pick it up; also call saveSettings()
      c.dataset[key] = ta.value;
      saveSettings();
    });

    // ensure initial dataset present
    if ((data && data[key]) || ta.value) c.dataset[key] = ta.value;

    textWrap.appendChild(ta);
    container.append(btn, textWrap);
    return container;
  }

  const primeBox = makeBackSub({ key: 'primeDirective', labelText: 'PRIME DIRECTIVE', triggersMerit: false });
  const encouragedBox = makeBackSub({ key: 'encouragedBehavior', labelText: 'ENCOURAGED BEHAVIOR', triggersMerit: true });

  // assemble back face
  backFace.append(primeBox, encouragedBox);

  // append everything to the char
  // structure: char contains controls and content; backFace sits along-side front content and is shown/hidden via CSS using .flipped
  c.append(removeBtn, flipBtn, img, ...statDivs, trackerRow, deathOverlay, deathBtn, backFace);

  // set initial values for backFace copy of tint/top classes
  syncBack(c);

  // ensure that when triangles change elsewhere we keep back in sync (e.g., through external calls)
  // already handled by updateTint / updateTopCharacters, but ensure a final sync and save
  saveSettings();
  updateTopCharacters();

  charContainer.appendChild(c);
}

/**
 * updateTopCharacters - find top single merit/demerit and apply visual overlays.
 */
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
    syncBack(c);
  });
}

export function resetChar() {
  document.querySelectorAll('.char').forEach(c => {
    const tri = c.querySelector('.triangle');
    const dtri = c.querySelector('.triangle-down');
    if (tri) tri.textContent='0';
    if (dtri) dtri.textContent='0';
    const mc = c.querySelector('.counter-input.merit'); if (mc) mc.value='0';
    const dc = c.querySelector('.counter-input.demerit'); if (dc) dc.value='0';
    c.classList.remove(MERIT_TINT,DEMERIT_TINT,'star','tilt');
    c.querySelectorAll('.thumb').forEach(t=>t.remove());
    c.classList.remove('dead');
    c.querySelectorAll('.stat input').forEach(input => input.value = '');
    const img = c.querySelector('img');
    if (img) img.src = './images/pfp.jpg';
    // clear back textboxes and dataset
    const prime = c.querySelector('.back-text.primeDirective');
    const encouraged = c.querySelector('.back-text.encouragedBehavior');
    if (prime) { prime.value = ''; }
    if (encouraged) { encouraged.value = ''; }
    delete c.dataset.primeDirective;
    delete c.dataset.encouragedBehavior;
    // remove flipped state
    c.classList.remove('flipped');
    syncBack(c);
  });
  saveSettings();
  updateTopCharacters();
}
