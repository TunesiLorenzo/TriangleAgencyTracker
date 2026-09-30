// agency.js
// Responsibilities: the Agency tab, in three levels like the other tabs. The overview has a
// tile per agent (Qualifica in Agenzia, the Competenza track at a glance, the items they
// hold), the drop-down list of every item of the branch and a promotional banner. Clicking
// an agent opens their page: the Competenza track of the Agenda Vita-Lavoro (ARC_Dossier
// page 8), every rank of the career and their inventory. Clicking an item, anywhere, opens
// it on its own page with its owner (an agent or the Team), holder, description and icon.
// The track lives on the agent card (card._competencyProgress); the items belong to the
// branch (world.items) and name agents by card._id, so an item can change hands.

import { ACQUISITIONS, DEFAULT_ICON, ITEM_ICONS, PROMO_DIR, PROMO_SLIDES, STANDARD_KIT } from './agencyData.js';
import { animateOnce, getCharElements } from './charSystem.js';
import { createLifeWorkTrack, reachedCodes, TRACK_LENGTH } from './lifeWorkTrack.js';
import { loadSettings, updateSettings } from './storage.js';
import { toast } from './ui.js';

const TEAM = 'team';   // owner or holder of a communal item
const ITEMS_OPEN_KEY = 'ta-agency-items-open';
const CATALOG_ID = 'agencyCatalog';
const CATALOG = [...STANDARD_KIT, ...ACQUISITIONS];

// Qualifica in Agenzia along the Competenza track. The box that starts each rank carries the
// code of its Playwall Document; from Vicedirettore on, the ranks run along the bottom row.
const RANKS = [
  { from: 0, title: 'Praticante' },
  { from: 3, title: 'Impiegato', code: 'A3' },
  { from: 6, title: 'Impiegato Senior', code: 'D4' },
  { from: 9, title: 'Quadro', code: 'G3' },
  { from: 12, title: 'Amministratore', code: 'J3' },
  { from: 15, title: 'Vicedirettore', code: 'N3' },
  { from: 18, title: 'Direttore Associato', code: 'Q3' },
  { from: 21, title: 'Direttore', code: 'T3' },
  { from: 24, title: 'Direttore Generale', code: 'W8' },
  { from: 27, title: 'Poltrona in CdA', code: 'Y2' }
];
const CODES = Object.fromEntries(RANKS.filter(rank => rank.code).map(rank => [rank.from, rank.code]));

let view = null;
let items = [];
let promo = null;       // the promotional banner, kept across renders
let openCard = null;    // the agent whose page is open
let openItem = null;    // { id, from }: the item on show, and the agent page it was opened from (null: the overview)

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Index in RANKS of the rank held with `progress` boxes marked, which is also the rank box n belongs to. */
function rankAt(progress) {
  return RANKS.findLastIndex(rank => rank.from <= progress);
}

function statOf(card, key) {
  return card.querySelector(`[data-stat="${key}"]`)?.value.trim() || '';
}

function agentName(card, index) {
  return statOf(card, 'name') || `Agente ${index + 1}`;
}

/** Who can own or hold an item: the Team, then every agent on the branch. */
function parties(cards) {
  return [{ id: TEAM, name: 'Team' }, ...cards.map((card, index) => ({ id: card._id, name: agentName(card, index) }))];
}

/** An agent who has left the branch keeps their items until someone reassigns them. */
function partyName(id, cards) {
  return parties(cards).find(party => party.id === id)?.name || 'Agente rimosso';
}

// ---------- items ----------
function normalizeItem(data) {
  const item = data && typeof data === 'object' ? data : {};
  return {
    id: String(item.id || crypto.randomUUID()),
    name: String(item.name ?? ''),
    description: String(item.description ?? ''),
    icon: String(item.icon ?? ''),   // '' = the catalog icon for its name
    owner: String(item.owner || TEAM),
    holder: String(item.holder || TEAM)
  };
}

function catalogEntry(name) {
  return CATALOG.find(entry => entry.name.toLowerCase() === name.trim().toLowerCase());
}

function iconOf(item) {
  return item.icon || catalogEntry(item.name)?.icon || DEFAULT_ICON;
}

function heldBy(id) {
  return items.filter(item => item.holder === id);
}

function saveItems() {
  updateSettings(settings => { settings.world.items = items; });
}

/** Back to the two Acquisizioni every Squadra Operativa starts with (Close Branch). */
export function resetItems() {
  items = STANDARD_KIT.map(normalizeItem);
  saveItems();
  renderAgency();
}

function createCatalog() {
  const list = el('datalist');
  list.id = CATALOG_ID;
  list.append(...CATALOG.map(entry => {
    const option = el('option');
    option.value = entry.name;
    return option;
  }));
  return list;
}

function createPartySelect(item, key, cards, changed) {
  const select = el('select', 'agency-input');
  const choices = parties(cards);
  if (!choices.some(party => party.id === item[key])) choices.push({ id: item[key], name: partyName(item[key], cards) });
  choices.forEach(party => {
    const option = el('option', '', party.name);
    option.value = party.id;
    select.append(option);
  });
  select.value = item[key];
  select.addEventListener('change', () => {
    item[key] = select.value;
    changed();
  });
  return select;
}

/** Icon choices for an item: its catalog icon (the default), then the rest. */
function createIconPicker(item, onPick) {
  const picker = el('div', 'agency-icon-picker');
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Icona');
  const show = () => [...picker.children].forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.icon === item.icon)));
  ['', ...ITEM_ICONS].forEach(icon => {
    const choice = el('button', 'agency-icon-choice', icon || 'Auto');
    choice.type = 'button';
    choice.dataset.icon = icon;
    choice.title = icon ? `Icona ${icon}` : 'Icona del catalogo';
    choice.addEventListener('click', () => {
      item.icon = icon;
      show();
      onPick();
    });
    picker.append(choice);
  });
  show();
  return picker;
}

function itemsOpenSaved() {
  try { return localStorage.getItem(ITEMS_OPEN_KEY) === 'true'; } catch { return false; }
}

/** Qualifica in Agenzia, how far along the track the agent is, and the next promotion. */
function createStatus(card) {
  const box = el('div', 'agency-status');
  const count = el('span', 'agency-progress');
  const title = el('strong', 'agency-rank');
  const next = el('span', 'agency-next');
  box.append(el('span', 'agency-label', 'Qualifica in Agenzia'), count, title, next);

  const update = () => {
    const progress = card._competencyProgress;
    const rank = rankAt(progress);
    const upcoming = RANKS[rank + 1];
    count.textContent = `${progress} / ${TRACK_LENGTH}`;
    title.textContent = RANKS[rank].title;
    if (upcoming) next.textContent = `Prossima: ${upcoming.title} · casella ${upcoming.from}`;
    else next.textContent = progress < TRACK_LENGTH ? 'Vertice della carriera' : 'Tracciato completo';
  };
  update();
  return { box, title, update };
}

/** The clickable track; `onChange` runs after the rank shown in `status` has been updated. */
function createTrack(card, status, onChange) {
  const section = el('section', 'agency-track-section');
  const squares = createLifeWorkTrack({
    label: 'Tracciato Competenza', className: 'competency-track', squareClass: 'competency-square', codes: CODES,
    get: () => card._competencyProgress,
    set: value => { card._competencyProgress = value; },
    describe: n => {
      const { title } = RANKS[rankAt(n)];
      return CODES[n] ? `Casella ${n} — ${CODES[n]}: promozione a ${title}` : `Casella ${n} — ${title}`;
    },
    onChange: (previous, next) => {
      status.update();
      showRank();
      onChange?.();
      const codes = reachedCodes(CODES, previous, next);
      if (!codes.length) return;
      animateOnce(status.title, 'promoted');
      toast(`Promozione: ${RANKS[rankAt(next)].title}! Leggi in Playwall: ${codes.join(', ')}.`);
    }
  });

  // Every other rank is tinted, and the boxes of the rank the agent holds are outlined.
  [...squares.children].forEach((square, i) => {
    const rank = rankAt(i + 1);
    square.dataset.rank = String(rank);
    square.classList.toggle('alt', rank % 2 === 1);
    square.classList.toggle('promotion', Boolean(CODES[i + 1]));
  });
  const showRank = () => {
    const current = String(rankAt(card._competencyProgress));
    [...squares.children].forEach(square => square.classList.toggle('current-rank', square.dataset.rank === current));
  };
  showRank();

  const rules = el('details', 'agency-rules');
  rules.append(
    el('summary', '', 'Come usare il tracciato'),
    el('p', '', 'Segna 1 casella per unità di Tempo disponibile a fine Incarico. Ogni volta che segni un tracciato, cancella l’ultima casella dei tracciati che non hai scelto. Se una casella riporta un codice, leggi il Documento in Playwall.'),
    el('p', '', 'Quando segni una casella Competenza, aumenta di +1 i Controlli Qualità massimi in una Qualità a scelta (massimo 9 per Qualità) e ricevi +3 Note di Merito.'),
    el('p', '', 'Quando ricevi la Distinzione MVP (più Note di Merito nell’Incarico), segna 1 casella Competenza senza cancellare altre caselle.')
  );

  section.append(el('h3', '', 'Tracciato Competenza'), squares, rules);
  return section;
}

// ---------- navigation ----------
function button(className, text, onClick) {
  const node = el('button', className, text);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Re-render for a move to another page, starting it at the top. */
function navigate() {
  renderAgency();
  view.scrollTop = 0;
  if (view.getBoundingClientRect().top < 0) view.scrollIntoView({ block: 'start' });
  view.querySelector('.agency-switch[aria-current="true"], .agency-back')?.focus({ preventScroll: true });
}

function openAgent(card) {
  openCard = card;
  openItem = null;
  navigate();
}

function openItemPage(item, from = null) {
  openItem = { id: item.id, from };
  navigate();
}

/** One level up: item page -> where it was opened from, agent page -> overview. */
function goBack() {
  if (openItem) {
    openCard = openItem.from;
    openItem = null;
  } else {
    openCard = null;
  }
  navigate();
}

/** ‹ back, then a chip per sibling (agents, or items) to jump straight to another one. */
function createNav(backLabel, entries) {
  const nav = el('nav', 'agency-nav');
  nav.append(button('agency-back', `‹ ${backLabel}`, goBack));
  const switcher = el('div', 'agency-switcher');
  switcher.append(...entries.map(({ label, icon, current, onClick }) => {
    const chip = button('agency-switch', '', onClick);
    if (icon) chip.append(el('span', 'agency-switch-icon', icon));
    chip.append(el('span', 'agency-switch-label', label));
    if (current) chip.setAttribute('aria-current', 'true');
    return chip;
  }));
  nav.append(switcher);
  return nav;
}

// ---------- pieces shared by the pages ----------
function createIdentity(card, index) {
  const identity = el('span', 'agency-identity');
  const portrait = el('img');
  portrait.src = card.querySelector('img')?.src || './images/pfp.jpg';
  portrait.alt = '';
  const dead = card.classList.contains('dead');
  const subtitle = el('span', 'agency-subtitle', [statOf(card, 'player'), statOf(card, 'competency')].filter(Boolean).join(' · '));
  if (dead) subtitle.append(el('span', 'agency-sick', subtitle.textContent ? ' · Sick leave' : 'Sick leave'));
  const text = el('span', 'agency-identity-text');
  text.append(el('strong', 'agency-name', agentName(card, index)), subtitle);
  identity.append(portrait, text);
  return identity;
}

/** Read-only track for the overview: the marked boxes, codes and the current rank's span. */
function createTrackSummary(card) {
  const squares = el('span', 'agency-mini-track');
  const current = rankAt(card._competencyProgress);
  const row = TRACK_LENGTH / 2;
  for (let n = 1; n <= TRACK_LENGTH; n++) {
    const square = el('span', 'agency-mini-square', CODES[n] || '');
    const rank = rankAt(n);
    square.classList.toggle('reached', n <= card._competencyProgress);
    square.classList.toggle('alt', rank % 2 === 1);
    square.classList.toggle('current-rank', rank === current);
    square.style.gridRow = n <= row ? '1' : '2';
    square.style.gridColumn = String(n <= row ? n : TRACK_LENGTH + 1 - n);
    squares.append(square);
  }
  return squares;
}

/** An item as a tile; clicking it opens the item's page. `from` is the agent page it sits on. */
function createItemTile(item, cards, from) {
  const tile = button('agency-item-tile', '', () => openItemPage(item, from));
  tile.dataset.id = item.id;
  const owner = item.owner !== item.holder ? `di ${partyName(item.owner, cards)}` : '';
  const meta = from ? owner : [`In mano a: ${partyName(item.holder, cards)}`, owner].filter(Boolean).join(' · ');
  const text = el('span', 'agency-item-text');
  text.append(el('strong', 'agency-item-name', item.name.trim() || 'Senza nome'));
  if (meta) text.append(el('span', 'agency-item-meta', meta));
  tile.append(el('span', 'agency-item-icon', iconOf(item)), text, el('span', 'agency-open', '›'));
  return tile;
}

/** A new item, straight to its page: added on an agent's page it is theirs, otherwise the Team's. */
function addItem(from) {
  const item = normalizeItem(from ? { owner: from._id, holder: from._id } : {});
  items.push(item);
  saveItems();
  openItemPage(item, from);
  view.querySelector('.agency-item-page-name')?.focus();
}

// ---------- overview ----------
function createSummary(card, index) {
  const progress = card._competencyProgress;
  const { title } = RANKS[rankAt(progress)];
  const held = heldBy(card._id);
  const tile = button('agency-summary', '', () => openAgent(card));
  tile.classList.toggle('dead', card.classList.contains('dead'));
  tile.setAttribute('aria-label', `${agentName(card, index)}. ${title}, ${progress} di ${TRACK_LENGTH}. ${held.length} oggetti.`);

  const rank = el('span', 'agency-summary-rank');
  rank.append(el('span', 'agency-label', 'Qualifica in Agenzia'), el('strong', 'agency-rank', title), el('span', 'agency-progress', `${progress} / ${TRACK_LENGTH}`));

  const inventory = el('span', 'agency-summary-items');
  if (held.length) inventory.append(...held.map(item => el('span', 'agency-summary-icon', iconOf(item))));
  else inventory.append(el('span', 'agency-empty', 'Nessun oggetto'));

  tile.append(createIdentity(card, index), rank, createTrackSummary(card), inventory, el('span', 'agency-open', 'Apri ›'));
  return tile;
}

/** The drop-down list of every item of the branch, below the agents. */
function createTeamItems(cards) {
  const panel = el('details', 'agency-items');
  panel.open = itemsOpenSaved();
  panel.addEventListener('toggle', () => {
    try { localStorage.setItem(ITEMS_OPEN_KEY, String(panel.open)); } catch { /* storage unavailable */ }
  });
  const summary = el('summary');
  summary.append(
    el('span', 'agency-items-title', 'Oggetti dell’Agenzia'),
    el('span', 'agency-items-meta', `${items.length} ${items.length === 1 ? 'oggetto' : 'oggetti'} · ${heldBy(TEAM).length} al Team`)
  );
  const grid = el('div', 'agency-item-grid');
  grid.append(...items.map(item => createItemTile(item, cards, null)), button('agency-add', '+ Aggiungi oggetto', () => addItem(null)));
  panel.append(summary, grid);
  return panel;
}

// ---------- agent page ----------
/** Every rank of the career: the ones reached, the one held, the ones still to come. */
function createLadder(card) {
  const section = el('section', 'agency-panel agency-ladder');
  const list = el('ol', 'agency-ladder-list');
  const update = () => {
    const current = rankAt(card._competencyProgress);
    list.replaceChildren(...RANKS.map((rank, index) => {
      const first = Math.max(1, rank.from);
      const last = (RANKS[index + 1]?.from ?? TRACK_LENGTH + 1) - 1;
      const row = el('li', 'agency-ladder-rank');
      row.classList.toggle('reached', index < current);
      row.classList.toggle('current', index === current);
      if (index === current) row.setAttribute('aria-current', 'step');
      row.append(
        el('span', 'agency-ladder-title', rank.title),
        el('span', 'agency-ladder-boxes', `caselle ${first}–${last}`),
        el('span', 'agency-ladder-code', rank.code || '')
      );
      return row;
    }));
  };
  update();
  section.append(el('h3', '', 'Carriera'), list);
  return { section, update };
}

function createAgentPage(card, cards) {
  const index = cards.indexOf(card);
  const page = el('section', 'agency-agent-page');
  page.setAttribute('aria-label', `${agentName(card, index)}: Agenzia`);

  const ladder = createLadder(card);
  const status = createStatus(card);
  const profile = el('div', 'agency-panel agency-profile');
  profile.classList.toggle('dead', card.classList.contains('dead'));
  profile.append(createIdentity(card, index), status.box, createTrack(card, status, ladder.update));

  const held = heldBy(card._id);
  const inventory = el('section', 'agency-panel agency-inventory');
  const grid = el('div', 'agency-item-grid');
  if (!held.length) grid.append(el('p', 'agency-empty', 'Nessun oggetto.'));
  grid.append(...held.map(item => createItemTile(item, cards, card)), button('agency-add', '+ Aggiungi oggetto', () => addItem(card)));
  inventory.append(el('h3', '', `Inventario (${held.length})`), grid);

  const side = el('div', 'agency-agent-side');
  side.append(inventory, ladder.section);
  const body = el('div', 'agency-agent-body');
  body.append(profile, side);

  const nav = createNav('Tutti gli agenti', cards.map((other, i) => ({
    label: agentName(other, i), current: other === card, onClick: () => openAgent(other)
  })));
  page.append(nav, body);
  return page;
}

// ---------- item page ----------
function removeItem(item) {
  const index = items.indexOf(item);
  if (index < 0) return;
  items.splice(index, 1);
  saveItems();
  goBack();
  toast(`${item.name.trim() || 'Oggetto'} rimosso.`, {
    duration: 6000,
    action: {
      label: 'Annulla',
      onClick: () => {
        items.splice(Math.min(index, items.length), 0, item);
        saveItems();
        renderAgency();
      }
    }
  });
}

/** One item on the whole page, in large type; every field is edited in place. */
function createItemPage(item, cards) {
  const from = openItem.from;
  const siblings = from ? heldBy(from._id) : [...items];
  if (!siblings.includes(item)) siblings.unshift(item);   // just handed to someone else
  const nav = createNav(from ? agentName(from, cards.indexOf(from)) : 'Tutti gli oggetti', siblings.map(sibling => ({
    icon: iconOf(sibling), label: sibling.name.trim() || 'Senza nome', current: sibling === item,
    onClick: () => openItemPage(sibling, from)
  })));
  const chip = nav.querySelector('.agency-switch[aria-current="true"]');

  const icon = el('span', 'agency-item-page-icon');
  const name = el('input', 'agency-input agency-item-page-name');
  name.type = 'text';
  name.maxLength = 80;
  name.placeholder = 'Nome dell’oggetto';
  name.setAttribute('list', CATALOG_ID);
  name.value = item.name;

  const description = el('textarea', 'agency-input agency-item-page-description');
  description.rows = 6;
  description.maxLength = 1000;
  description.placeholder = 'Descrizione';
  description.value = item.description;

  const showIcon = () => {
    icon.textContent = iconOf(item);
    chip.querySelector('.agency-switch-icon').textContent = iconOf(item);
    chip.querySelector('.agency-switch-label').textContent = item.name.trim() || 'Senza nome';
  };
  name.addEventListener('input', () => {
    item.name = name.value;
    // Picking an Acquisizione from the suggestions fills in its description.
    const known = catalogEntry(item.name);
    if (known && !item.description.trim()) item.description = description.value = known.description;
    showIcon();
    saveItems();
  });
  description.addEventListener('input', () => {
    item.description = description.value;
    saveItems();
  });

  const field = (caption, control, className = '') => {
    const wrap = el('label', `agency-field ${className}`.trim());
    wrap.append(el('span', 'agency-label', caption), control);
    return wrap;
  };
  const header = el('header', 'agency-item-page-header');
  header.append(icon, field('Nome', name, 'agency-item-page-title'));

  const owners = el('div', 'agency-item-page-parties');
  owners.append(
    field('Proprietario', createPartySelect(item, 'owner', cards, saveItems)),
    field('Detentore', createPartySelect(item, 'holder', cards, saveItems))
  );

  const icons = el('div', 'agency-field');
  icons.append(el('span', 'agency-label', 'Icona'), createIconPicker(item, () => { showIcon(); saveItems(); }));

  const page = el('article', 'agency-panel agency-item-page');
  page.append(header, owners, field('Descrizione', description), icons, button('agency-remove-item', 'Rimuovi oggetto', () => removeItem(item)));
  showIcon();

  const wrap = el('section', 'agency-item-view');
  wrap.setAttribute('aria-label', item.name.trim() || 'Oggetto');
  wrap.append(nav, page);
  return wrap;
}

// ---------- promotional banner ----------
/**
 * Brand items and motivational posters, one after another. The progress bar's animation
 * times each slide (its end moves on), so hovering, focusing or pausing the banner holds
 * the slide simply by pausing that animation, and a hidden tab doesn't advance at all.
 */
function createPromo() {
  const promo = el('section', 'promo');
  promo.setAttribute('aria-roledescription', 'carousel');
  promo.setAttribute('aria-label', 'Comunicazioni aziendali');

  const slides = PROMO_SLIDES.map((data, index) => {
    const slide = el('article', `promo-slide${data.poster ? ' poster' : ''}`);
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} di ${PROMO_SLIDES.length}: ${data.title}`);

    // Poster art made from the icon, covered by the picture once there is one.
    const art = el('div', 'promo-art');
    art.append(el('span', 'promo-art-icon', data.icon));
    const image = el('img', 'promo-image');
    image.alt = '';
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove());
    image.src = PROMO_DIR + data.image;
    art.append(image);

    const copy = el('div', 'promo-copy');
    copy.append(el('span', 'promo-kicker', data.kind), el('h3', 'promo-title', data.title), el('p', 'promo-tagline', data.tagline));
    if (data.price) copy.append(el('span', 'promo-price', data.price));
    copy.append(el('span', 'promo-brand', '▲ Triangle Agency'));

    slide.append(art, copy);
    return slide;
  });

  const stage = el('div', 'promo-stage');
  stage.setAttribute('aria-live', 'off');
  stage.append(...slides);

  const dots = el('div', 'promo-dots');
  const dotButtons = slides.map((_, index) => {
    const dot = el('button', 'promo-dot');
    dot.type = 'button';
    dot.setAttribute('aria-label', `Vai alla slide ${index + 1}`);
    dot.addEventListener('click', () => show(index));
    return dot;
  });
  dots.append(...dotButtons);

  const arrow = (text, label, step) => {
    const button = el('button', `promo-arrow promo-${step > 0 ? 'next' : 'prev'}`, text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => show(current + step));
    return button;
  };

  const pause = el('button', 'promo-pause');
  pause.type = 'button';
  const showPaused = () => {
    const paused = promo.classList.contains('paused');
    pause.textContent = paused ? '▶' : '❚❚';
    pause.setAttribute('aria-label', paused ? 'Riprendi' : 'Pausa');
  };
  pause.addEventListener('click', () => {
    promo.classList.toggle('paused');
    showPaused();
  });

  const progress = el('div', 'promo-progress');
  progress.addEventListener('animationend', () => show(current + 1));

  let current = 0;
  function show(index) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === current);
      slide.setAttribute('aria-hidden', String(i !== current));
    });
    dotButtons.forEach((dot, i) => dot.setAttribute('aria-current', String(i === current)));
    // Restart the timer; the class stays on, so its animationend is the only one to act.
    progress.classList.remove('running');
    void progress.offsetWidth;
    progress.classList.add('running');
  }

  promo.append(stage, arrow('‹', 'Slide precedente', -1), arrow('›', 'Slide successiva', 1), dots, pause, progress);
  showPaused();
  show(0);
  return promo;
}

/** Rebuild the page on show from the agent cards (names, portraits, the agents themselves may have changed). */
export function renderAgency() {
  if (!view) return;
  const scrollTop = view.scrollTop;
  const cards = getCharElements();
  if (!cards.includes(openCard)) openCard = null;
  if (openItem?.from && !cards.includes(openItem.from)) openItem.from = null;
  const item = openItem && items.find(candidate => candidate.id === openItem.id);
  if (!item) openItem = null;

  if (item) view.replaceChildren(createItemPage(item, cards));
  else if (openCard) view.replaceChildren(createAgentPage(openCard, cards), promo);
  else {
    const overview = el('div', 'agency-overview');
    if (!cards.length) overview.append(el('p', 'rel-empty', 'Nessun agente. Aggiungi un agente con Hire Agent.'));
    overview.append(...cards.map(createSummary));
    view.replaceChildren(overview, createTeamItems(cards), promo);
  }
  view.scrollTop = scrollTop;
}

export function initAgency() {
  view = document.getElementById('agencyView');
  const saved = loadSettings()?.world?.items;
  items = Array.isArray(saved) ? saved.map(normalizeItem) : STANDARD_KIT.map(normalizeItem);
  if (!Array.isArray(saved)) saveItems();   // a new branch, or one saved before items existed
  document.body.append(createCatalog());
  promo = createPromo();
  document.addEventListener('dashboard-refresh', () => { if (!view.hidden) renderAgency(); });
  view.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !(openCard || openItem) || event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    goBack();
  });
}
