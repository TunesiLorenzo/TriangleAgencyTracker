// previousCases.js
// Responsibilities: the Previous Cases tab. Every filed mission is a TOP SECRET envelope;
// opening one shows the scan of its Rapporto di Fine Incarico, and the button at the
// bottom files a new scan. HD scans are far too big for browser storage, so they live on
// disk in cases/ next to the app and go through the tracker server (/api/cases).

import { confirmDialog, openModal, toast } from './ui.js';

const MAX_SCAN_BYTES = 100 * 1024 * 1024;   // mirrors MAX_CASE_BYTES in web.py
const SCAN_TYPES = '.jpg,.jpeg,.png,.webp,.pdf';
const OPEN_DELAY = 700;                      // ms: flap lifts and the report slides out first
const GATE_ALARM_DELAY = 260;                // the warning light gets a beat before the doors move
const GATE_OPEN_DELAY = 1250;
const OUTCOMES = {
  contained: { label: 'Contained' },
  killed: { label: 'Killed' },
  escaped: { label: 'Escaped' }
};

let view = null;
let request = 0;   // ignores a slow listing that finished after a newer one
let archiveUnlocked = false;

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function scanUrl(entry) {
  return `./cases/${encodeURIComponent(entry.file)}`;
}

function caseNumber(entry, { short = false } = {}) {
  const number = `N. ${String(entry.number).padStart(3, '0')}`;
  return short ? number : `Caso ${number}`;
}

function caseDate(entry) {
  const date = new Date(`${entry.date}T00:00`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('it-IT');
}

function caseOutcome(entry) {
  const value = entry.outcome === 'captured' ? 'contained' : entry.outcome;
  return OUTCOMES[value] ? value : 'contained';
}

function caseScore(entry) {
  const score = Number.parseInt(entry.score, 10);
  return Number.isInteger(score) && score >= 0 && score <= 100 ? score : null;
}

function outcomeLabel(entry) {
  return OUTCOMES[caseOutcome(entry)].label;
}

/** A small, stable tilt per case so the envelopes look dropped on a desk. */
function tiltFor(id) {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 61) - 30) / 10;   // -3.0 .. 3.0 degrees
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function api(path, options) {
  const response = await fetch(path, options);
  let data = null;
  try { data = await response.json(); } catch { /* not JSON: no tracker server here */ }
  if (!response.ok || !data?.ok) throw new Error(data?.message || `Request failed (${response.status})`);
  return data;
}

// ---------- envelope ----------
function createEnvelope(entry, index) {
  const envelope = el('button', 'case-envelope');
  const outcome = caseOutcome(entry);
  const score = caseScore(entry);
  envelope.type = 'button';
  envelope.dataset.id = entry.id;
  envelope.dataset.outcome = outcome;
  envelope.classList.add(`case-outcome-${outcome}`);
  envelope.style.setProperty('--i', index);
  envelope.style.setProperty('--tilt', `${tiltFor(entry.id)}deg`);
  envelope.setAttribute('aria-label', `${caseNumber(entry)}: ${entry.name}. ${outcomeLabel(entry)}. Team score ${score ?? 'not assigned'}. Open the Rapporto`);

  // Layers, back to front: inside of the envelope, the Rapporto, the pocket, the flap
  // (stamped TOP SECRET), and the string-and-button closure holding the flap down.
  const front = el('span', 'case-front');
  const label = el('span', 'case-label');
  const caption = el('span', 'case-label-caption');
  caption.append(el('span', '', 'Oggetto'), el('span', 'case-label-number', caseNumber(entry, { short: true })));
  label.append(caption, el('span', 'case-name', entry.name));
  const meta = el('span', 'case-meta');
  meta.append(el('span', '', entry.code), el('span', '', caseDate(entry)));
  front.append(label, meta, el('span', 'case-agency', '▲ Triangle Agency'));

  const flap = el('span', 'case-flap');
  flap.append(el('span', 'case-flap-shadow'), el('span', 'case-flap-face'), el('span', 'case-stamp', 'Top Secret'));

  const closure = el('span', 'case-closure');
  closure.setAttribute('aria-hidden', 'true');
  closure.innerHTML = '<svg viewBox="0 0 40 60"><path d="M20 8 C 4 18, 36 30, 20 46 C 6 56, 34 58, 20 46"/><circle cx="20" cy="8" r="6"/><circle cx="20" cy="46" r="6"/></svg>';

  const scoreBadge = el('span', 'case-score');
  scoreBadge.append(
    el('span', 'case-score-label', 'Team score'),
    el('strong', '', score === null ? '--' : String(score)),
    el('span', 'case-score-total', '/100')
  );
  const status = el('span', 'case-status', outcomeLabel(entry));
  const danger = el('span', 'case-danger-tape', 'Danger // Danger // Danger');
  danger.setAttribute('aria-hidden', 'true');

  envelope.append(el('span', 'case-back'), el('span', 'case-paper'), front, flap, closure, status, scoreBadge, danger);
  envelope.addEventListener('click', () => openCase(envelope, entry));
  return envelope;
}

function openCase(envelope, entry) {
  if (envelope.classList.contains('open')) return;
  envelope.classList.add('open');
  setTimeout(() => showRapporto(entry, () => envelope.classList.remove('open')), reducedMotion() ? 0 : OPEN_DELAY);
}

// ---------- viewer ----------
function showRapporto(entry, onClose) {
  const url = scanUrl(entry);
  const body = el('div', 'case-viewer-body');
  const score = caseScore(entry);
  const summary = el('div', `case-viewer-summary case-viewer-summary-${caseOutcome(entry)}`);
  const summaryText = el('div');
  summaryText.append(
    el('span', 'case-viewer-outcome', outcomeLabel(entry)),
    el('p', 'case-viewer-meta', [caseNumber(entry), entry.code, caseDate(entry)].filter(Boolean).join(' · '))
  );
  const summaryScore = el('div', 'case-viewer-score');
  summaryScore.append(el('span', '', 'Team score'), el('strong', '', score === null ? '--' : String(score)), el('small', '', '/100'));
  summary.append(summaryText, summaryScore);
  body.appendChild(summary);

  const frame = el('div', 'case-document');
  if (entry.file.toLowerCase().endsWith('.pdf')) {
    const pdf = el('iframe');
    pdf.src = url;
    pdf.title = `Rapporto: ${entry.name}`;
    frame.appendChild(pdf);
  } else {
    // Fits the screen; a click shows the scan at full resolution around the clicked point.
    const img = el('img');
    img.src = url;
    img.alt = `Rapporto di Fine Incarico: ${entry.name}`;
    img.title = 'Click to zoom';
    img.addEventListener('click', event => {
      const rect = img.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;
      const zoomed = frame.classList.toggle('zoomed');
      img.title = zoomed ? 'Click to fit' : 'Click to zoom';
      if (zoomed) {
        frame.scrollLeft = x * img.offsetWidth - frame.clientWidth / 2;
        frame.scrollTop = y * img.offsetHeight - frame.clientHeight / 2;
      }
    });
    frame.appendChild(img);
  }
  body.appendChild(frame);

  openModal({
    title: entry.name,
    content: body,
    className: 'case-viewer',
    closeLabel: 'Close',
    actions: [
      { label: 'Delete case', variant: 'danger', onClick: () => { setTimeout(() => deleteCase(entry)); } },
      { label: 'Edit record', onClick: () => { setTimeout(() => openCaseEditForm(entry)); } },
      { label: 'Open original', onClick: () => { window.open(url, '_blank', 'noopener'); return false; } }
    ],
    onClose
  });
}

function outcomeFields(selected = 'contained') {
  return `<fieldset class="case-outcome-field">
    <legend class="field-label">Mission outcome</legend>
    <div class="case-outcome-options">
      ${Object.entries(OUTCOMES).map(([value, outcome]) => `<label class="case-outcome-option case-outcome-option-${value}">
        <input type="radio" name="outcome" value="${value}" ${selected === value ? 'checked' : ''}>
        <span>${outcome.label}</span>
      </label>`).join('')}
    </div>
  </fieldset>`;
}

function openCaseEditForm(entry) {
  const form = el('form', 'task-form case-form case-edit-form');
  form.noValidate = true;
  form.innerHTML = `
    <p class="case-edit-caption"></p>
    <label class="field">
      <span class="field-label">Team score</span>
      <span class="case-score-input"><input name="score" type="number" min="0" max="100" step="1" inputmode="numeric" value="${caseScore(entry) ?? ''}" autofocus><span>/100</span></span>
    </label>
    ${outcomeFields(caseOutcome(entry))}`;
  form.querySelector('.case-edit-caption').textContent = `${caseNumber(entry)} · ${entry.name}`;

  const scoreInput = form.elements.score;
  scoreInput.addEventListener('input', () => scoreInput.classList.remove('invalid'));
  let saving = false;
  const save = async () => {
    const score = Number(scoreInput.value);
    if (scoreInput.value === '' || !Number.isInteger(score) || score < 0 || score > 100) {
      scoreInput.classList.add('invalid');
      scoreInput.focus();
      return;
    }
    saving = true;
    try {
      const { case: updated } = await api(`/api/cases/${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, outcome: form.elements.outcome.value })
      });
      close();
      await renderPreviousCases({ highlight: updated.id });
      toast(`${caseNumber(updated)} record updated.`);
    } catch (error) {
      toast(error.message || 'The case record could not be updated.', { kind: 'error' });
    } finally {
      saving = false;
    }
  };

  const close = openModal({
    title: 'Edit case record',
    content: form,
    className: 'case-form-modal',
    actions: [
      { label: 'Cancel' },
      { label: 'Save record', variant: 'primary', submit: true, onClick: () => { if (!saving) save(); return false; } }
    ]
  });
}

async function deleteCase(entry) {
  const confirmed = await confirmDialog({
    title: `Delete ${caseNumber(entry)}?`,
    message: `"${entry.name}" and its scan will be removed from the archive folder. This can't be undone.`,
    confirmLabel: 'Delete',
    danger: true
  });
  if (!confirmed) return;
  try {
    await api(`/api/cases/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
  } catch (error) {
    toast(error.message, { kind: 'error' });
    return;
  }
  const envelope = view?.querySelector(`.case-envelope[data-id="${CSS.escape(entry.id)}"]`);
  envelope?.classList.add('leaving');
  setTimeout(renderPreviousCases, envelope && !reducedMotion() ? 400 : 0);
  toast(`${caseNumber(entry)} deleted.`);
}

// ---------- filing a new case ----------
function openCaseForm() {
  const form = el('form', 'task-form case-form');
  form.noValidate = true;
  form.innerHTML = `
    <label class="field">
      <span class="field-label">Case name</span>
      <input name="name" type="text" maxlength="80" placeholder="e.g. Il ladro di ombre" autocomplete="off" autofocus>
    </label>
    <div class="case-form-row">
      <label class="field">
        <span class="field-label">Code</span>
        <input name="code" type="text" maxlength="12" placeholder="A1" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">Mission date</span>
        <input name="date" type="date">
      </label>
    </div>
    <label class="field">
      <span class="field-label">Team score</span>
      <span class="case-score-input"><input name="score" type="number" min="0" max="100" step="1" inputmode="numeric" placeholder="0-100"><span>/100</span></span>
    </label>
    ${outcomeFields()}
    <div class="field">
      <span class="field-label">Rapporto scan</span>
      <label class="case-drop">
        <input name="file" type="file" accept="${SCAN_TYPES}">
        <span class="case-drop-text">Drop the scan here or click to choose<br><small>JPG, PNG, WEBP or PDF, up to 100 MB</small></span>
        <img class="case-drop-preview" alt="" hidden>
      </label>
    </div>
    <button type="submit" hidden></button>`;

  const today = new Date();
  form.elements.date.value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

  const nameInput = form.elements.name;
  const scoreInput = form.elements.score;
  const fileInput = form.elements.file;
  const drop = form.querySelector('.case-drop');
  const dropText = form.querySelector('.case-drop-text');
  const preview = form.querySelector('.case-drop-preview');
  let previewUrl = '';

  const showFile = () => {
    const file = fileInput.files?.[0];
    drop.classList.remove('invalid');
    URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    preview.hidden = true;
    if (!file) return;
    dropText.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    if (file.type.startsWith('image/')) {
      previewUrl = URL.createObjectURL(file);
      preview.src = previewUrl;
      preview.hidden = false;
    }
  };
  fileInput.addEventListener('change', showFile);
  drop.addEventListener('dragover', event => { event.preventDefault(); drop.classList.add('drop-target'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drop-target'));
  drop.addEventListener('drop', event => {
    event.preventDefault();
    drop.classList.remove('drop-target');
    if (!event.dataTransfer.files.length) return;
    fileInput.files = event.dataTransfer.files;
    showFile();
  });
  nameInput.addEventListener('input', () => nameInput.classList.remove('invalid'));
  scoreInput.addEventListener('input', () => scoreInput.classList.remove('invalid'));

  const flag = field => {
    field.classList.remove('invalid');
    void field.offsetWidth;
    field.classList.add('invalid');
  };

  let uploading = false;
  const submit = async () => {
    const name = nameInput.value.trim();
    const score = Number(scoreInput.value);
    const file = fileInput.files?.[0];
    if (!name) { flag(nameInput); nameInput.focus(); return; }
    if (scoreInput.value === '' || !Number.isInteger(score) || score < 0 || score > 100) { flag(scoreInput); scoreInput.focus(); return; }
    if (!file) { flag(drop); return; }
    if (file.size > MAX_SCAN_BYTES) {
      toast('That scan is larger than 100 MB. Export it as a JPG or a compressed PDF.', { kind: 'warn', duration: 6000 });
      return;
    }

    uploading = true;
    const button = form.closest('.modal-panel')?.querySelector('.modal-btn-primary');
    if (button) { button.textContent = 'Filing…'; button.disabled = true; }
    try {
      const { case: filed } = await api('/api/cases', { method: 'POST', body: new FormData(form) });
      close();
      await renderPreviousCases({ highlight: filed.id });
      toast(`${caseNumber(filed)} filed: ${filed.name}.`);
    } catch (error) {
      toast(error.message || 'The scan could not be filed.', { kind: 'error', duration: 6000 });
    } finally {
      uploading = false;
      if (button) { button.textContent = 'File case'; button.disabled = false; }
    }
  };

  const close = openModal({
    title: 'File a new case',
    content: form,
    className: 'case-form-modal',
    actions: [
      { label: 'Cancel' },
      { label: 'File case', variant: 'primary', submit: true, onClick: () => { if (!uploading) submit(); return false; } }
    ],
    onClose: () => URL.revokeObjectURL(previewUrl)
  });
}

// ---------- view ----------
function renderArchive(cases, highlight) {
  const desk = el('div', 'cases-desk');

  if (cases.length) {
    const grid = el('div', 'cases-grid');
    cases.forEach((entry, index) => {
      const envelope = createEnvelope(entry, index);
      if (entry.id === highlight) envelope.classList.add('filed');
      grid.appendChild(envelope);
    });
    desk.appendChild(grid);
  } else {
    desk.appendChild(el('p', 'cases-empty', 'No cases filed yet. After each mission, file the scan of its Rapporto di Fine Incarico here.'));
  }

  const add = el('button', 'cases-add', '+ File a new case');
  add.type = 'button';
  add.addEventListener('click', openCaseForm);
  desk.appendChild(add);

  const vault = el('section', 'cases-vault');
  vault.setAttribute('aria-label', 'Previous cases secure archive');
  vault.appendChild(desk);

  const trigger = el('button', 'cases-vault-trigger');
  trigger.type = 'button';
  trigger.setAttribute('aria-expanded', String(archiveUnlocked));
  trigger.setAttribute('aria-label', 'Unlock previous cases archive');
  const leftDoor = el('span', 'cases-vault-door cases-vault-door-left');
  const rightDoor = el('span', 'cases-vault-door cases-vault-door-right');
  [leftDoor, rightDoor].forEach(door => {
    door.append(el('span', 'cases-vault-rivets'), el('span', 'cases-vault-brace'));
  });
  const warning = el('span', 'cases-vault-warning');
  warning.append(
    el('span', 'cases-vault-beacon'),
    el('strong', '', 'RESTRICTED ARCHIVE'),
    el('small', '', 'Click to disengage security gates')
  );
  const seal = el('span', 'cases-vault-seal');
  seal.append(el('span', '', '▲'), el('small', '', 'CASE FILES'));
  trigger.append(leftDoor, rightDoor, warning, seal);
  vault.appendChild(trigger);

  if (archiveUnlocked) {
    vault.classList.add('open', 'settled');
    trigger.disabled = true;
    trigger.tabIndex = -1;
  } else {
    desk.inert = true;
    trigger.addEventListener('click', () => {
      if (vault.classList.contains('opening')) return;
      archiveUnlocked = true;
      trigger.setAttribute('aria-expanded', 'true');
      vault.classList.add('alarming');
      const motionDelay = reducedMotion() ? 0 : GATE_ALARM_DELAY;
      const settleDelay = reducedMotion() ? 0 : GATE_OPEN_DELAY;
      setTimeout(() => vault.classList.add('opening', 'open'), motionDelay);
      setTimeout(() => {
        vault.classList.add('settled');
        desk.inert = false;
        trigger.disabled = true;
        trigger.tabIndex = -1;
        desk.querySelector('.case-envelope, .cases-add')?.focus({ preventScroll: true });
      }, settleDelay);
    });
  }

  view.replaceChildren(vault);
  if (highlight) view.querySelector('.case-envelope.filed')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** Fetch the archive and lay the envelopes out again (they drop in every time the tab opens). */
export async function renderPreviousCases({ highlight } = {}) {
  if (!view) return;
  const current = ++request;
  try {
    const { cases } = await api('/api/cases');
    if (current !== request) return;
    renderArchive(cases, highlight);
  } catch (error) {
    if (current !== request) return;
    console.error('Failed to load previous cases', error);
    view.replaceChildren(el('p', 'cases-empty',
      'The case archive needs the tracker server. Start it with start_server.bat and reload this page.'));
  }
}

export function initPreviousCases() {
  view = document.getElementById('previousCasesView');
}
