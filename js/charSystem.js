// charSystem.js
// Responsibilities: create & mutate character DOM, triangles, top-character logic, reset

import { saveCharacterToFile, saveSettings } from './storage.js';
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

  const MAX_CHARS = 5;
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

  const statDivs = stats.map(s => {
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

  // dashboard indicators: net score + compact merit/demerit activity meter
  const netIndicator = document.createElement('div');
  netIndicator.className = 'net-indicator';
  netIndicator.textContent = '▬ 0';

  const activityMeter = document.createElement('div');
  activityMeter.className = 'activity-meter';
  activityMeter.setAttribute('aria-hidden', 'true');
  const meritFill = document.createElement('div'); meritFill.className = 'activity-fill merit';
  const demeritFill = document.createElement('div'); demeritFill.className = 'activity-fill demerit';
  activityMeter.append(meritFill, demeritFill);

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
  c.append(removeBtn, flipBtn, img, ...statDivs, trackerRow, activityMeter, netIndicator, deathOverlay, deathBtn, backFace);

  // set initial values for backFace copy of tint/top classes
  syncBack(c);
  
  
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-btn';
  exportBtn.type = 'button';
  exportBtn.title = 'Export agent';
  exportBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (!saveCharacterToFile(c)) alert('Failed to export agent');
  });
  c.appendChild(exportBtn);

  // Persistence reads cards from the document, so append before saving.
  charContainer.appendChild(c);
  saveSettings();
  updateTopCharacters();
}

/**
 * getAgentStats - read merit/demerit/net for every agent card and flag the
 * unique top-merit, top-demerit and best-net-score agents (ties highlight no one,
 * matching the original single-winner behavior). Shared by updateTopCharacters()
 * and the dashboard panels so both use the exact same "who's winning" logic.
 */
export function getAgentStats() {
  const chars = [...document.querySelectorAll('.char')];
  const stats = chars.map(el => {
    const merit = parseInt(el.querySelector('.triangle')?.textContent) || 0;
    const demerit = parseInt(el.querySelector('.triangle-down')?.textContent) || 0;
    const name = el.querySelector('.stat input')?.value || '';
    return { el, name, merit, demerit, net: merit - demerit, dead: el.classList.contains('dead') };
  });

  let maxMerit = -1, maxDemerit = -1, maxNet = -Infinity;
  let meritCount = 0, demeritCount = 0, netCount = 0;
  stats.forEach(s => {
    if (s.merit > maxMerit) { maxMerit = s.merit; meritCount = 1; } else if (s.merit === maxMerit) meritCount++;
    if (s.demerit > maxDemerit) { maxDemerit = s.demerit; demeritCount = 1; } else if (s.demerit === maxDemerit) demeritCount++;
    if (s.net > maxNet) { maxNet = s.net; netCount = 1; } else if (s.net === maxNet) netCount++;
  });

  stats.forEach(s => {
    s.isTopMerit = s.merit === maxMerit && meritCount === 1 && maxMerit > 0;
    s.isTopDemerit = s.demerit === maxDemerit && demeritCount === 1 && maxDemerit > 0;
    s.isTopNet = s.net === maxNet && netCount === 1 && stats.length > 1;
  });

  return stats;
}

/**
 * updateTopCharacters - find top single merit/demerit/net and apply visual overlays.
 */
export function updateTopCharacters() {
  const stats = getAgentStats();

  // clear
  stats.forEach(({ el }) => {
    el.classList.remove('star','tilt','crooked','top-merit','top-demerit');
    el.querySelectorAll('.thumb').forEach(t => t.remove());
    el.querySelectorAll('.shine-overlay, .broken-overlay, .vignette-overlay, .warning-badge').forEach(e => e.remove());
  });

  // apply
  stats.forEach(s => {
    const { el, merit, demerit, net, isTopMerit, isTopDemerit, isTopNet } = s;

    if (isTopMerit) {
      el.classList.add('star','top-merit');
      const thumb = document.createElement('div'); thumb.className='thumb'; thumb.textContent='👑'; el.appendChild(thumb);
      if (!el.querySelector('.shine-overlay')) { const sh=document.createElement('div'); sh.className='shine-overlay'; sh.setAttribute('aria-hidden','true'); el.appendChild(sh); }
    }

    if (isTopDemerit) {
      el.classList.add('tilt','top-demerit','crooked');
      if (!el.querySelector('.vignette-overlay')){ const v=document.createElement('div'); v.className='vignette-overlay'; v.setAttribute('aria-hidden','true'); el.appendChild(v); }
      const warn = document.createElement('div'); warn.className='warning-badge'; warn.textContent='⚠️'; warn.setAttribute('aria-hidden','true'); el.appendChild(warn);
    }

    const netEl = el.querySelector('.net-indicator');
    if (netEl) {
      const symbol = net > 0 ? '▲' : net < 0 ? '▼' : '▬';
      netEl.textContent = `${symbol} ${net > 0 ? '+' : ''}${net}`;
      netEl.classList.toggle('top-net', !!isTopNet);
    }

    const meritFill = el.querySelector('.activity-fill.merit');
    const demeritFill = el.querySelector('.activity-fill.demerit');
    if (meritFill && demeritFill) {
      const total = merit + demerit || 1;
      meritFill.style.width = `${(merit / total) * 100}%`;
      demeritFill.style.width = `${(demerit / total) * 100}%`;
    }

    updateTint(el);
    syncBack(el);
  });

  document.dispatchEvent(new CustomEvent('dashboard-refresh'));
}
export function resetChar() {
  document.querySelectorAll('.char').forEach(c => c.remove());
  saveSettings();
  updateTopCharacters();
}

