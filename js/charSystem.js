// charSystem.js
// Responsibilities: create & mutate character DOM, triangles, top-character logic, reset

import { getCharacterData, saveCharacterToFile, saveSettings } from './storage.js';
import { playEvent } from './soundEffects.js';
import { COMPETENCIES } from './config.js';
import { confirmDialog, openModal, toast } from './ui.js';
import { COMPETENCY_INFO, competencyText, isGeneratedText } from './competencies.js';

export const MAX_CHARS = 5;
const PORTRAIT_SIZE = 256;          // px, longest side after downscaling
const MAX_INLINE_ICON = 150_000;    // data-URL length above which saved portraits are shrunk

/** Live agent cards (excludes cards playing their removal animation). */
export function getCharElements() {
  return [...document.querySelectorAll('.char:not(.leaving)')];
}

/** Downscale an image source to a small data URL so saves stay within storage quota. */
function downscaleImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, PORTRAIT_SIZE / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/webp', 0.85));
    };
    image.onerror = reject;
    image.src = src;
  });
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Competency dropdown. A value saved before the dropdown existed (free text)
 * that doesn't match a known competency is kept as an extra option.
 */
function createCompetencySelect(saved = '') {
  const select = document.createElement('select');
  const known = COMPETENCIES.find(name => name.toLowerCase() === String(saved).trim().toLowerCase());
  const options = ['', ...COMPETENCIES];
  if (saved && !known) options.push(saved);
  options.forEach(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name || '—';
    select.appendChild(option);
  });
  select.value = known || saved || '';
  return select;
}

function setBackText(card, textarea, text) {
  textarea.value = text;
  card.dataset[textarea.dataset.key] = text;
}

function fillCompetencyText(card, { onlyEmpty = false } = {}) {
  const name = getCompetency(card);
  if (!COMPETENCY_INFO[name]) return;
  card.querySelectorAll('.back-text').forEach(textarea => {
    if (onlyEmpty && textarea.value.trim()) return;
    setBackText(card, textarea, competencyText(name, textarea.dataset.key));
  });
}

async function applyCompetency(card) {
  const name = getCompetency(card);
  if (!COMPETENCY_INFO[name]) return;
  const hasCustomText = [...card.querySelectorAll('.back-text')]
    .some(textarea => !isGeneratedText(textarea.value, textarea.dataset.key));
  if (hasCustomText) {
    const replace = await confirmDialog({
      title: `Load ${name} text?`,
      message: `This agent's Prime Directive or Encouraged Behavior has custom text. Replace it with the ${name} text?`,
      confirmLabel: 'Replace'
    });
    if (!replace) return;
  }
  fillCompetencyText(card);
  saveSettings();
  toast(`${COMPETENCY_INFO[name].department}: Prime Directive and Encouraged Behavior loaded on the back of the card.`);
}

export function getCompetency(card) {
  return card?.querySelector('[data-stat="competency"]')?.value || '';
}

/** Add a one-shot animation class and clean it up when the animation finishes. */
function animateOnce(el, className, onDone) {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  const finish = event => {
    if (event.target !== el) return;
    el.classList.remove(className);
    el.removeEventListener('animationend', finish);
    onDone?.();
  };
  el.addEventListener('animationend', finish);
}

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
    playEvent(isMerit ? 'merit' : 'demerit');
    document.dispatchEvent(new CustomEvent('triangle-action', { detail: { type: isMerit ? 'merit' : 'demerit', element: t } }));
  });

  t.addEventListener('contextmenu', e => {
    e.preventDefault();
    const n = parseInt(t.textContent) || 0;
    const next = Math.max(0, n - 1);
    if (next === n) return;
    t.textContent = next;
    animateTriangle(t, 'down');
    playEvent('counterDown');
    applyEffects();
    document.dispatchEvent(new CustomEvent('triangle-action', {
      detail: { type: isMerit ? 'merit' : 'demerit', element: t, delta: -1 }
    }));
  });

  return t;
}

export function animateTriangle(el, direction = 'up') {
  el.classList.remove('animate', 'animate-down');
  void el.offsetWidth;
  el.classList.add(direction === 'down' ? 'animate-down' : 'animate');
}

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

/**
 * addChar - build an agent card and add it to #charContainer.
 * options.index inserts at a position (used by undo); options.delay staggers the entrance.
 * Returns false when the branch is already at capacity.
 */
export function addChar(data = {}, { index, animate = true, delay = 0 } = {}) {
  const charContainer = document.getElementById('charContainer');
  if(!charContainer) throw new Error('charContainer element not found');

  if (getCharElements().length >= MAX_CHARS) {
    toast(`Branch at capacity: ${MAX_CHARS} agents max. Remove one to hire another.`, { kind: 'warn' });
    return false;
  }

  const c = document.createElement('div');
  c.className = 'char';
  if (data?.dead) c.classList.add('dead');

  // remove button
  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'X';
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Remove agent';
  removeBtn.onclick = () => removeChar(c);

  // image: drop a file on it or click to pick one
  const img = document.createElement('img');
  img.src = (data?.icon && data.icon !== '') ? data.icon : './images/pfp.jpg';
  img.alt = '';
  img.title = 'Click or drop an image to change portrait';
  const setPortrait = async file => {
    if (!file) return;
    if (!file.type?.startsWith('image')) {
      toast('That file is not an image.', { kind: 'warn' });
      return;
    }
    try {
      img.src = await downscaleImage(await readImageFile(file));
      animateOnce(img, 'portrait-swap');
      saveSettings();
    } catch (error) {
      console.error('Failed to load portrait', error);
      toast('Could not read that image.', { kind: 'error' });
    }
  };
  img.addEventListener('dragover', e => { e.preventDefault(); img.classList.add('drop-target'); });
  img.addEventListener('dragleave', () => img.classList.remove('drop-target'));
  img.addEventListener('drop', e => {
    e.preventDefault();
    img.classList.remove('drop-target');
    setPortrait(e.dataTransfer.files[0]);
  });
  img.addEventListener('click', () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.addEventListener('change', () => setPortrait(picker.files?.[0]));
    picker.click();
  });

  // Portraits saved before downscaling existed can be several MB; shrink them once.
  if (typeof data?.icon === 'string' && data.icon.startsWith('data:') && data.icon.length > MAX_INLINE_ICON) {
    downscaleImage(data.icon)
      .then(small => { img.src = small; saveSettings(); })
      .catch(error => console.error('Failed to shrink saved portrait', error));
  }

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
    const value = s === 'competency' ? createCompetencySelect(data?.[s]) : document.createElement('input');
    value.className = 'value';
    value.dataset.stat = s;
    if (s !== 'competency') value.value = data?.[s] || '';
    value.style.width = '80px';
    value.addEventListener(s === 'competency' ? 'change' : 'input', () => saveSettings());
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
    playEvent(isNowDead ? 'sickLeave' : 'return');
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
      playEvent(triggersMerit ? 'encouraged' : 'prime', { competency: getCompetency(c) });
      document.dispatchEvent(new CustomEvent('triangle-action', { detail: { type: triggersMerit ? 'merit' : 'demerit', element: target, source: key } }));
    });

    // editable text area
    const textWrap = document.createElement('div');
    textWrap.className = 'back-textwrap';
    const ta = document.createElement('textarea');
    ta.className = `back-text ${key}`;
    ta.dataset.key = key;
    ta.rows = 4;
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

  // The Competency fills the back of the card with its Prime Directive and
  // Encouraged Behaviors: empty fields on load, and on every change of Competency.
  fillCompetencyText(c, { onlyEmpty: true });
  c.querySelector('[data-stat="competency"]').addEventListener('change', () => applyCompetency(c));

  // set initial values for backFace copy of tint/top classes
  syncBack(c);
  
  
  const exportBtn = document.createElement('button');
  exportBtn.className = 'export-btn';
  exportBtn.type = 'button';
  exportBtn.title = 'Export agent';
  exportBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (!saveCharacterToFile(c)) toast('Failed to export agent', { kind: 'error' });
  });
  c.appendChild(exportBtn);

  // Persistence reads cards from the document, so append before saving.
  const before = Number.isInteger(index) ? getCharElements()[index] ?? null : null;
  charContainer.insertBefore(c, before);
  if (animate) {
    c.style.animationDelay = `${delay}ms`;
    animateOnce(c, 'entering', () => { c.style.animationDelay = ''; });
  }
  saveSettings();
  updateTopCharacters();
  return true;
}

/** Remove an agent with an exit animation and offer an undo. */
export function removeChar(c) {
  if (!c || c.classList.contains('leaving')) return;
  const index = getCharElements().indexOf(c);
  const data = getCharacterData(c);

  c.classList.add('leaving');
  saveSettings();
  updateTopCharacters();

  const detach = () => c.remove();
  c.addEventListener('animationend', event => { if (event.target === c) detach(); });
  setTimeout(detach, 500);

  toast(`${data.name || 'Agent'} removed from the branch.`, {
    duration: 6000,
    action: { label: 'Undo', onClick: () => addChar(data, { index }) }
  });
}

/**
 * getAgentStats - read merit/demerit/net for every agent card and flag the
 * unique top-merit, top-demerit and best-net-score agents (ties highlight no one,
 * matching the original single-winner behavior). Shared by updateTopCharacters()
 * and the dashboard panels so both use the exact same "who's winning" logic.
 */
export function getAgentStats() {
  const chars = getCharElements();
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


/**
 * chooseAgent - modal picker listing every agent card.
 * Resolves with the chosen .char element, or null when cancelled.
 */
export function chooseAgent(title = 'Choose agent') {
  return new Promise(resolve => {
    const chars = getCharElements();
    const list = document.createElement('div');
    list.className = 'chooser-list';
    let picked = null;
    let close = () => {};

    if (!chars.length) {
      const empty = document.createElement('div');
      empty.className = 'chooser-empty';
      empty.textContent = 'No agents on this branch yet. Use "Hire Agent" first.';
      list.appendChild(empty);
    }

    chars.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chooser-item';
      btn.style.setProperty('--i', i);
      if (c.classList.contains('dead')) btn.classList.add('dead');

      const portrait = document.createElement('img');
      portrait.src = c.querySelector('img')?.src || '';
      portrait.alt = '';
      const label = document.createElement('span');
      label.textContent = c.querySelector('.stat input')?.value || `Agent ${i + 1}`;

      btn.append(portrait, label);
      btn.addEventListener('click', () => { picked = c; close(); });
      list.appendChild(btn);
    });

    close = openModal({
      title,
      content: list,
      className: 'chooser-modal',
      actions: [{ label: 'Cancel' }],
      onClose: () => resolve(picked)
    });
  });
}
