// relationships.js
// Responsibilities: the Relationships view (the alternate main tab). The overview gives
// each agent a summary column: Reality, how many relationships, how many are in Network and
// the Realtà track of the Agenda Vita-Lavoro at a glance. Clicking an agent opens their page:
// the Realtà track (ARC_Dossier page 8), the Dose di Realtà track (0-5, 5 = X) and their
// relationships as tiles. Clicking one opens it on its own page, laid out like the Relazioni
// sheet of the ARC dossier: name, picture, who plays them, description, a 0-9 track
// (9 = Network) and a Relationship Bonus with its Active box. The data lives on the agent
// card (card._realityProgress, card._realityDose, card._relationships), so it is saved,
// exported and restored together with the rest of the agent.

import {
  MAX_CONNECTION, MAX_REALITY_DOSE, animateOnce, bindImagePicker, createChoiceSelect,
  getCharElements, loadImageFile, normalizeRelationship
} from './charSystem.js';
import { createLifeWorkTrack, reachedCodes, TRACK_LENGTH } from './lifeWorkTrack.js';
import { saveSettings } from './storage.js';
import { toast } from './ui.js';

const PICTURE_SIZE = 128;    // px, longest side after downscaling (shown at 56px)
const MANAGER = 'Manager';   // the GM can play a relationship too
const DOSE_NOTE = 'Devi scegliere un nuovo tipo di Realtà.';   // printed under every Reality's track
// Playwall Documents on the Realtà track (ARC_Dossier page 8); the bottom row runs right to left.
const DOCUMENTS = { 1: 'C4', 4: 'L11', 8: 'E2', 10: 'O4', 14: 'T6', 16: 'V2', 20: 'X3', 22: 'H5', 26: 'E3' };

let view = null;
let openCard = null;   // the agent whose page is open; null shows the overview
let openRelationship = null;   // the relationship shown on its own page, one of openCard's

function relationshipsOf(card) {
  if (!Array.isArray(card._relationships)) card._relationships = [];
  return card._relationships;
}

function statOf(card, key) {
  return card.querySelector(`[data-stat="${key}"]`)?.value.trim() || '';
}

function agentName(card, index) {
  return statOf(card, 'name') || `Agent ${index + 1}`;
}

function portraitOf(card) {
  return card.querySelector('img')?.src || './images/pfp.jpg';
}

function inNetwork(relationship) {
  return relationship.connection >= MAX_CONNECTION;
}

/** Everyone who can play a relationship: the branch's players, then the Manager. */
function playerChoices() {
  const players = getCharElements().map(card => statOf(card, 'player')).filter(Boolean);
  return [...new Set([...players, MANAGER])];
}

/** Text input or textarea bound to one text field of a relationship. */
function createTextField(relationship, key, { label, multiline = false, ...props }) {
  const field = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) field.type = 'text';
  Object.assign(field, props);
  field.className = `rel-field rel-${key}`;
  field.setAttribute('aria-label', label);
  field.value = relationship[key];
  field.addEventListener('input', () => {
    relationship[key] = field.value;
    saveSettings();
  });
  return field;
}

/** Picture slot: click or drop an image; shows the name's initial until one is set. */
function createPicture(relationship) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rel-picture';
  button.title = 'Click or drop an image to change the picture';
  button.setAttribute('aria-label', 'Change picture');

  const show = () => {
    if (relationship.picture) {
      const img = document.createElement('img');
      img.src = relationship.picture;
      img.alt = '';
      button.replaceChildren(img);
    } else {
      button.textContent = Array.from(relationship.name.trim())[0]?.toUpperCase() || '?';
    }
  };

  bindImagePicker(button, async file => {
    const src = await loadImageFile(file, PICTURE_SIZE);
    if (!src) return;
    relationship.picture = src;
    show();
    animateOnce(button, 'portrait-swap');
    saveSettings();
  });

  show();
  return { button, show };
}

function createPlayedBy(relationship) {
  const wrap = document.createElement('label');
  wrap.className = 'rel-played';

  const caption = document.createElement('span');
  caption.className = 'rel-label';
  caption.textContent = 'Played by';

  // A player who has since left the branch stays selectable, like an unknown Competency.
  const select = createChoiceSelect(playerChoices(), relationship.playedBy);
  select.addEventListener('change', () => {
    relationship.playedBy = select.value;
    saveSettings();
  });

  wrap.append(caption, select);
  return wrap;
}

/**
 * A 0..max track of clickable steps (click a step, right-click to lower it, arrow keys),
 * shared by the relationship track and the Dose di Realtà. `build(node, step)` draws each step.
 */
function createStepTrack({ className, nodeClass, label, max, get, set, valueText, build }) {
  const track = document.createElement('div');
  track.className = className;
  track.tabIndex = 0;
  track.title = 'Click a step to set it · right-click to lower it';
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', label);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(max));

  const nodes = Array.from({ length: max + 1 }, (_, step) => {
    const node = document.createElement('span');
    node.className = nodeClass;
    node.dataset.step = String(step);
    build(node, step);
    return node;
  });
  track.append(...nodes);

  const show = () => {
    const value = get();
    nodes.forEach((node, step) => {
      node.classList.toggle('reached', step <= value);
      node.classList.toggle('current', step === value);
    });
    track.style.setProperty('--progress', value / max);
    track.setAttribute('aria-valuenow', String(value));
    track.setAttribute('aria-valuetext', valueText(value));
  };

  const change = next => {
    const value = Math.min(max, Math.max(0, next));
    if (value === get()) return;
    set(value);
    show();
    saveSettings();
  };

  track.addEventListener('click', event => {
    const node = event.target.closest(`.${nodeClass}`);
    if (node) change(Number(node.dataset.step));
  });
  track.addEventListener('contextmenu', event => {
    event.preventDefault();
    change(get() - 1);
  });
  track.addEventListener('keydown', event => {
    const value = get();
    const next = {
      ArrowRight: value + 1, ArrowUp: value + 1,
      ArrowLeft: value - 1, ArrowDown: value - 1,
      Home: 0, End: max
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    change(next);
  });

  show();
  return track;
}

/** The track from the Relazioni sheet: ▶ at 0, one node per step, the Network globe at 9. */
function createTrack(relationship, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'rel-track-wrap';

  const track = createStepTrack({
    className: 'rel-track',
    nodeClass: 'rel-node',
    label: 'Relationship track',
    max: MAX_CONNECTION,
    get: () => relationship.connection,
    set: value => { relationship.connection = value; onChange(); },
    valueText: value => (value === MAX_CONNECTION ? `${value}, Network` : String(value)),
    build: (node, step) => {
      if (step === 0) node.classList.add('start');
      if (step === MAX_CONNECTION) node.classList.add('goal');
      const number = document.createElement('span');
      number.className = 'rel-node-num';
      number.textContent = step;
      const dot = document.createElement('span');
      dot.className = 'rel-node-dot';
      node.append(number, dot);
    }
  });

  const caption = document.createElement('span');
  caption.className = 'rel-network-caption';
  caption.textContent = 'Network ▲';
  wrap.append(track, caption);
  return wrap;
}

/** The agent's Realtà track of the Agenda Vita-Lavoro: 30 boxes, some with a Playwall code. */
function createRealityTrack(card) {
  const section = document.createElement('section');
  section.className = 'reality-track-section';

  const title = document.createElement('h3');
  title.textContent = 'Tracciato Realtà';
  const count = document.createElement('span');
  count.className = 'reality-progress';
  const showCount = () => { count.textContent = `${card._realityProgress || 0} / ${TRACK_LENGTH}`; };

  const squares = createLifeWorkTrack({
    label: 'Tracciato Realtà', className: 'reality-track', squareClass: 'reality-square', codes: DOCUMENTS,
    get: () => card._realityProgress || 0,
    set: value => { card._realityProgress = value; },
    onChange: (previous, next) => {
      showCount();
      const unlocked = reachedCodes(DOCUMENTS, previous, next);
      if (unlocked.length) toast(`Leggi in Playwall: ${unlocked.join(', ')}.`);
    }
  });
  showCount();

  const rules = document.createElement('details');
  rules.className = 'reality-rules';
  const summary = document.createElement('summary');
  summary.textContent = 'Come usare il tracciato';
  rules.append(summary, ...[
    'Segna 1 casella per unità di Tempo disponibile a fine Incarico. Quando segni un tracciato, cancella l’ultima casella dei tracciati che non hai scelto. Se trovi un codice, leggi il Documento in Playwall.',
    'Quando segni una casella Realtà, aumenta di +1 il Legame con una Relazione a tua scelta. Ripeti per ogni Relazione nel Network.',
    'Quando non ricevi nessuna Distinzione, puoi aumentare di +1 il Legame con una Relazione a scelta.'
  ].map(text => {
    const p = document.createElement('p');
    p.textContent = text;
    return p;
  }));

  section.append(title, count, squares, rules);
  return section;
}

/** The agent's Dose di Realtà track, drawn like the paper: ▶ 1-2-3-4-X. */
function createDose(card) {
  const box = document.createElement('div');
  box.className = 'dose-box';

  const title = document.createElement('span');
  title.className = 'dose-title';
  title.textContent = 'Dose di Realtà';

  const note = document.createElement('p');
  note.className = 'dose-note';
  note.textContent = DOSE_NOTE;

  const showFull = () => box.classList.toggle('full', card._realityDose >= MAX_REALITY_DOSE);

  const track = createStepTrack({
    className: 'dose-track',
    nodeClass: 'dose-node',
    label: 'Dose di Realtà',
    max: MAX_REALITY_DOSE,
    get: () => card._realityDose || 0,
    set: value => {
      card._realityDose = value;
      showFull();
      if (value === MAX_REALITY_DOSE) animateOnce(box, 'dose-filled');
    },
    valueText: value => (value === MAX_REALITY_DOSE ? `X, ${note.textContent}` : String(value)),
    build: (node, step) => {
      if (step === 0) node.classList.add('start');
      else if (step === MAX_REALITY_DOSE) {
        node.classList.add('end');
        node.textContent = 'X';
      } else node.textContent = step;
    }
  });

  showFull();
  box.append(title, track, note);
  return box;
}

function createBonus(relationship) {
  const box = document.createElement('div');
  box.className = 'rel-bonus-box';

  const caption = document.createElement('span');
  caption.className = 'rel-label';
  caption.textContent = 'Relationship Bonus';

  const field = createTextField(relationship, 'bonus', {
    label: 'Relationship Bonus', multiline: true, rows: 2, maxLength: 280, placeholder: 'What this relationship grants'
  });

  const active = document.createElement('label');
  active.className = 'rel-active';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = relationship.bonusActive;
  const tick = document.createElement('span');
  tick.className = 'rel-check';
  tick.setAttribute('aria-hidden', 'true');
  active.append(checkbox, tick, 'Active');

  const showActive = () => box.classList.toggle('active', relationship.bonusActive);
  checkbox.addEventListener('change', () => {
    relationship.bonusActive = checkbox.checked;
    showActive();
    saveSettings();
  });

  showActive();
  box.append(caption, field, active);
  return box;
}

/** Remove the open relationship, back to the agent's page, with an undo. */
function removeRelationship(card, relationship) {
  const list = relationshipsOf(card);
  const index = list.indexOf(relationship);
  if (index < 0) return;
  list.splice(index, 1);
  saveSettings();
  openRelationship = null;
  navigate();

  toast(`${relationship.name.trim() || 'Relationship'} removed.`, {
    duration: 6000,
    action: {
      label: 'Undo',
      onClick: () => {
        relationshipsOf(card).splice(index, 0, relationship);
        saveSettings();
        renderRelationships();
      }
    }
  });
}

/** The picture, or the name's initial until there is one. */
function createThumb(relationship, className) {
  const thumb = document.createElement('span');
  thumb.className = className;
  if (relationship.picture) {
    const img = document.createElement('img');
    img.src = relationship.picture;
    img.alt = '';
    thumb.appendChild(img);
  } else {
    thumb.textContent = Array.from(relationship.name.trim())[0]?.toUpperCase() || '?';
  }
  return thumb;
}

/** A relationship on the agent's page, at a glance; clicking it opens the relationship's page. */
function createRelationshipTile(card, relationship) {
  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rel-tile';
  tile.classList.toggle('network', inNetwork(relationship));

  const text = document.createElement('span');
  text.className = 'rel-tile-text';
  const name = document.createElement('strong');
  name.className = 'rel-tile-name';
  name.textContent = relationship.name.trim() || 'Unnamed';
  const meta = document.createElement('span');
  meta.className = 'rel-tile-meta';
  meta.textContent = relationship.playedBy ? `Played by ${relationship.playedBy}` : '';

  // bond 0-9 as a bar, with the Network globe and the Active bonus as badges
  const bond = document.createElement('span');
  bond.className = 'rel-tile-bond';
  bond.style.setProperty('--progress', relationship.connection / MAX_CONNECTION);
  const bar = document.createElement('span');
  bar.className = 'rel-tile-bar';
  const value = document.createElement('span');
  value.className = 'rel-tile-value';
  value.textContent = inNetwork(relationship) ? '🌐 Network' : `${relationship.connection} / ${MAX_CONNECTION}`;
  bond.append(bar, value);
  if (relationship.bonusActive) {
    const active = document.createElement('span');
    active.className = 'rel-tile-active';
    active.textContent = '✓ Bonus';
    bond.appendChild(active);
  }

  text.append(name, meta, bond);
  const open = document.createElement('span');
  open.className = 'rel-open';
  open.textContent = '›';
  tile.append(createThumb(relationship, 'rel-tile-picture'), text, open);
  tile.addEventListener('click', () => {
    openRelationship = relationship;
    navigate();
  });
  return tile;
}

/** One relationship on the whole page, in large type; every field is edited in place. */
function createRelationshipPage(card, relationship) {
  const el = document.createElement('article');
  el.className = 'rel-card rel-page';
  el.classList.toggle('network', inNetwork(relationship));

  const picture = createPicture(relationship);
  const name = createTextField(relationship, 'name', { label: 'Name', placeholder: 'Name', maxLength: 60 });
  name.addEventListener('input', () => {
    if (!relationship.picture) picture.show();
    const chip = document.querySelector('.rel-switch[aria-current="true"]');
    if (!chip) return;
    chip.querySelector('.rel-switch-name').textContent = relationship.name.trim() || 'Unnamed';
    if (!relationship.picture) chip.querySelector('.rel-switch-picture').replaceWith(createThumb(relationship, 'rel-switch-picture'));
  });

  const description = createTextField(relationship, 'description', {
    label: 'Description', multiline: true, rows: 3, maxLength: 280, placeholder: 'Description'
  });

  const track = createTrack(relationship, () => {
    el.classList.toggle('network', inNetwork(relationship));
    if (inNetwork(relationship)) animateOnce(el, 'network-joined');
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'rel-remove-page';
  remove.textContent = 'Remove relationship';
  remove.addEventListener('click', () => removeRelationship(card, relationship));

  const heading = document.createElement('div');
  heading.className = 'rel-page-heading';
  const fields = document.createElement('div');
  fields.className = 'rel-page-fields';
  fields.append(name, createPlayedBy(relationship));
  heading.append(picture.button, fields);

  el.append(heading, description, track, createBonus(relationship), remove);
  return el;
}

/** Portrait, name, and the player (plus Sick leave) under it. */
function createIdentity(card, index, { heading = false } = {}) {
  const box = heading ? 'div' : 'span';   // spans inside the overview's buttons

  const identity = document.createElement(box);
  identity.className = 'rel-identity';

  const portrait = document.createElement('img');
  portrait.src = portraitOf(card);
  portrait.alt = '';

  const text = document.createElement(box);
  text.className = 'rel-identity-text';
  const name = document.createElement(heading ? 'h3' : 'strong');
  name.className = 'rel-identity-name';
  name.textContent = agentName(card, index);
  const meta = document.createElement('span');
  meta.className = 'rel-identity-meta';
  meta.textContent = statOf(card, 'player');
  if (card.classList.contains('dead')) {
    const sick = document.createElement('span');
    sick.className = 'rel-sick';
    sick.textContent = meta.textContent ? ' · Sick leave' : 'Sick leave';
    meta.appendChild(sick);
  }
  text.append(name, meta);

  identity.append(portrait, text);
  return identity;
}

function createReality(card) {
  const reality = statOf(card, 'reality');
  const row = document.createElement('span');
  row.className = 'rel-reality';
  row.classList.toggle('unset', !reality);

  const caption = document.createElement('span');
  caption.className = 'rel-label';
  caption.textContent = 'Reality';
  const value = document.createElement('strong');
  value.textContent = reality || '—';

  row.append(caption, value);
  return row;
}

/** A number over its caption; a `lit` box glows while its number is above zero. */
function createCount(caption, { icon = '', lit = false } = {}) {
  const box = document.createElement('span');
  box.className = 'rel-count';
  const value = document.createElement('strong');
  const label = document.createElement('small');
  label.textContent = caption;
  box.append(value, label);

  const set = n => {
    value.textContent = icon ? `${icon} ${n}` : String(n);
    if (lit) box.classList.toggle('lit', n > 0);
  };
  return { box, set };
}

/** Relationship and "Relazioni in Network" counters; `update()` re-reads them from the agent. */
function createCounts(card) {
  const counts = document.createElement('span');
  counts.className = 'rel-counts';
  const total = createCount('Relationships');
  const network = createCount('In Network', { icon: '🌐', lit: true });
  counts.append(total.box, network.box);

  const update = () => {
    const list = relationshipsOf(card);
    total.set(list.length);
    network.set(list.filter(inNetwork).length);
  };
  update();
  return { counts, update };
}

/** Read-only Realtà track for the overview: the marked boxes and the Playwall codes. */
function createRealityTrackSummary(card) {
  const progress = card._realityProgress || 0;
  const box = document.createElement('span');
  box.className = 'rel-summary-track';

  const caption = document.createElement('span');
  caption.className = 'rel-label';
  caption.textContent = 'Tracciato Realtà';
  const count = document.createElement('strong');
  count.className = 'rel-summary-progress';
  count.textContent = `${progress} / ${TRACK_LENGTH}`;

  const row = TRACK_LENGTH / 2;
  const squares = document.createElement('span');
  squares.className = 'rel-summary-squares';
  for (let n = 1; n <= TRACK_LENGTH; n++) {
    const square = document.createElement('span');
    square.className = 'rel-summary-square';
    square.textContent = DOCUMENTS[n] || '';
    square.classList.toggle('reached', n <= progress);
    square.style.gridRow = n <= row ? '1' : '2';
    square.style.gridColumn = String(n <= row ? n : TRACK_LENGTH + 1 - n);
    squares.appendChild(square);
  }

  box.append(caption, count, squares);
  return box;
}

/** One overview column: the agent at a glance. Clicking it opens their page. */
function createSummary(card, index) {
  const relationships = relationshipsOf(card);
  const network = relationships.filter(inNetwork).length;

  const tile = document.createElement('button');
  tile.type = 'button';
  tile.className = 'rel-summary';
  tile.classList.toggle('dead', card.classList.contains('dead'));
  tile.style.setProperty('--i', index);
  tile.setAttribute('aria-label', [
    agentName(card, index),
    `Reality: ${statOf(card, 'reality') || 'none'}`,
    `${relationships.length} relationships, ${network} in Network`,
    `Tracciato Realtà ${card._realityProgress || 0} of ${TRACK_LENGTH}`
  ].join('. '));

  const open = document.createElement('span');
  open.className = 'rel-open';
  open.textContent = 'Open ›';

  tile.append(createIdentity(card, index), createReality(card), createCounts(card).counts, createRealityTrackSummary(card), open);
  tile.addEventListener('click', () => openAgent(card));
  return tile;
}

/** Back to the overview, plus a chip per agent to jump straight to another agent's page. */
function createAgentNav(cards) {
  const nav = document.createElement('nav');
  nav.className = 'rel-detail-nav';
  nav.setAttribute('aria-label', 'Agents');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rel-back';
  back.title = 'Back to all agents (Esc)';
  back.textContent = '‹ All agents';
  back.addEventListener('click', showOverview);

  const switcher = document.createElement('div');
  switcher.className = 'rel-switcher';
  cards.forEach((card, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rel-switch';
    chip.classList.toggle('dead', card.classList.contains('dead'));
    if (card === openCard) chip.setAttribute('aria-current', 'true');

    const portrait = document.createElement('img');
    portrait.src = portraitOf(card);
    portrait.alt = '';
    const name = document.createElement('span');
    name.textContent = agentName(card, index);

    chip.append(portrait, name);
    chip.addEventListener('click', () => openAgent(card));
    switcher.appendChild(chip);
  });

  nav.append(back, switcher);
  return nav;
}

/** ‹ back to the agent, then a chip per relationship of theirs to jump straight to another one. */
function createRelationshipNav(card, index) {
  const nav = document.createElement('nav');
  nav.className = 'rel-detail-nav';
  nav.setAttribute('aria-label', 'Relationships');

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'rel-back';
  back.title = 'Back to the agent (Esc)';
  back.textContent = `‹ ${agentName(card, index)}`;
  back.addEventListener('click', goBack);

  const switcher = document.createElement('div');
  switcher.className = 'rel-switcher';
  relationshipsOf(card).forEach(relationship => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'rel-switch';
    if (relationship === openRelationship) chip.setAttribute('aria-current', 'true');
    const name = document.createElement('span');
    name.className = 'rel-switch-name';
    name.textContent = relationship.name.trim() || 'Unnamed';
    chip.append(createThumb(relationship, 'rel-switch-picture'), name);
    chip.addEventListener('click', () => {
      openRelationship = relationship;
      navigate();
    });
    switcher.appendChild(chip);
  });

  nav.append(back, switcher);
  return nav;
}

/**
 * An agent's page: their profile with the Realtà track and the Dose di Realtà, beside their relationships
 * as tiles. An open relationship gets the whole view instead.
 */
function createDetail(card, cards) {
  const index = cards.indexOf(card);

  const detail = document.createElement('section');
  detail.className = 'rel-detail';

  if (openRelationship) {
    detail.setAttribute('aria-label', `${agentName(card, index)}: ${openRelationship.name.trim() || 'relationship'}`);
    detail.append(createRelationshipNav(card, index), createRelationshipPage(card, openRelationship));
    return detail;
  }
  detail.setAttribute('aria-label', `${agentName(card, index)}: relationships`);

  const { counts } = createCounts(card);
  const profile = document.createElement('div');
  profile.className = 'rel-profile';
  profile.classList.toggle('dead', card.classList.contains('dead'));
  profile.append(createIdentity(card, index, { heading: true }), createReality(card), counts, createRealityTrack(card), createDose(card));

  const list = document.createElement('div');
  list.className = 'rel-list';

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'rel-add';
  add.textContent = '+ Add Relationship';
  add.addEventListener('click', () => {
    const relationship = normalizeRelationship();
    relationshipsOf(card).push(relationship);
    saveSettings();
    openRelationship = relationship;
    navigate();
    view.querySelector('.rel-page .rel-name')?.focus();
  });

  list.append(...relationshipsOf(card).map(relationship => createRelationshipTile(card, relationship)), add);

  const body = document.createElement('div');
  body.className = 'rel-detail-body';
  body.append(profile, list);

  detail.append(createAgentNav(cards), body);
  return detail;
}

/** Re-render for a move to another page, starting it at the top. */
function navigate() {
  renderRelationships({ animate: true });
  view.scrollTop = 0;
  if (view.getBoundingClientRect().top < 0) view.scrollIntoView({ block: 'start' });
  view.querySelector('.rel-switch[aria-current="true"], .rel-back')?.focus({ preventScroll: true });
}

function openAgent(card) {
  if (card === openCard) return;
  openCard = card;
  openRelationship = null;
  navigate();
}

function showOverview() {
  const card = openCard;
  openRelationship = null;
  renderRelationships({ overview: true, animate: true });
  // Land back on the column of the agent that was open.
  view.querySelectorAll('.rel-summary')[getCharElements().indexOf(card)]?.focus();
}

/** One level up: relationship page -> agent page -> overview. */
function goBack() {
  if (!openRelationship) {
    showOverview();
    return;
  }
  openRelationship = null;
  navigate();
}

/**
 * Rebuild the view from the agent cards (names, portraits, players may have changed).
 * Stays on the open agent's page unless `overview` is set or that agent has left the branch.
 */
export function renderRelationships({ overview = false, animate = false } = {}) {
  if (!view) return;
  const cards = getCharElements();
  if (overview || !cards.includes(openCard)) openCard = null;
  if (!openCard || !relationshipsOf(openCard).includes(openRelationship)) openRelationship = null;

  if (!cards.length) {
    const empty = document.createElement('p');
    empty.className = 'rel-empty';
    empty.textContent = 'No agents on this branch yet. Use "Hire Agent" first.';
    view.replaceChildren(empty);
    return;
  }

  if (openCard) {
    const detail = createDetail(openCard, cards);
    view.replaceChildren(detail);
    if (animate) animateOnce(detail, 'entering');
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'rel-overview';
  const tiles = cards.map(createSummary);
  grid.append(...tiles);
  view.replaceChildren(grid);
  if (animate) tiles.forEach(tile => animateOnce(tile, 'entering'));
}

export function initRelationships() {
  view = document.getElementById('relationshipsView');
  // Hiring, recalling, removing or sending an agent on sick leave all end in updateTopCharacters().
  document.addEventListener('dashboard-refresh', () => {
    if (!view.hidden) renderRelationships();
  });
  view.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !openCard || event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    goBack();
  });
}
