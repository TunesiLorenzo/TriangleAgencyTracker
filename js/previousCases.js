// previousCases.js
// Responsibilities: the Previous Cases tab. Every filed mission is a TOP SECRET envelope;
// opening one shows the scanned pages of its Rapporto di Fine Incarico, and the button at
// the bottom files new pages. HD scans are far too big for browser storage, so they live on
// disk in cases/ next to the app and go through the tracker server (/api/cases).

import { confirmDialog, openModal, toast } from './ui.js';
import { playButton, soundStartDelay } from './soundEffects.js';
import { getConfig } from './config.js';

const MAX_SCAN_BYTES = 100 * 1024 * 1024;   // mirrors MAX_CASE_BYTES in web.py
const SCAN_TYPES = '.jpg,.jpeg,.png,.webp,.pdf';
const OPEN_DELAY = 700;                      // ms: flap lifts and the report slides out first
const SHELF_TURN_MS = 760;
const OUTCOMES = {
  contained: { label: 'Contained' },
  killed: { label: 'Killed' },
  escaped: { label: 'Escaped' }
};
let view = null;
let request = 0;   // ignores a slow listing that finished after a newer one
let archiveUnlocked = false;
let gateSequence = 0;   // invalidates an opening sequence if navigation starts closing it

const GATE_OPEN_X = 103;        // % the doors travel sideways to clear the frame
const GATE_JOLT = 0.035;        // share of the travel the doors jump when the locks release
const EASE_IN = 'cubic-bezier(.5,0,.85,.55)';     // slow off the mark, fastest at the slam
const EASE_OUT = 'cubic-bezier(.15,.55,.35,1)';   // after the slam, braking to a stop

/**
 * Play one door timeline. `stops` are [seconds, open share 0..1, easing to the next stop];
 * resolves when the last stop is reached (or the animation is cancelled).
 */
function animateGates(vault, stops) {
  releaseGates(vault);   // an interrupted opening hands over to the closing
  // Hold the first position while the sound is still starting (amplifier warm-up).
  if (stops[0][0] > 0) stops = [[0, stops[0][1]], ...stops];
  const total = stops.at(-1)[0];
  const doors = [
    [vault.querySelector('.cases-vault-door-left'), -1, ''],
    [vault.querySelector('.cases-vault-door-right'), 1, ' scaleX(-1)']
  ];
  const animations = doors.map(([door, side, flip]) => door.animate(
    stops.map(([time, share, easing]) => ({
      offset: total ? time / total : 0,
      transform: `translateX(${side * share * GATE_OPEN_X}%)${flip}`,
      easing: easing || 'linear'
    })),
    { duration: total * 1000, fill: 'forwards' }
  ));
  vault._gateAnimations = animations;
  return Promise.all(animations.map(animation => animation.finished.catch(() => {})));
}

/** Drop the scripted door positions once the .open class describes the same state. */
function releaseGates(vault) {
  vault._gateAnimations?.forEach(animation => animation.cancel());
  vault._gateAnimations = null;
}

/** Times from /settings, forced into order so a stray slider cannot break the timeline. */
function gateTimes() {
  const gates = getConfig().effects.gates;
  const ordered = keys => keys.reduce((times, key) => [...times, Math.max(times.at(-1) ?? 0, Number(gates[key]) || 0)], []);
  const [disengage, openStart, openSlam, openEnd] = ordered(['disengageAt', 'openStartAt', 'openSlamAt', 'openEndAt']);
  const [closeStart, closeSlam, closeEnd] = ordered(['closeStartAt', 'closeSlamAt', 'closeEndAt']);
  return { disengage, openStart, openSlam, openEnd, closeStart, closeSlam, closeEnd, slam: gates.slamShare };
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function caseFiles(entry) {
  const saved = Array.isArray(entry.files) ? entry.files : [];
  const files = [];
  saved.forEach((item, index) => {
    const record = typeof item === 'string' ? { file: item } : item;
    const brightness = Number.parseInt(record?.brightness, 10);
    const id = String(record?.id || `page-${String(index + 1).padStart(3, '0')}`);
    if (record?.kind === 'scatter' && Array.isArray(record.photos)) {
      record.photos.forEach((photo, photoIndex) => {
        const photoFile = String(photo?.file || '');
        if (!photoFile) return;
        const photoBrightness = Number.parseInt(photo?.brightness, 10);
        const photoId = String(photo?.id || `photo-${String(photoIndex + 1).padStart(3, '0')}`);
        files.push({
          id: `${id}-${photoId}`,
          kind: 'page',
          file: photoFile,
          name: String(photo?.name || photoFile || `Page ${files.length + 1}`),
          brightness: Number.isInteger(photoBrightness) && photoBrightness >= 20 && photoBrightness <= 150 ? photoBrightness : 100
        });
      });
      return;
    }
    const file = String(record?.file || '');
    if (!file) return;
    files.push({
      id,
      kind: 'page',
      file,
      name: String(record?.name || record?.file || `Page ${index + 1}`),
      brightness: Number.isInteger(brightness) && brightness >= 20 && brightness <= 150 ? brightness : 100
    });
  });
  if (!files.length && entry.file) {
    files.push({ id: 'page-001', kind: 'page', file: String(entry.file), name: String(entry.file), brightness: 100 });
  }
  entry.files = files;
  return files;
}

function scanUrl(file) {
  return `./cases/${encodeURIComponent(file.file)}`;
}

function isPdf(file) {
  return (file.file || '').toLowerCase().endsWith('.pdf');
}

/**
 * Stand in for a page whose scan is not on this machine: the case came from a team file,
 * which carries the archive index but not the scans themselves.
 */
function missingScanNotice(file) {
  const notice = el('div', 'case-page-missing');
  notice.appendChild(el('p', 'case-page-missing-title', file.name || 'Scan not on this machine'));
  notice.appendChild(el('p', 'case-page-missing-note',
    file.file
      ? `${file.file} was filed on another terminal. Copy the cases folder across to see this page.`
      : 'This case was imported from a team file, which carries case details but not the scans.'));
  return notice;
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
  const score = String(entry.score || '').trim().toUpperCase();
  return /^[A-Z0-9+-]{1,6}$/.test(score) ? score : null;
}

function normalizeScoreInput(input) {
  input.value = input.value.toUpperCase().replace(/[^A-Z0-9+-]/g, '').slice(0, 6);
  input.classList.remove('invalid');
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
function createEnvelope(entry, index, onActivate = null) {
  const envelope = el('button', 'case-envelope');
  const outcome = caseOutcome(entry);
  const score = caseScore(entry);
  envelope.type = 'button';
  envelope.dataset.id = entry.id;
  envelope.dataset.outcome = outcome;
  envelope.dataset.spine = `${caseNumber(entry, { short: true })} · ${entry.name}`;
  envelope.classList.add(`case-outcome-${outcome}`);
  envelope.style.setProperty('--i', index);
  envelope.style.setProperty('--tilt', `${tiltFor(entry.id)}deg`);
  envelope.setAttribute('aria-label', `${caseNumber(entry)}: ${entry.name}. ${outcomeLabel(entry)}. Team rank ${score ?? 'not assigned'}. Open the Rapporto`);

  // Layers, back to front: inside of the envelope, the Rapporto, the pocket, the flap
  // (stamped TOP SECRET), and the string-and-button closure holding the flap down.
  const front = el('span', 'case-front');
  const label = el('span', 'case-label');
  const caption = el('span', 'case-label-caption');
  caption.append(el('span', '', 'Oggetto'), el('span', 'case-label-number', caseNumber(entry, { short: true })));
  label.append(caption, el('span', 'case-name', entry.name));
  const meta = el('span', 'case-meta');
  meta.append(el('span', '', entry.code), el('span', '', caseDate(entry)));
  const blood = el('span', 'case-blood-splatter');
  blood.setAttribute('aria-hidden', 'true');
  const danger = el('span', 'case-danger-tape', 'Escaped');
  danger.setAttribute('aria-hidden', 'true');
  front.append(blood, label, meta, el('span', 'case-agency', '▲ Triangle Agency'), danger);

  const flap = el('span', 'case-flap');
  flap.append(el('span', 'case-flap-shadow'), el('span', 'case-flap-face'), el('span', 'case-stamp', 'Top Secret'));

  const closure = el('span', 'case-closure');
  closure.setAttribute('aria-hidden', 'true');
  closure.innerHTML = '<svg viewBox="0 0 40 60"><path d="M20 8 C 4 18, 36 30, 20 46 C 6 56, 34 58, 20 46"/><circle cx="20" cy="8" r="6"/><circle cx="20" cy="46" r="6"/></svg>';

  const scoreBadge = el('span', 'case-score');
  scoreBadge.dataset.rankLength = String((score ?? '--').length);
  scoreBadge.append(
    el('span', 'case-score-label', 'Team rank'),
    el('strong', '', score === null ? '--' : score)
  );
  const status = el('span', 'case-status', outcomeLabel(entry));

  envelope.append(el('span', 'case-back'), el('span', 'case-paper'), front, flap, closure, status, scoreBadge);
  envelope.addEventListener('click', () => (onActivate ? onActivate(envelope, entry) : openCase(envelope, entry)));
  return envelope;
}

function openCase(envelope, entry) {
  if (envelope.classList.contains('open')) return;
  envelope.classList.add('open');
  setTimeout(() => showRapporto(entry, () => envelope.classList.remove('open')), reducedMotion() ? 0 : OPEN_DELAY);
}

// ---------- viewer ----------
function showRapporto(entry, onClose) {
  const files = caseFiles(entry);
  let currentIndex = 0;
  const body = el('div', 'case-viewer-body');
  const score = caseScore(entry);
  const summary = el('div', `case-viewer-summary case-viewer-summary-${caseOutcome(entry)}`);
  const summaryText = el('div');
  summaryText.append(
    el('span', 'case-viewer-outcome', outcomeLabel(entry)),
    el('p', 'case-viewer-meta', [caseNumber(entry), entry.code, caseDate(entry)].filter(Boolean).join(' · '))
  );
  const summaryScore = el('div', 'case-viewer-score');
  summaryScore.append(el('span', '', 'Team rank'), el('strong', '', score === null ? '--' : score));
  summary.append(summaryText, summaryScore);
  body.appendChild(summary);

  const frame = el('div', 'case-document');
  const stack = el('div', 'case-paper-stack');
  stack.classList.toggle('single-page', files.length < 2);
  stack.tabIndex = 0;
  stack.setAttribute('autofocus', '');
  stack.setAttribute('role', 'group');
  stack.setAttribute('aria-label', 'Case pages');
  const surface = el('div', 'case-page-surface');
  const underlay = el('button', 'case-page-underlay');
  underlay.type = 'button';
  underlay.setAttribute('aria-label', 'Show next page');
  const position = el('span', 'case-page-position');

  const settingsButton = el('button', 'case-image-settings', '⚙');
  settingsButton.type = 'button';
  settingsButton.title = 'Image brightness';
  settingsButton.setAttribute('aria-label', 'Adjust image brightness');
  settingsButton.setAttribute('aria-expanded', 'false');
  const settings = el('div', 'case-brightness-panel');
  settings.hidden = true;
  const settingHeading = el('strong', '', 'Image brightness');
  const settingValue = el('output', 'case-brightness-value', '100%');
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '20';
  range.max = '150';
  range.step = '5';
  range.setAttribute('aria-label', 'Image brightness percentage');
  const reset = el('button', 'case-brightness-reset', 'Reset');
  reset.type = 'button';
  settings.append(settingHeading, settingValue, range, reset);

  const currentFile = () => files[currentIndex];
  const applyBrightnessPreview = () => {
    const image = surface.querySelector('.case-page-image');
    if (image) image.style.filter = `brightness(${range.value}%)`;
    settingValue.textContent = `${range.value}%`;
  };

  const renderPage = direction => {
    const file = currentFile();
    surface.classList.remove('zoomed');
    surface.replaceChildren();
    settings.hidden = true;
    settingsButton.setAttribute('aria-expanded', 'false');
    position.textContent = `${currentIndex + 1} / ${files.length}`;
    position.hidden = files.length < 2;
    underlay.hidden = files.length < 2;
    underlay.title = `Show page ${currentIndex + 2 > files.length ? 1 : currentIndex + 2} of ${files.length}`;
    stack.style.setProperty('--page-tilt', `${[-0.55, 0.35, -0.25, 0.5][currentIndex % 4]}deg`);
    stack.classList.remove('shuffle-forward', 'shuffle-backward');
    void stack.offsetWidth;
    if (direction) stack.classList.add(direction > 0 ? 'shuffle-forward' : 'shuffle-backward');

    if (!file.file) {
      stack.style.setProperty('--page-ratio', '0.707');
      surface.appendChild(missingScanNotice(file));
      settingsButton.hidden = true;
    } else if (isPdf(file)) {
      stack.style.setProperty('--page-ratio', '0.707');
      const pdf = el('iframe');
      pdf.src = scanUrl(file);
      pdf.title = `Rapporto: ${entry.name}, page ${currentIndex + 1}`;
      surface.appendChild(pdf);
      settingsButton.hidden = true;
    } else {
      const img = el('img', 'case-page-image');
      img.src = scanUrl(file);
      img.alt = `Rapporto di Fine Incarico: ${entry.name}, page ${currentIndex + 1}`;
      img.title = 'Click to zoom';
      img.style.filter = `brightness(${file.brightness}%)`;
      img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalHeight) {
          stack.style.setProperty('--page-ratio', String(img.naturalWidth / img.naturalHeight));
        }
      }, { once: true });
      img.addEventListener('error', () => {
        stack.style.setProperty('--page-ratio', '0.707');
        img.replaceWith(missingScanNotice(file));
        settingsButton.hidden = true;
      }, { once: true });
      img.addEventListener('click', event => {
        const rect = img.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width;
        const y = (event.clientY - rect.top) / rect.height;
        const zoomed = surface.classList.toggle('zoomed');
        img.title = zoomed ? 'Click to fit' : 'Click to zoom';
        if (zoomed) {
          surface.scrollLeft = x * img.offsetWidth - surface.clientWidth / 2;
          surface.scrollTop = y * img.offsetHeight - surface.clientHeight / 2;
        }
      });
      surface.appendChild(img);
      range.value = String(file.brightness);
      settingHeading.textContent = 'Image brightness';
      applyBrightnessPreview();
      settingsButton.hidden = false;
      settingsButton.title = 'Image brightness';
      settingsButton.setAttribute('aria-label', 'Adjust image brightness');
    }
  };

  const shuffle = direction => {
    if (files.length < 2) return;
    currentIndex = (currentIndex + direction + files.length) % files.length;
    renderPage(direction);
    stack.focus({ preventScroll: true });
  };
  underlay.addEventListener('click', () => shuffle(1));
  stack.addEventListener('keydown', event => {
    if (event.target === range) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); shuffle(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); shuffle(1); }
  });
  settingsButton.addEventListener('click', () => {
    settings.hidden = !settings.hidden;
    settingsButton.setAttribute('aria-expanded', String(!settings.hidden));
    if (!settings.hidden) range.focus();
  });
  range.addEventListener('input', applyBrightnessPreview);
  range.addEventListener('change', async () => {
    const file = currentFile();
    const brightness = Number(range.value);
    range.disabled = true;
    try {
      const saved = await api(`/api/cases/${encodeURIComponent(entry.id)}/files/${encodeURIComponent(file.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brightness })
      });
      file.brightness = saved.file.brightness;
      if (currentFile() === file) {
        settingValue.textContent = `${file.brightness}% · saved`;
      }
    } catch (error) {
      if (currentFile() === file) {
        range.value = String(file.brightness);
        applyBrightnessPreview();
      }
      toast(error.message || 'Brightness could not be saved.', { kind: 'error' });
    } finally {
      range.disabled = false;
    }
  });
  reset.addEventListener('click', () => {
    range.value = '100';
    applyBrightnessPreview();
    range.dispatchEvent(new Event('change'));
  });

  stack.append(underlay, surface, position, settingsButton, settings);
  frame.appendChild(stack);
  body.appendChild(frame);
  renderPage(0);

  let deletingPage = false;
  const deleteCurrentPage = async () => {
    if (deletingPage) return;
    if (files.length <= 1) {
      toast('A dossier must keep one page. Use Delete case to remove the whole dossier.', { kind: 'warn' });
      return;
    }
    const file = currentFile();
    const confirmed = await confirmDialog({
      title: 'Delete this page?',
      message: `Remove page ${currentIndex + 1} from "${entry.name}"? This cannot be undone.`,
      confirmLabel: 'Delete page',
      danger: true
    });
    if (!confirmed) return;
    deletingPage = true;
    try {
      await api(`/api/cases/${encodeURIComponent(entry.id)}/files/${encodeURIComponent(file.id)}`, { method: 'DELETE' });
      files.splice(currentIndex, 1);
      entry.files = files;
      entry.file = files[0].file;
      currentIndex = Math.min(currentIndex, files.length - 1);
      stack.classList.toggle('single-page', files.length < 2);
      renderPage(1);
      toast('Page removed from the dossier.');
    } catch (error) {
      toast(error.message || 'The page could not be deleted.', { kind: 'error' });
    } finally {
      deletingPage = false;
    }
  };

  openModal({
    title: entry.name,
    content: body,
    className: 'case-viewer',
    closeLabel: 'Close',
    actions: [
      { label: 'Delete case', variant: 'danger', onClick: () => { setTimeout(() => deleteCase(entry)); } },
      { label: 'Delete page', variant: 'danger', onClick: () => { deleteCurrentPage(); return false; } },
      { label: 'Edit / add pages', onClick: () => { setTimeout(() => openCaseEditForm(entry)); } },
      { label: 'Open original', onClick: () => { window.open(scanUrl(currentFile()), '_blank', 'noopener'); return false; } }
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
  const existingFiles = caseFiles(entry);
  const form = el('form', 'task-form case-form case-edit-form');
  form.noValidate = true;
  form.innerHTML = `
    <p class="case-edit-caption"></p>
    <label class="field">
      <span class="field-label">Team rank</span>
      <span class="case-score-input"><input name="score" type="text" maxlength="6" pattern="[A-Za-z0-9+-]{1,6}" placeholder="A-, 10+, S++" value="${caseScore(entry) ?? ''}" autocomplete="off" autofocus></span>
    </label>
    ${outcomeFields(caseOutcome(entry))}
    <div class="field">
      <span class="field-label">Add case files <small>(optional)</small></span>
      <label class="case-drop case-drop-compact">
        <input name="files" type="file" accept="${SCAN_TYPES}" multiple>
        <span class="case-drop-text"></span>
      </label>
    </div>`;
  form.querySelector('.case-edit-caption').textContent = `${caseNumber(entry)} · ${entry.name}`;

  const scoreInput = form.elements.score;
  const fileInput = form.elements.files;
  const drop = form.querySelector('.case-drop');
  const dropText = form.querySelector('.case-drop-text');
  dropText.textContent = `${existingFiles.length} page${existingFiles.length === 1 ? '' : 's'} already filed · choose full pages to append`;
  scoreInput.addEventListener('input', () => normalizeScoreInput(scoreInput));
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    drop.classList.remove('invalid');
    if (files.length) {
      const total = files.reduce((sum, file) => sum + file.size, 0);
      dropText.textContent = `Add ${files.length} page${files.length === 1 ? '' : 's'} · ${(total / 1024 / 1024).toFixed(1)} MB total`;
    }
  });
  let saving = false;
  const save = async () => {
    const score = scoreInput.value.trim().toUpperCase();
    const files = Array.from(fileInput.files || []);
    if (!/^[A-Z0-9+-]{1,6}$/.test(score)) {
      scoreInput.classList.add('invalid');
      scoreInput.focus();
      return;
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_SCAN_BYTES) {
      drop.classList.add('invalid');
      toast('The selected pages exceed 100 MB in total. Compress them before filing.', { kind: 'warn', duration: 6000 });
      return;
    }
    scoreInput.value = score;
    saving = true;
    try {
      const { case: updated } = await api(`/api/cases/${encodeURIComponent(entry.id)}`, {
        method: 'PATCH',
        body: new FormData(form)
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
    message: `"${entry.name}" and all of its pages will be removed from the archive folder. This can't be undone.`,
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
  const envelope = view?.querySelector(`.case-shelf-slot.is-center .case-envelope[data-id="${CSS.escape(entry.id)}"]`)
    || view?.querySelector(`.case-envelope[data-id="${CSS.escape(entry.id)}"]`);
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
      <span class="field-label">Team rank</span>
      <span class="case-score-input"><input name="score" type="text" maxlength="6" pattern="[A-Za-z0-9+-]{1,6}" placeholder="A-, 10+, S++" autocomplete="off"></span>
    </label>
    ${outcomeFields()}
    <div class="field">
      <span class="field-label">Case files</span>
      <label class="case-drop">
        <input name="files" type="file" accept="${SCAN_TYPES}" multiple>
        <span class="case-drop-text">Drop one or more pages here or click to choose<br><small>JPG, PNG, WEBP or PDF, up to 100 MB total</small></span>
        <img class="case-drop-preview" alt="" hidden>
      </label>
    </div>
    <button type="submit" hidden></button>`;

  const today = new Date();
  form.elements.date.value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, '0'), String(today.getDate()).padStart(2, '0')].join('-');

  const nameInput = form.elements.name;
  const scoreInput = form.elements.score;
  const fileInput = form.elements.files;
  const drop = form.querySelector('.case-drop');
  const dropText = form.querySelector('.case-drop-text');
  const preview = form.querySelector('.case-drop-preview');
  let previewUrl = '';

  const showFile = () => {
    const files = Array.from(fileInput.files || []);
    const file = files[0];
    drop.classList.remove('invalid');
    URL.revokeObjectURL(previewUrl);
    previewUrl = '';
    preview.hidden = true;
    if (!file) return;
    const total = files.reduce((sum, selected) => sum + selected.size, 0);
    dropText.textContent = files.length === 1
      ? `${file.name} · ${(total / 1024 / 1024).toFixed(1)} MB`
      : `${files.length} pages selected · ${(total / 1024 / 1024).toFixed(1)} MB total`;
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
  scoreInput.addEventListener('input', () => normalizeScoreInput(scoreInput));

  const flag = field => {
    field.classList.remove('invalid');
    void field.offsetWidth;
    field.classList.add('invalid');
  };

  let uploading = false;
  const submit = async () => {
    const name = nameInput.value.trim();
    const score = scoreInput.value.trim().toUpperCase();
    const files = Array.from(fileInput.files || []);
    if (!name) { flag(nameInput); nameInput.focus(); return; }
    if (!/^[A-Z0-9+-]{1,6}$/.test(score)) { flag(scoreInput); scoreInput.focus(); return; }
    scoreInput.value = score;
    if (!files.length) { flag(drop); return; }
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_SCAN_BYTES) {
      toast('The selected pages exceed 100 MB in total. Compress them before filing.', { kind: 'warn', duration: 6000 });
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
      toast(error.message || 'The pages could not be filed.', { kind: 'error', duration: 6000 });
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

// ---------- archive transfer ----------
/**
 * Download the whole archive as one .zip (index plus every scan).
 *
 * The bundle is built server-side and can be large, so the button reports progress and the
 * download goes through a blob rather than navigating away from the tracker.
 */
async function downloadCaseArchive(button) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing...';
  try {
    const response = await fetch('/api/cases/archive');
    if (!response.ok) {
      let detail = null;
      try { detail = (await response.json())?.message; } catch { /* not a JSON API response */ }
      throw new Error(detail || `Request failed (${response.status})`);
    }
    if (!response.headers.get('content-type')?.includes('application/zip')) {
      throw new Error('The tracker returned an unexpected response instead of a ZIP archive');
    }
    const blob = await response.blob();
    const stamp = new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `case-archive-${stamp}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Case archive exported.');
  } catch (error) {
    console.error('Failed to export the case archive', error);
    const message = error instanceof TypeError
      ? 'The case archive could not be exported because the tracker server is not reachable.'
      : `The case archive could not be exported: ${error.message}`;
    toast(message, { kind: 'error', duration: 7000 });
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

/** Pick an exported .zip and restore it, asking first how it should meet the local archive. */
function uploadCaseArchive(localCount) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    const mode = await askArchiveMode(file.name, localCount);
    if (!mode) return;

    const body = new FormData();
    body.append('archive', file);
    body.append('mode', mode);
    try {
      const result = await api('/api/cases/archive', { method: 'POST', body });
      await renderPreviousCases();
      const scans = result.scans || 0;
      toast(result.added
        ? `Restored ${result.added} ${result.added === 1 ? 'case' : 'cases'} and ${scans} ${scans === 1 ? 'scan' : 'scans'}.`
        : 'Every case in that archive was already filed here.');
    } catch (error) {
      console.error('Failed to load the case archive', error);
      toast(error.message || 'That archive could not be loaded. The cases already here are unchanged.', { kind: 'error', duration: 7000 });
    }
  });
  input.click();
}

/** Merge or replace, before anything is written. Resolves to null when dismissed. */
function askArchiveMode(filename, localCount) {
  return new Promise(resolve => {
    const body = el('p', 'modal-message', localCount
      ? `${filename} will be restored into an archive that already holds ${localCount} ${localCount === 1 ? 'case' : 'cases'}. Merging adds the cases that are missing here; replacing makes the archive match the file. Scans already on this terminal are kept either way.`
      : `${filename} will be restored into this terminal's archive, scans included.`);
    let choice = null;
    openModal({
      title: 'Load case archive',
      content: body,
      closeLabel: 'Cancel',
      actions: [
        ...(localCount ? [{ label: 'Replace Archive', variant: 'danger', onClick: () => { choice = 'replace'; } }] : []),
        { label: localCount ? 'Merge' : 'Load Archive', variant: 'primary', onClick: () => { choice = 'merge'; } }
      ],
      onClose: () => resolve(choice)
    });
  });
}

// ---------- view ----------
function renderArchive(cases, highlight) {
  const desk = el('div', 'cases-desk');

  if (cases.length) {
    const shelfCases = cases.slice(-10);
    const highlightedIndex = highlight ? shelfCases.findIndex(entry => entry.id === highlight) : -1;
    let centerIndex = highlightedIndex >= 0 ? highlightedIndex : shelfCases.length - 1;
    let moving = false;
    const shelf = el('section', 'cases-shelf');
    shelf.setAttribute('aria-label', 'Case-file shelf');
    const heading = el('div', 'cases-shelf-heading');
    heading.append(
      el('span', 'cases-shelf-title', 'Filed dossiers'),
      el('span', 'cases-shelf-hint', shelfCases.length > 1 ? 'Scroll or use ← → to browse' : 'Latest dossier')
    );
    const carousel = el('div', 'cases-carousel');
    carousel.tabIndex = 0;
    carousel.setAttribute('role', 'region');
    carousel.setAttribute('aria-roledescription', 'bookshelf carousel');
    const announcement = el('span', 'cases-shelf-announcement');
    announcement.setAttribute('aria-live', 'polite');
    const shelfPosition = offset => {
      if (offset === 0) return '50%';
      const direction = offset < 0 ? '-' : '+';
      const extraSteps = Array(Math.max(0, Math.abs(offset) - 1)).fill(` ${direction} var(--spine-step)`).join('');
      return `calc(50% ${direction} var(--folder-clearance)${extraSteps})`;
    };

    const updateSlot = (slot, entryIndex) => {
      const entry = shelfCases[entryIndex];
      const offset = entryIndex - centerIndex;
      slot.classList.toggle('is-center', offset === 0);
      slot.style.setProperty('--shelf-left', shelfPosition(offset));
      slot.style.setProperty('--shelf-next-left', shelfPosition(offset - 1));
      slot.style.setProperty('--shelf-previous-left', shelfPosition(offset + 1));
      slot.style.setProperty('--shelf-offset', String(offset));
      slot.style.setProperty('--shelf-distance', String(Math.abs(offset)));
      slot.style.setProperty('--shelf-z', String(20 - Math.abs(offset)));
      slot.style.setProperty('--shelf-fold', `${Math.sign(offset) * 88}deg`);
      slot.dataset.offset = String(offset);
      const spine = slot.querySelector('.case-spine');
      spine.setAttribute('aria-label', `${offset < 0 ? 'Previous' : 'Next'} dossier: ${entry.name}`);
      const envelope = slot.querySelector('.case-envelope');
      envelope.tabIndex = offset === 0 ? 0 : -1;
      if (offset !== 0) envelope.classList.remove('filed');
    };

    const paintShelf = () => {
      if (!carousel.children.length) shelfCases.forEach((entry, entryIndex) => {
        const offset = entryIndex - centerIndex;
        const slot = el('div', 'case-shelf-slot');
        slot.dataset.caseIndex = String(entryIndex);
        slot.dataset.caseId = entry.id;

        const spine = el('button', 'case-spine');
        spine.type = 'button';
        spine.tabIndex = -1;
        spine.append(
          el('span', 'case-spine-number', caseNumber(entry, { short: true })),
          el('span', 'case-spine-name', entry.name)
        );
        spine.addEventListener('click', () => turnShelf(Number(slot.dataset.offset) < 0 ? -1 : 1));

        const envelope = createEnvelope(entry, Math.abs(offset), (node, selected) => {
          const currentOffset = Number(slot.dataset.offset);
          if (currentOffset === 0) openCase(node, selected);
          else turnShelf(currentOffset < 0 ? -1 : 1);
        });
        if (offset === 0 && entry.id === highlight) envelope.classList.add('filed');
        slot.append(spine, envelope);
        carousel.appendChild(slot);
      });
      shelfCases.forEach((entry, entryIndex) => {
        const slot = carousel.querySelector(`.case-shelf-slot[data-case-index="${entryIndex}"]`);
        updateSlot(slot, entryIndex);
      });
      const selected = shelfCases[centerIndex];
      carousel.setAttribute('aria-label', `Selected dossier: ${selected.name}. Scroll to browse; press Enter to open.`);
      announcement.textContent = `${caseNumber(selected)}: ${selected.name}`;
    };

    const turnShelf = direction => {
      if (moving) return;
      const targetIndex = centerIndex + direction;
      if (targetIndex < 0 || targetIndex >= shelfCases.length) return;
      moving = true;
      const reduced = reducedMotion();
      carousel.classList.add(direction > 0 ? 'shelf-next' : 'shelf-previous');
      const delay = reduced ? 0 : SHELF_TURN_MS;
      setTimeout(() => {
        centerIndex = targetIndex;
        carousel.classList.remove('shelf-next', 'shelf-previous');
        paintShelf();
        moving = false;
        carousel.focus({ preventScroll: true });
      }, delay);
    };

    carousel.addEventListener('wheel', event => {
      if (Math.max(Math.abs(event.deltaX), Math.abs(event.deltaY)) < 4) return;
      event.preventDefault();
      if (moving) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      turnShelf(delta > 0 ? -1 : 1);
    }, { passive: false });
    carousel.addEventListener('keydown', event => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); turnShelf(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); turnShelf(1); }
      if (event.key === 'Enter' || event.key === ' ') {
        if (event.target === carousel) {
          event.preventDefault();
          carousel.querySelector('.case-shelf-slot.is-center .case-envelope')?.click();
        }
      }
    });
    paintShelf();
    shelf.append(heading, carousel, announcement);
    desk.appendChild(shelf);
  } else {
    desk.appendChild(el('p', 'cases-empty', 'No cases filed yet. After each mission, file the pages of its Rapporto di Fine Incarico here.'));
  }

  const add = el('button', 'cases-add', '+ File a new case');
  add.type = 'button';
  add.addEventListener('click', openCaseForm);
  desk.appendChild(add);

  // Moving the whole archive between terminals: one .zip with the index and every scan.
  const transfer = el('div', 'cases-transfer');
  const exportButton = el('button', 'cases-transfer-button', 'Export Archive');
  exportButton.type = 'button';
  exportButton.title = 'Download every filed case and its scans as one .zip';
  exportButton.disabled = !cases.length;
  exportButton.addEventListener('click', () => downloadCaseArchive(exportButton));
  const loadButton = el('button', 'cases-transfer-button', 'Load Archive');
  loadButton.type = 'button';
  loadButton.title = 'Restore cases and scans from an exported .zip';
  loadButton.addEventListener('click', () => uploadCaseArchive(cases.length));
  transfer.append(exportButton, loadButton);
  desk.appendChild(transfer);

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
    trigger.addEventListener('click', async () => {
      if (vault.classList.contains('opening')) return;
      const sequence = ++gateSequence;
      archiveUnlocked = true;
      trigger.setAttribute('aria-expanded', 'true');
      vault.classList.add('alarming');
      const delay = soundStartDelay() / 1000;
      playButton('previousCases', 'openVault');

      if (!reducedMotion()) {
        const t = gateTimes();
        // Locks jolt loose, the doors hold, then speed up until the slam and brake to a stop.
        const settle = Math.min(t.disengage + 0.3, t.openStart);
        const motion = animateGates(vault, [
          [0, 0],
          [t.disengage, 0, 'cubic-bezier(.2,.9,.3,1)'],
          [Math.min(t.disengage + 0.08, settle), GATE_JOLT, 'ease-in-out'],
          [settle, GATE_JOLT * 0.6],
          [t.openStart, GATE_JOLT * 0.6, EASE_IN],
          [t.openSlam, t.slam, EASE_OUT],
          [t.openEnd, 1]
        ].map(([time, ...rest]) => [time + delay, ...rest]));
        await wait((delay + t.openStart) * 1000);
        if (sequence !== gateSequence) return;
        vault.classList.add('opening', 'open');   // warning and seal fade, files start dealing in
        await motion;
        if (sequence !== gateSequence) return;
        releaseGates(vault);
      } else {
        vault.classList.add('opening', 'open');
      }

      vault.classList.add('settled');
      desk.inert = false;
      trigger.disabled = true;
      trigger.tabIndex = -1;
      desk.querySelector('.cases-carousel, .cases-add')?.focus({ preventScroll: true });
    });
  }

  view.replaceChildren(vault);
  if (highlight) view.querySelector('.case-envelope.filed')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * The case archive as it travels in a team file: metadata only.
 *
 * The scans themselves stay on the machine that filed them (they are far too big for browser
 * storage), so each page carries its name, filename and brightness. Copy cases/ across as
 * well and the pages line up again by filename.
 */
export async function exportCaseArchive() {
  const { cases } = await api('/api/cases');
  return (cases || []).map(entry => ({
    id: entry.id,
    number: entry.number,
    name: entry.name,
    code: entry.code || '',
    date: entry.date,
    score: entry.score,
    outcome: entry.outcome,
    added: entry.added,
    files: (entry.files || []).map(file => ({
      id: file.id,
      file: file.file,
      name: file.name,
      brightness: file.brightness
    }))
  }));
}

/**
 * Bring a team file's case archive into this machine's archive.
 * mode: 'merge' keeps what is filed here, 'replace' mirrors the team file exactly.
 */
export async function importCaseArchive(cases, mode = 'merge') {
  const result = await api('/api/cases/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, cases })
  });
  return { added: result.added || 0, kept: result.kept || 0 };
}

/**
 * Called after every change to the archive so the team file keeps the current index.
 * Set by app.js; absent until then, and a no-op when nothing is listening.
 */
let onArchiveChanged = null;

export function setArchiveChangeHandler(handler) {
  onArchiveChanged = handler;
}

/** Fetch the archive and lay the envelopes out again (they drop in every time the tab opens). */
export async function renderPreviousCases({ highlight } = {}) {
  if (!view) return;
  const current = ++request;
  try {
    const { cases } = await api('/api/cases');
    if (current !== request) return;
    renderArchive(cases, highlight);
    // The save file tracks the archive, so a filed, edited or deleted case lands in it too.
    onArchiveChanged?.();
  } catch (error) {
    if (current !== request) return;
    console.error('Failed to load previous cases', error);
    view.replaceChildren(el('p', 'cases-empty',
      'The case archive needs the tracker server. Start it with start_server.bat and reload this page.'));
  }
}

/** Close the archive in front of the files; callers await this before hiding the tab. */
export async function closePreviousCases() {
  const vault = view?.querySelector('.cases-vault');
  if (!archiveUnlocked || !vault) {
    archiveUnlocked = false;
    return;
  }

  archiveUnlocked = false;
  const sequence = ++gateSequence;
  const trigger = vault.querySelector('.cases-vault-trigger');
  const desk = vault.querySelector('.cases-desk');
  desk.inert = true;
  trigger.disabled = true;
  trigger.setAttribute('aria-expanded', 'false');
  vault.classList.remove('alarming', 'opening', 'settled');
  vault.classList.add('closing');
  const delay = soundStartDelay() / 1000;
  playButton('previousCases', 'closeVault');

  if (reducedMotion()) {
    vault.classList.remove('open');
    vault.classList.add('closed');
    return;
  }

  // The doors hold, speed up until the slam, then creep the rest of the way shut.
  const t = gateTimes();
  const motion = animateGates(vault, [
    [0, 1],
    [t.closeStart, 1, EASE_IN],
    [t.closeSlam, 1 - t.slam, EASE_OUT],
    [t.closeEnd, 0]
  ].map(([time, ...rest]) => [time + delay, ...rest]));
  vault.classList.remove('open');
  await motion;
  if (sequence !== gateSequence) return;
  releaseGates(vault);
  vault.classList.add('closed');
}

export function initPreviousCases() {
  view = document.getElementById('previousCasesView');
}
