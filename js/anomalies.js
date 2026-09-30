import { ANOMALY_ABILITIES } from './anomalyData.js';
import { normalizeAbilityState } from './anomalyState.js';
import { getCharElements } from './charSystem.js';
import { createLifeWorkTrack, reachedCodes, TRACK_LENGTH } from './lifeWorkTrack.js';
import { saveSettings } from './storage.js';
import { openModal, toast } from './ui.js';

// ARC_Dossier page 8: the bottom row continues from right to left.
const DOCUMENTS = { 1: 'H4', 2: 'H3', 5: 'U2', 7: 'X2', 11: 'N1', 13: 'Q2', 17: 'L10', 19: 'G8', 23: 'A7' };
let view;
let expanded = null;
let openCard = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

function track(card) {
  const section = el('section', 'anomaly-track-section');
  const count = el('span', 'anomaly-progress');
  const showCount = () => { count.textContent = `${card._anomalyState.progress} / ${TRACK_LENGTH}`; };
  const squares = createLifeWorkTrack({
    label: 'Tracciato Anomalia', className: 'anomaly-track', squareClass: 'anomaly-square', codes: DOCUMENTS,
    get: () => card._anomalyState.progress,
    set: value => { card._anomalyState.progress = value; },
    onChange: (previous, next) => {
      showCount();
      const unlocked = reachedCodes(DOCUMENTS, previous, next);
      if (unlocked.length) toast(`Leggi in Playwall: ${unlocked.join(', ')}.`);
    }
  });
  showCount();
  section.append(el('h3', '', 'Tracciato Anomalia'), count, squares);
  const rules = el('details', 'anomaly-rules');
  rules.append(el('summary', '', 'Come usare il tracciato'));
  rules.append(el('p', '', 'Segna 1 casella per unità di Tempo disponibile a fine Incarico. Quando segni un tracciato, cancella l’ultima casella dei tracciati che non hai scelto. Se trovi un codice, leggi il Documento in Playwall.'));
  rules.append(el('p', '', 'Fai Pratica: segna Usata? di un’Abilità Anomala. Scopri Te Stesso: cancella Usata?, poni la domanda alla Squadra e segna una casella della risposta più votata. Quando riempi una risposta, leggi il suo Documento.'));
  rules.append(el('p', '', 'Quando ricevi la Distinzione Sospeso, segna 1 casella Anomalia senza cancellare altre caselle.'));
  section.append(rules);
  return section;
}

function statOf(card, key) {
  return card.querySelector(`[data-stat="${key}"]`)?.value.trim() || '';
}

function agentName(card, index) {
  return statOf(card, 'name') || `Agent ${index + 1}`;
}

function trackSummary(card) {
  const section = el('section', 'anomaly-summary-track');
  section.append(el('span', 'anomaly-summary-track-label', 'Tracciato Anomalia'));
  const count = el('strong', 'anomaly-summary-progress', `${card._anomalyState.progress} / ${TRACK_LENGTH}`);
  const squares = el('span', 'anomaly-summary-squares');
  for (let n = 1; n <= TRACK_LENGTH; n++) {
    const square = el('span', 'anomaly-summary-square', DOCUMENTS[n] || '');
    square.classList.toggle('reached', n <= card._anomalyState.progress);
    square.style.gridRow = n <= 15 ? '1' : '2';
    square.style.gridColumn = String(n <= 15 ? n : 31 - n);
    squares.append(square);
  }
  section.append(count, squares);
  return section;
}

function answerRow(answer, state, index) {
  const row = el('div', 'anomaly-answer');
  row.append(el('p', 'anomaly-answer-text', `R: ${answer.text}`));
  const controls = el('div', 'anomaly-answer-controls');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', `Tracciato risposta: ${answer.text}`);
  controls.append(el('span', 'answer-arrow', '➜'));
  const boxes = [];
  for (let n = 1; n <= 3; n++) {
    const box = button('', 'answer-square', () => {
      const previous = state.answers[index];
      state.answers[index] = previous === n ? n - 1 : n;
      boxes.forEach((b, i) => b.setAttribute('aria-pressed', String(i < state.answers[index])));
      saveSettings();
      if (previous < 3 && state.answers[index] === 3 && answer.reference) toast(`Leggi il Documento ${answer.reference} in Playwall.`);
    });
    box.setAttribute('aria-label', `Risposta ${index + 1}, casella ${n}`);
    box.setAttribute('aria-pressed', String(n <= state.answers[index]));
    boxes.push(box); controls.append(box);
  }
  controls.append(el('strong', 'answer-reference', answer.reference));
  row.append(controls);
  return row;
}

function editAbility(card, ability) {
  const form = el('form', 'task-form');
  const fields = {};
  const definitions = [
    ['name', 'Nome', false, ability?.name], ['effects', 'Effetti', true, ability?.effects],
    ['question', 'Domanda', true, ability?.question],
    ['answer0', 'Risposta 1', true, ability?.answers[0].text], ['ref0', 'Riferimento 1 (es. T2)', false, ability?.answers[0].reference],
    ['answer1', 'Risposta 2', true, ability?.answers[1].text], ['ref1', 'Riferimento 2 (es. P4)', false, ability?.answers[1].reference]
  ];
  definitions.forEach(([key, label, multiline, value]) => {
    const field = el('label', 'field');
    const input = el(multiline ? 'textarea' : 'input', 'rel-field');
    if (multiline) input.rows = key === 'effects' ? 5 : 2;
    input.value = value || '';
    input.required = key === 'name' || key === 'effects';
    if (key.startsWith('ref')) input.pattern = '[A-Za-z][0-9]+';
    field.append(el('span', 'field-label', label), input);
    fields[key] = input; form.append(field);
  });
  openModal({
    title: ability ? 'Modifica abilità' : 'Nuova abilità', content: form, className: 'anomaly-edit-modal', closeLabel: 'Annulla',
    actions: [{ label: 'Salva', variant: 'primary', submit: true, onClick: () => {
      Object.values(fields).forEach(input => { input.value = input.value.trim(); });
      if (!form.reportValidity()) return false;
      const updated = {
        name: fields.name.value, effects: fields.effects.value, question: fields.question.value,
        answers: [0, 1].map(i => ({ text: fields[`answer${i}`].value, reference: fields[`ref${i}`].value.toUpperCase() }))
      };
      if (ability) Object.assign(ability, updated);
      else {
        ability = { ...updated, id: crypto.randomUUID(), state: normalizeAbilityState() };
        card._anomalyState.custom.push(ability);
      }
      expanded = { card, key: `custom:${ability.id}` };
      saveSettings(); renderAnomalies();
    } }]
  });
}

function usedToggle(ability, state) {
  const used = button('Usata?', 'anomaly-used', () => {
    state.used = !state.used;
    used.setAttribute('aria-pressed', String(state.used));
    saveSettings();
  });
  used.setAttribute('aria-label', `Usata? ${ability.name}`);
  used.setAttribute('aria-pressed', String(state.used));
  return used;
}

function abilityState(card, ability, key, custom) {
  return custom ? ability.state : (card._anomalyState.abilities[key] ||= normalizeAbilityState());
}

/** Closed ability in the list: its name opens it on its own, like the agent summaries. */
function abilityTile(card, ability, key, custom = false) {
  const state = abilityState(card, ability, key, custom);
  const article = el('article', 'anomaly-ability anomaly-ability-tile');
  const open = button('', 'anomaly-ability-open', () => openAbility(card, key));
  open.append(el('span', 'anomaly-ability-name', ability.name), el('span', 'anomaly-open', 'Apri ›'));
  open.setAttribute('aria-label', `Apri ${ability.name}`);
  article.append(open, usedToggle(ability, state));
  return article;
}

/** The open ability, shown alone at full size. */
function abilityFull(card, ability, key, custom = false) {
  const state = abilityState(card, ability, key, custom);
  const article = el('article', 'anomaly-ability anomaly-ability-full');
  const header = el('header', 'anomaly-ability-header');
  header.append(el('h3', 'anomaly-ability-title', ability.name), usedToggle(ability, state));
  const body = el('div', 'anomaly-ability-body');
  body.append(el('p', 'anomaly-effects', ability.effects));
  if (ability.question || ability.answers.some(a => a.text)) {
    const question = el('section', 'anomaly-question');
    question.append(el('h4', '', `D: ${ability.question}`));
    ability.answers.forEach((answer, index) => question.append(answerRow(answer, state, index)));
    body.append(question);
  }
  if (custom) {
    const controls = el('div', 'anomaly-custom-controls');
    controls.append(button('Modifica', 'modal-btn', () => editAbility(card, ability)));
    controls.append(button('Rimuovi', 'modal-btn', () => {
      const index = card._anomalyState.custom.indexOf(ability);
      card._anomalyState.custom.splice(index, 1);
      expanded = null; saveSettings(); renderAnomalies();
      toast('Abilità rimossa.', { action: { label: 'Annulla', onClick: () => {
        card._anomalyState.custom.splice(index, 0, ability); saveSettings(); renderAnomalies();
      } } });
    }));
    body.append(controls);
  } else {
    const source = el('a', 'anomaly-source', 'Scheda originale');
    source.href = `./Materiale/Anomalia_lista.pdf#page=${ability.page}`;
    source.target = '_blank'; source.rel = 'noopener';
    body.append(source);
  }
  article.append(header, body);
  return article;
}

function abilityEntries(card, anomaly) {
  return [
    ...(ANOMALY_ABILITIES[anomaly] || []).map((ability, i) => ({ ability, key: `${anomaly}:${i}`, custom: false })),
    ...card._anomalyState.custom.map(ability => ({ ability, key: `custom:${ability.id}`, custom: true }))
  ];
}

function createAbilityNav(card, entries, backLabel) {
  const nav = el('nav', 'anomaly-detail-nav anomaly-ability-nav');
  nav.setAttribute('aria-label', 'Abilità');
  nav.append(button(`‹ ${backLabel}`, 'anomaly-back', closeAbility));
  const switcher = el('div', 'anomaly-switcher');
  entries.forEach(({ ability, key }) => {
    const chip = button(ability.name, 'anomaly-switch', () => openAbility(card, key));
    if (expanded?.key === key) chip.setAttribute('aria-current', 'true');
    switcher.append(chip);
  });
  nav.append(switcher);
  return nav;
}

function createSummary(card, index) {
  const anomaly = statOf(card, 'anomaly');
  const baseAbilities = ANOMALY_ABILITIES[anomaly] || [];
  const abilityCount = baseAbilities.length + card._anomalyState.custom.length;
  const usedCount = baseAbilities.filter((_, index) => card._anomalyState.abilities[`${anomaly}:${index}`]?.used).length
    + card._anomalyState.custom.filter(ability => ability.state.used).length;
  const summary = button('', 'anomaly-summary', () => openAgent(card));
  summary.classList.toggle('dead', card.classList.contains('dead'));
  summary.setAttribute('aria-label', `${agentName(card, index)}. Anomalia: ${anomaly || 'nessuna'}. Tracciato ${card._anomalyState.progress} di ${TRACK_LENGTH}.`);
  summary.append(
    identity(card, index),
    trackSummary(card),
    el('span', 'anomaly-summary-counts', `${usedCount}/${abilityCount} abilità usate`),
    el('span', 'anomaly-open', 'Apri ›')
  );
  return summary;
}

function createAgentNav(cards) {
  const nav = el('nav', 'anomaly-detail-nav');
  nav.setAttribute('aria-label', 'Agenti');
  nav.append(button('‹ Tutti gli agenti', 'anomaly-back', showOverview));
  const switcher = el('div', 'anomaly-switcher');
  cards.forEach((card, index) => {
    const chip = button(agentName(card, index), 'anomaly-switch', () => openAgent(card));
    if (card === openCard) chip.setAttribute('aria-current', 'true');
    switcher.append(chip);
  });
  nav.append(switcher);
  return nav;
}

/** Portrait, name, and player · Anomalia under it (overview tiles and the agent's page). */
function identity(card, index) {
  const box = el('span', 'anomaly-identity');
  const portrait = el('img', '');
  portrait.src = card.querySelector('img')?.src || './images/pfp.jpg';
  portrait.alt = '';
  const text = el('span', 'anomaly-identity-text');
  text.append(
    el('strong', 'anomaly-name', agentName(card, index)),
    el('span', 'anomaly-subtitle', [statOf(card, 'player'), statOf(card, 'anomaly')].filter(Boolean).join(' · '))
  );
  box.append(portrait, text);
  return box;
}

function createDetail(card, cards) {
  const index = cards.indexOf(card);
  const anomaly = statOf(card, 'anomaly');
  const entries = abilityEntries(card, anomaly);
  const openEntry = expanded?.card === card ? entries.find(entry => entry.key === expanded.key) : null;
  if (!openEntry) expanded = null;

  const detail = el('section', 'anomaly-detail');
  // an open ability gets the whole view, like an item on the Agency tab
  if (openEntry) {
    detail.setAttribute('aria-label', `${agentName(card, index)}: ${openEntry.ability.name}`);
    const page = el('div', 'anomaly-abilities anomaly-ability-page');
    page.append(abilityFull(card, openEntry.ability, openEntry.key, openEntry.custom));
    detail.append(createAbilityNav(card, entries, agentName(card, index)), page);
    return detail;
  }
  detail.setAttribute('aria-label', `${agentName(card, index)}: Anomalia`);

  const profile = el('div', 'anomaly-profile');
  profile.classList.toggle('dead', card.classList.contains('dead'));
  profile.append(identity(card, index), track(card));

  const abilityList = el('div', 'anomaly-abilities');
  abilityList.append(el('h3', 'anomaly-abilities-title', 'Abilità Anomale'));
  if (!ANOMALY_ABILITIES[anomaly]?.length) abilityList.append(el('p', 'anomaly-hint', 'Seleziona un’Anomalia nella scheda Agents per visualizzare le abilità.'));
  const grid = el('div', 'anomaly-ability-grid');
  grid.append(...entries.map(({ ability, key, custom }) => abilityTile(card, ability, key, custom)));
  grid.append(button('+ Aggiungi abilità', 'rel-add', () => editAbility(card)));
  abilityList.append(grid);

  const content = el('div', 'anomaly-detail-content');
  content.append(profile, abilityList);
  detail.append(createAgentNav(cards), content);
  return detail;
}

function openAbility(card, key) {
  expanded = { card, key };
  renderAnomalies();
  view.scrollTop = 0;
  view.querySelector('.anomaly-ability-nav .anomaly-switch[aria-current="true"]')?.focus();
}

function closeAbility() {
  const key = expanded?.key;
  expanded = null;
  renderAnomalies();
  const tiles = [...view.querySelectorAll('.anomaly-ability-open')];
  const entries = abilityEntries(openCard, statOf(openCard, 'anomaly'));
  tiles[entries.findIndex(entry => entry.key === key)]?.focus();
}

function openAgent(card) {
  if (card === openCard) return;
  openCard = card;
  expanded = null;
  renderAnomalies();
  view.querySelector('.anomaly-switch[aria-current="true"]')?.focus();
}

function showOverview() {
  const previous = openCard;
  openCard = null;
  expanded = null;
  renderAnomalies();
  view.querySelectorAll('.anomaly-summary')[getCharElements().indexOf(previous)]?.focus();
}

export function renderAnomalies({ overview = false } = {}) {
  if (!view) return;
  const cards = getCharElements();
  if (overview || !cards.includes(openCard)) openCard = null;
  if (!cards.length) {
    view.replaceChildren(el('p', 'rel-empty', 'Nessun agente. Aggiungi un agente con Hire Agent.'));
    return;
  }
  if (openCard) {
    view.replaceChildren(createDetail(openCard, cards));
    return;
  }
  const overviewGrid = el('div', 'anomaly-overview');
  overviewGrid.append(...cards.map(createSummary));
  view.replaceChildren(overviewGrid);
}

export function initAnomalies() {
  view = document.getElementById('anomalyView');
  document.addEventListener('dashboard-refresh', () => { if (!view.hidden) renderAnomalies(); });
  view.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !openCard || event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    if (expanded) closeAbility();
    else showOverview();
  });
}
