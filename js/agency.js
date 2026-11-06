// agency.js
// Responsibilities: the Agency tab, in three levels like the other tabs. The overview has a
// promotional banner on top, a tile per agent (Qualifica in Agenzia, the Competenza track at
// a glance, the items they hold) and the drop-down list of every item of the branch. Clicking
// an agent opens their page: the Competenza track of the Agenda Vita-Lavoro (ARC_Dossier
// page 8), every rank of the career and their inventory. Clicking an item, anywhere, opens
// it on its own page with its owner (an agent or the Team), holder, description and icon.
// The track lives on the agent card (card._competencyProgress); the items belong to the
// branch (world.items) and name agents by card._id, so an item can change hands.

import { DEFAULT_ICON, ITEM_ICONS, PROMO_DIR, PROMO_SHUFFLE, PROMO_SLIDES, STANDARD_KIT } from './agencyData.js';
import { RANKS, rankAt } from './badge.js';
import { animateOnce, getCharElements } from './charSystem.js';
import { createLifeWorkTrack, lastObtainable, markCrossedOff, reachedCodes, TRACK_LENGTH } from './lifeWorkTrack.js';
import { loadSettings, saveSettings, updateSettings } from './storage.js';
import { openModal, toast } from './ui.js';
import { createUuid } from './uuid.js';
import { motionAllowed } from './motion.js';
import { purchasingAgentId, requestPurchase } from './messages.js';
import { onConfigChange, PURCHASE_OTHER, purchaseAllowed, purchaseCatalog } from './config.js';

const TEAM = 'team';   // owner or holder of a communal item
const ITEMS_OPEN_KEY = 'ta-agency-items-open';
const CATALOG_ID = 'agencyCatalog';
// Every item the Agency knows: the standard kit, then the Acquisizioni on sale (set on /settings).
const catalog = () => [...STANDARD_KIT, ...purchaseCatalog()];

// Qualifica in Agenzia along the Competenza track: RANKS and rankAt live in badge.js, which
// also puts the rank on the agent's badge.
const CODES = Object.fromEntries(RANKS.filter(rank => rank.code).map(rank => [rank.from, rank.code]));

// The two Distinzioni of every Incarico (Agenda Vita-Lavoro), with the Agency's own brand of praise.
const DISTINCTIONS = {
  mvp: {
    title: 'MVP', icon: '🏆', rule: 'Più Note di Merito nell’Incarico', award: 'Nomina MVP',
    ribbon: 'Dipendente dell’Incarico',
    flavor: 'L’Agenzia riconosce il tuo impegno. Il premio è la soddisfazione di averlo fatto.',
    toast: name => `🏆 Congratulazioni, ${name}! Sei l’MVP dell’Incarico. Ritira la tua stretta di mano in Risorse Umane.`,
    track: 'Competenza'
  },
  suspended: {
    title: 'Sospeso', icon: '⛔', rule: 'Più Note di Demerito nell’Incarico', award: 'Sospendi',
    ribbon: 'In attesa di revisione disciplinare',
    flavor: 'La tua scrivania è stata temporaneamente riassegnata. Il caffè no.',
    toast: name => `⛔ ${name} è Sospeso. Consegna il badge alla reception e attendi istruzioni.`,
    track: 'Anomalia'
  }
};
const CONFETTI = ['#ffd60a', '#ff3b30', '#0a84ff', '#ffffff'];

let view = null;
let items = [];
let promo = null;       // the promotional banner, kept across renders
let openCard = null;    // the agent whose page is open
let openItem = null;    // { id, from }: the item on show, and the agent page it was opened from (null: the overview)
let holders = { mvp: null, suspended: null };   // ids of the agents holding the last Incarico's Distinzioni
const celebrations = new Set();   // `${kind}:${id}` awarded but not yet celebrated on screen

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
    id: String(item.id || createUuid()),
    name: String(item.name ?? ''),
    description: String(item.description ?? ''),
    icon: String(item.icon ?? ''),   // '' = the catalog icon for its name
    owner: String(item.owner || TEAM),
    holder: String(item.holder || TEAM)
  };
}

function catalogEntry(name) {
  return catalog().find(entry => entry.name.toLowerCase() === name.trim().toLowerCase());
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

/** A new branch (Close Branch): the two Acquisizioni every Squadra Operativa starts with, no Distinzioni. */
export function resetAgency() {
  items = STANDARD_KIT.map(normalizeItem);
  holders = { mvp: null, suspended: null };
  saveItems();
  saveHolders();
  decorateAgentCards();
  renderAgency();
}

// ---------- Distinzioni ----------
function saveHolders() {
  updateSettings(settings => { settings.world.distinctions = holders; });
}

/** The box a Distinzione lets the agent mark without erasing others: Competenza (MVP) or Anomalia (Sospeso). */
function markTrack(card, kind) {
  if (kind === 'mvp') card._competencyProgress = Math.min(lastObtainable(card, 'competency'), card._competencyProgress + 1);
  else card._anomalyState.progress = Math.min(lastObtainable(card, 'anomaly'), card._anomalyState.progress + 1);
  saveSettings();
  renderAgency();
}

/** The Distinzioni on the Agents tab too: each card's portrait dressed up, the ribbon under it. */
function decorateAgentCards() {
  getCharElements().forEach(card => {
    const portrait = card.querySelector('.char-portrait');
    if (!portrait) return;
    portrait.querySelectorAll('.agency-portrait-badge, .agency-portrait-stamp').forEach(node => node.remove());
    card.querySelector('.char-ribbons')?.remove();
    const ribbons = el('div', 'char-ribbons');
    Object.entries(DISTINCTIONS).forEach(([kind, distinction]) => {
      const holds = holders[kind] === card._id;
      portrait.classList.toggle(kind, holds);
      const ribbon = el('span', `agency-ribbon ${kind}`, `${distinction.icon} ${distinction.ribbon}`);
      ribbon.classList.toggle('empty', !holds);
      if (!holds) ribbon.setAttribute('aria-hidden', 'true');
      ribbons.append(ribbon);
      if (holds) {
        portrait.append(el('span', `agency-portrait-badge ${kind}`, distinction.icon));
        if (kind === 'suspended') portrait.append(el('span', 'agency-portrait-stamp', 'Sospeso'));
      }
    });
    // Both rows stay in the layout even when an agent holds neither Distinzione. This keeps
    // every field on adjacent cards aligned as the awards move between agents.
    portrait.after(ribbons);
  });
}

/** Hand a Distinzione to `card` (null: to nobody). The previous holder keeps their count. */
function award(kind, card) {
  holders[kind] = card?._id ?? null;
  decorateAgentCards();
  if (!card) return;
  card._distinctions[kind] += 1;
  celebrations.add(`${kind}:${card._id}`);
  // Awarded while the agent cards are on screen (Next Mission): celebrate there straight away.
  const cardPortrait = card.querySelector('.char-portrait');
  if (cardPortrait && !card.closest('[hidden]')) celebrate(cardPortrait, kind);
  const distinction = DISTINCTIONS[kind];
  const cards = getCharElements();
  toast(distinction.toast(agentName(card, cards.indexOf(card))), {
    duration: 9000,
    action: { label: `Segna ${distinction.track}`, onClick: () => markTrack(card, kind) }
  });
}

/** Take back a Distinzione handed out by mistake. */
function revoke(kind, card) {
  if (holders[kind] !== card._id) return;
  holders[kind] = null;
  card._distinctions[kind] = Math.max(0, card._distinctions[kind] - 1);
  decorateAgentCards();
}

/**
 * End of an Incarico: MVP to the agent with the most Note di Merito, Sospeso to the one with
 * the most Note di Demerito. A tie (or nobody scoring) leaves it unassigned for the GM to hand out.
 */
export function awardMissionDistinctions({ mvp = null, suspended = null } = {}) {
  award('mvp', mvp);
  award('suspended', suspended);
  saveHolders();
  saveSettings();
}

/** Confetti for a new MVP, the stamp coming down on a new Sospeso. */
function celebrate(portrait, kind) {
  if (!motionAllowed()) return;
  portrait.classList.add(`celebrate-${kind}`);
  if (kind === 'mvp') {
    for (let i = 0; i < 20; i++) {
      const bit = el('span', 'agency-confetti');
      bit.style.setProperty('--angle', `${i * 18 + (i % 2) * 7}deg`);
      bit.style.setProperty('--distance', `${46 + (i % 3) * 16}px`);
      bit.style.setProperty('--color', CONFETTI[i % CONFETTI.length]);
      portrait.append(bit);
    }
  }
  setTimeout(() => {
    portrait.classList.remove(`celebrate-${kind}`);
    portrait.querySelectorAll('.agency-confetti').forEach(bit => bit.remove());
  }, 1900);
}

/** The agent's portrait, dressed for whatever Distinzione they hold. */
function createPortrait(card) {
  const portrait = el('span', 'agency-portrait');
  const img = el('img');
  img.src = card.querySelector('img')?.src || './images/pfp.jpg';
  img.alt = '';
  portrait.append(img);
  Object.entries(DISTINCTIONS).forEach(([kind, distinction]) => {
    if (holders[kind] !== card._id) return;
    portrait.classList.add(kind);
    portrait.append(el('span', `agency-portrait-badge ${kind}`, distinction.icon));
    if (kind === 'suspended') portrait.append(el('span', 'agency-portrait-stamp', 'Sospeso'));
    const key = `${kind}:${card._id}`;
    if (celebrations.has(key) && !view.hidden) {
      celebrations.delete(key);
      requestAnimationFrame(() => celebrate(portrait, kind));
    }
  });
  return portrait;
}

/** MVP and Sospeso on the agent's page: how many times, and whether they hold it now. */
function createDistinctions(card) {
  const section = el('section', 'agency-panel agency-distinctions');
  section.append(el('h3', '', 'Distinzioni'));
  const cards = getCharElements();
  Object.entries(DISTINCTIONS).forEach(([kind, distinction]) => {
    const current = holders[kind] === card._id;
    const box = el('div', `agency-distinction ${kind}`);
    box.classList.toggle('current', current);

    const text = el('span', 'agency-distinction-text');
    const holder = cards.find(other => other._id === holders[kind]);
    const rule = holder && !current ? `${distinction.rule} · in carica: ${agentName(holder, cards.indexOf(holder))}` : distinction.rule;
    text.append(el('strong', 'agency-distinction-title', distinction.title), el('span', 'agency-distinction-rule', rule));
    const head = el('div', 'agency-distinction-head');
    head.append(el('span', 'agency-distinction-icon', distinction.icon), text);

    const value = el('strong', 'agency-distinction-value', String(card._distinctions[kind]));
    const step = delta => {
      card._distinctions[kind] = Math.max(0, card._distinctions[kind] + delta);
      value.textContent = String(card._distinctions[kind]);
      saveSettings();
    };
    const minus = button('agency-step', '−', () => step(-1));
    minus.setAttribute('aria-label', `${distinction.title}: una volta in meno`);
    const plus = button('agency-step', '+', () => step(1));
    plus.setAttribute('aria-label', `${distinction.title}: una volta in più`);
    const count = el('div', 'agency-distinction-count');
    count.append(el('span', 'agency-label', 'Numero di volte'), minus, value, plus);

    box.append(head, count);
    if (current) {
      box.append(
        el('p', 'agency-distinction-flavor', `${distinction.ribbon}. ${distinction.flavor}`),
        button('agency-distinction-revoke', 'Revoca', () => { revoke(kind, card); saveHolders(); saveSettings(); renderAgency(); })
      );
    } else {
      box.append(button('agency-distinction-award', distinction.award, () => { award(kind, card); saveHolders(); saveSettings(); renderAgency(); }));
    }
    section.append(box);
  });
  return section;
}

/** The names offered when naming an item; drawn again whenever the catalog on /settings changes. */
function createCatalog() {
  const list = el('datalist');
  list.id = CATALOG_ID;
  onConfigChange(() => {
    list.replaceChildren(...catalog().map(entry => {
      const option = el('option');
      option.value = entry.name;
      return option;
    }));
  });
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

/**
 * The icon window: the catalog icon ("Auto", the default), then the rest. Picking one sets
 * it on the item, runs `onPick` and closes the window.
 */
function chooseIcon(item, onPick) {
  const picker = el('div', 'agency-icon-picker');
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Icone');
  let close = () => {};
  ['', ...ITEM_ICONS].forEach(icon => {
    const choice = el('button', 'agency-icon-choice', icon || 'Auto');
    choice.type = 'button';
    choice.title = icon ? `Icona ${icon}` : `Icona del catalogo (${catalogEntry(item.name)?.icon || DEFAULT_ICON})`;
    choice.setAttribute('aria-pressed', String(icon === item.icon));
    if (icon === item.icon) choice.autofocus = true;
    choice.addEventListener('click', () => {
      item.icon = icon;
      onPick();
      close();
    });
    picker.append(choice);
  });
  close = openModal({ title: 'Scegli un’icona', content: picker, className: 'agency-icon-modal', closeLabel: 'Annulla' });
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
    else next.textContent = progress < lastObtainable(card, 'competency') ? 'Vertice della carriera' : 'Tracciato completo';
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
    card, trackKey: 'competency',
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
  switcher.append(...entries.map(({ label, icon, current, onClick, agentId }) => {
    const chip = button('agency-switch', '', onClick);
    if (agentId) chip.dataset.agentId = agentId;
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
  const dead = card.classList.contains('dead');
  const subtitle = el('span', 'agency-subtitle', [statOf(card, 'player'), statOf(card, 'competency')].filter(Boolean).join(' · '));
  if (dead) subtitle.append(el('span', 'agency-sick', subtitle.textContent ? ' · Sick leave' : 'Sick leave'));
  const text = el('span', 'agency-identity-text');
  text.append(el('strong', 'agency-name', agentName(card, index)), subtitle);
  Object.entries(DISTINCTIONS).forEach(([kind, distinction]) => {
    if (holders[kind] === card._id) text.append(el('span', `agency-ribbon ${kind}`, `${distinction.icon} ${distinction.ribbon}`));
  });
  identity.append(createPortrait(card), text);
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
    markCrossedOff(square, n, card, 'competency');
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
function addBlankItem(from) {
  const item = normalizeItem(from ? { owner: from._id, holder: from._id } : {});
  items.push(item);
  saveItems();
  openItemPage(item, from);
  view.querySelector('.agency-item-page-name')?.focus();
}

const BLANK = 'blank';   // the picker's "write it yourself" choice

/**
 * "+ Aggiungi oggetto": pick what to give, `from` the agent (or the Team, with no agent). The
 * standard kit, then the catalog of /settings, each version with its price; or a blank item to
 * write. Given to an agent, its price can come off their banked Note di Merito in the same
 * step, which is how a purchase request from the published copy is settled.
 */
function addItem(from) {
  const cards = getCharElements();
  const who = from ? agentName(from, cards.indexOf(from)) : 'il Team';
  const merits = from ? meritsOf(from) : 0;
  const entries = [
    ...STANDARD_KIT.map(entry => ({ ...entry, options: [{ label: 'Dotazione standard', cost: 0 }] })),
    ...purchaseCatalog()
  ];

  const form = el('form', 'manager-message-form purchase-form item-picker');
  form.innerHTML = `
    <p class="purchase-balance" hidden>Note di Merito disponibili <strong></strong></p>
    <div class="purchase-list" role="radiogroup" aria-label="Oggetti"></div>
    <label class="purchase-deduct" hidden><input type="checkbox" name="deduct"><span></span></label>
    <p class="manager-message-state" aria-live="polite"></p>`;
  if (from) {
    form.querySelector('.purchase-balance').hidden = false;
    form.querySelector('.purchase-balance strong').textContent = `★ ${merits}`;
  }
  const list = form.querySelector('.purchase-list');
  const blank = el('article', 'purchase-entry');
  const blankHead = el('div', 'purchase-entry-head');
  blankHead.append(el('span', 'purchase-entry-icon', DEFAULT_ICON), el('strong', 'purchase-entry-name', 'Oggetto nuovo'));
  const blankOptions = el('div', 'purchase-options');
  blankOptions.append(purchaseOption(BLANK, 'Scrivi tu nome, descrizione e icona', '', true));
  blank.append(blankHead, blankOptions);
  // Everything can be given, whatever it costs: Infinity leaves no version greyed out.
  list.append(blank, ...entries.map((entry, index) => purchaseCard(entry, index, Infinity)));

  const deduct = form.querySelector('.purchase-deduct');
  const deductBox = deduct.querySelector('input');
  const state = form.querySelector('.manager-message-state');
  const picked = () => {
    const value = form.querySelector('input[name="choice"]:checked')?.value || '';
    if (!value || value === BLANK) return value ? { blank: true } : null;
    const [index, n] = value.split(':').map(Number);
    const entry = entries[index];
    return entry?.options[n] ? { entry, option: entry.options[n] } : null;
  };
  list.addEventListener('change', () => {
    list.querySelectorAll('.purchase-entry').forEach(card => card.classList.toggle('selected', !!card.querySelector('input:checked')));
    state.textContent = '';
    const choice = picked();
    const cost = choice?.option?.cost || 0;
    deduct.hidden = !from || !cost;
    if (deduct.hidden) return;
    const enough = cost <= merits;
    deductBox.disabled = !enough;
    deductBox.checked = enough;
    deduct.classList.toggle('unaffordable', !enough);
    deduct.querySelector('span').textContent = enough
      ? `Scala ★ ${cost} Note di Merito a ${who} (ne resteranno ${merits - cost})`
      : `${who} ha solo ★ ${merits}: le Note di Merito non vengono scalate`;
  });

  let close = null;
  const give = () => {
    const choice = picked();
    if (!choice) {
      state.textContent = 'Scegli che cosa assegnare.';
      return;
    }
    close?.();
    if (choice.blank) {
      addBlankItem(from);
      return;
    }
    const { entry, option } = choice;
    const party = from ? from._id : TEAM;
    const item = normalizeItem({
      name: entry.options.length > 1 ? `${entry.name} (${option.label})` : entry.name,
      description: entry.description,
      icon: entry.icon,
      owner: party,
      holder: party
    });
    items.push(item);
    saveItems();
    let paid = 0;
    if (from && option.cost > 0 && deductBox.checked && option.cost <= merits) {
      const total = from.querySelector('.counter-input.merit');
      total.value = String(merits - option.cost);
      total.dispatchEvent(new Event('input', { bubbles: true }));   // saves, like typing in it
      paid = option.cost;
    }
    renderAgency();
    toast(`${item.name} assegnato a ${who}${paid ? ` · −★ ${paid} Note di Merito` : ''}.`, { kind: 'success', duration: 5000 });
  };

  close = openModal({
    title: from ? `Assegna un oggetto a ${who}` : 'Assegna un oggetto al Team',
    content: form,
    className: 'manager-message-modal purchase-modal item-picker-modal tx-manager',
    closeLabel: 'Annulla',
    actions: [{ label: 'Assegna', variant: 'primary', submit: true, onClick: () => { give(); return false; } }]
  });
}

// ---------- purchase requests (a published copy, signed in as an agent) ----------
const OTHER = 'other';   // the "something else" choice: the player names it, the Manager sets the price

/** What this agent may ask for, as set on the Players tab of /settings: catalog entries, and whether "Altro…". */
function purchaseChoices(agentId) {
  return {
    catalog: purchaseCatalog().filter(entry => purchaseAllowed(agentId, entry.id)),
    other: purchaseAllowed(agentId, PURCHASE_OTHER)
  };
}

/**
 * The agent's Note di Merito to spend: the total banked beside the merit triangle on their card
 * (the triangle itself is this Incarico's, added to the total when it ends, and may be sealed).
 */
function availableMerits(agentId) {
  return meritsOf(getCharElements().find(candidate => String(candidate._id) === agentId));
}

/** The banked Note di Merito of an agent card (the box beside its merit triangle). */
function meritsOf(card) {
  return Math.max(0, Number.parseInt(card?.querySelector('.counter-input.merit')?.value, 10) || 0);
}

const meritText = n => `${n} ${n === 1 ? 'Nota' : 'Note'} di Merito`;
const priceText = cost => (cost === 0 ? 'Gratis' : `★ ${cost}`);

/** One choice in the list: a way to get an Acquisizione (or "Altro…"), with its price. */
function purchaseOption(value, label, price, affordable) {
  const option = el('label', 'purchase-option');
  option.classList.toggle('unaffordable', !affordable);
  const radio = el('input');
  radio.type = 'radio';
  radio.name = 'choice';
  radio.value = value;
  radio.disabled = !affordable;
  option.append(radio, el('span', 'purchase-option-label', label), el('span', 'purchase-cost', price));
  if (!affordable) option.title = 'Note di Merito insufficienti';
  return option;
}

/** An Acquisizione as a card: icon, name, description, then each way to get it with its cost. */
function purchaseCard(entry, index, merits) {
  const card = el('article', 'purchase-entry');
  const options = el('div', 'purchase-options');
  options.append(...entry.options.map((option, n) => purchaseOption(`${index}:${n}`, option.label, priceText(option.cost), option.cost <= merits)));
  card.classList.toggle('unaffordable', entry.options.every(option => option.cost > merits));
  const head = el('div', 'purchase-entry-head');
  head.append(el('span', 'purchase-entry-icon', entry.icon), el('strong', 'purchase-entry-name', entry.name));
  card.append(head, el('p', 'purchase-entry-description', entry.description), options);
  return card;
}

/**
 * Ask the Manager for an Acquisizione from the catalog, or anything else, with a note. Only what
 * the agent's banked Note di Merito cover can be picked. It goes on the agent's direct line and
 * as a notification (messages.js), with the cost: the Manager gives the item, takes the Note di
 * Merito and publishes the new version. Nothing on this copy changes.
 */
function openPurchaseForm(agentId, { catalog, other: otherAllowed }) {
  const merits = availableMerits(agentId);
  const form = el('form', 'manager-message-form purchase-form');
  form.innerHTML = `
    <p class="manager-message-target">Richiesta all’<strong>Amministrazione</strong>: l’oggetto arriva con il prossimo aggiornamento del fascicolo, e le Note di Merito vengono scalate allora.</p>
    <p class="purchase-balance">Note di Merito disponibili <strong></strong></p>
    <div class="purchase-list" role="radiogroup" aria-label="Acquisizioni"></div>
    <label class="field purchase-other-name" hidden><span class="field-label">Che cosa</span><input name="other" type="text" maxlength="120" autocomplete="off" placeholder="Nome dell’oggetto"></label>
    <label class="field"><span class="field-label">Nota per l’Amministrazione (facoltativa)</span><textarea name="note" rows="2" maxlength="300" placeholder="Per chi è, quante, o perché serve"></textarea></label>
    <p class="manager-message-state" aria-live="polite"></p>`;
  form.querySelector('.purchase-balance strong').textContent = `★ ${merits}`;
  const list = form.querySelector('.purchase-list');
  list.append(...catalog.map((entry, index) => purchaseCard(entry, index, merits)));
  if (otherAllowed) {
    const card = el('article', 'purchase-entry purchase-other');
    const head = el('div', 'purchase-entry-head');
    head.append(el('span', 'purchase-entry-icon', '📦'), el('strong', 'purchase-entry-name', 'Altro…'));
    const options = el('div', 'purchase-options');
    options.append(purchaseOption(OTHER, 'Qualcosa che non è in catalogo', 'Prezzo da concordare', true));
    card.append(head, el('p', 'purchase-entry-description', 'Descrivi l’oggetto: l’Amministrazione ne stabilisce il prezzo.'), options);
    list.append(card);
  }
  const other = form.elements.namedItem('other');
  const note = form.elements.namedItem('note');
  const state = form.querySelector('.manager-message-state');
  const picked = () => form.querySelector('input[name="choice"]:checked')?.value || '';
  list.addEventListener('change', () => {
    list.querySelectorAll('.purchase-entry').forEach(card => card.classList.toggle('selected', !!card.querySelector('input:checked')));
    other.closest('.field').hidden = picked() !== OTHER;
    if (picked() === OTHER) other.focus();
    state.textContent = '';
  });

  let close = null;
  const submit = async () => {
    const value = picked();
    other.classList.remove('invalid');
    state.className = 'manager-message-state';
    let request;
    if (value === OTHER && otherAllowed) {
      const item = other.value.trim();
      if (!item) {
        other.classList.add('invalid');
        other.focus();
        state.textContent = 'Scrivi il nome dell’oggetto.';
        return;
      }
      request = { item, option: '', cost: null };
    } else {
      // Only what the Players tab allows and the Note di Merito cover, even if the form was tampered with.
      const [index, n] = value.split(':').map(Number);
      const entry = catalog[index];
      const option = entry?.options[n];
      if (!option || option.cost > merits) {
        state.textContent = 'Scegli un’Acquisizione che puoi permetterti.';
        return;
      }
      request = { item: entry.name, option: option.label, cost: option.cost };
    }
    const send = form.closest('.modal-panel')?.querySelector('.modal-btn-primary');
    const fields = [...form.elements].filter(field => !field.disabled);
    if (send) send.disabled = true;
    fields.forEach(field => { field.disabled = true; });
    state.textContent = 'Invio in corso…';
    if (await requestPurchase({ ...request, available: merits, note: note.value })) {
      close?.();
      const what = request.option ? `${request.item} (${request.option})` : request.item;
      toast(`Richiesta inviata all’Amministrazione: ${what}${request.cost === null ? '' : ` · ★ ${request.cost}`}.`, { kind: 'success', duration: 6000 });
      return;
    }
    fields.forEach(field => { field.disabled = false; });
    if (send) send.disabled = false;
    state.classList.add('is-error');
    state.textContent = 'Invio non riuscito · riprova';
  };

  close = openModal({
    title: 'Richiedi un’Acquisizione',
    content: form,
    className: 'manager-message-modal purchase-modal tx-manager',
    closeLabel: 'Annulla',
    actions: [{ label: 'Invia richiesta', variant: 'primary', submit: true, onClick: () => { submit(); return false; } }]
  });
}

/**
 * Only for the player signed in as `card`'s agent (or any agent, without a card), and only
 * when the Players tab of /settings lets that agent ask for something.
 */
function createPurchaseButton(card = null) {
  const agentId = purchasingAgentId();
  if (!agentId || (card && String(card._id) !== agentId)) return null;
  const choices = purchaseChoices(agentId);
  if (!choices.catalog.length && !choices.other) return null;
  const node = button('agency-request', '🛒 Richiedi un’Acquisizione', () => openPurchaseForm(agentId, choices));
  node.title = `Chiedi all’Amministrazione un oggetto in cambio di Note di Merito (ne hai ${availableMerits(agentId)})`;
  return node;
}

// ---------- overview ----------
function createSummary(card, index) {
  const progress = card._competencyProgress;
  const { title } = RANKS[rankAt(progress)];
  const held = heldBy(card._id);
  const tile = button('agency-summary', '', () => openAgent(card));
  tile.dataset.agentId = card._id;
  tile.classList.toggle('dead', card.classList.contains('dead'));
  tile.setAttribute('aria-label', `${agentName(card, index)}. ${title}, ${progress} di ${TRACK_LENGTH}. ${held.length} oggetti.`);

  const rank = el('span', 'agency-summary-rank');
  rank.append(el('span', 'agency-label', 'Qualifica in Agenzia'), el('strong', 'agency-rank', title), el('span', 'agency-progress', `${progress} / ${TRACK_LENGTH}`));

  const inventory = el('span', 'agency-summary-items');
  if (held.length) inventory.append(...held.map(item => el('span', 'agency-summary-icon', iconOf(item))));
  else inventory.append(el('span', 'agency-empty', 'Nessun oggetto'));

  const { mvp, suspended } = card._distinctions;
  const tally = el('span', 'agency-summary-tally');
  tally.append(el('span', 'agency-tally mvp', `🏆 MVP ×${mvp}`), el('span', 'agency-tally suspended', `⛔ Sospeso ×${suspended}`));

  tile.append(createIdentity(card, index), rank, createTrackSummary(card), tally, inventory, el('span', 'agency-open', 'Apri ›'));
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
  const request = createPurchaseButton(card);
  if (request) grid.append(request);
  inventory.append(el('h3', '', `Inventario (${held.length})`), grid);

  const side = el('div', 'agency-agent-side');
  side.append(createDistinctions(card), inventory, ladder.section);
  const body = el('div', 'agency-agent-body');
  body.append(profile, side);

  const nav = createNav('Tutti gli agenti', cards.map((other, i) => ({
    label: agentName(other, i), current: other === card, onClick: () => openAgent(other), agentId: other._id
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

  // the big icon is the button that opens the icon window
  const icon = el('span', 'agency-item-page-icon-glyph');
  const iconButton = button('agency-item-page-icon', '', () => chooseIcon(item, () => { showIcon(); saveItems(); }));
  iconButton.title = 'Cambia icona';
  iconButton.setAttribute('aria-label', 'Cambia icona');
  iconButton.append(icon, el('span', 'agency-item-page-icon-edit', 'Cambia'));
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
  header.append(iconButton, field('Nome', name, 'agency-item-page-title'));

  const owners = el('div', 'agency-item-page-parties');
  owners.append(
    field('Proprietario', createPartySelect(item, 'owner', cards, saveItems)),
    field('Detentore', createPartySelect(item, 'holder', cards, saveItems))
  );

  const page = el('article', 'agency-panel agency-item-page');
  page.append(header, owners, field('Descrizione', description), button('agency-remove-item', 'Rimuovi oggetto', () => removeItem(item)));
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

  const order = [...PROMO_SLIDES];
  if (PROMO_SHUFFLE) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }

  const slides = order.map((data, index) => {
    const slide = el('article', `promo-slide${data.poster ? ' poster' : ''}`);
    slide.setAttribute('aria-roledescription', 'slide');
    slide.setAttribute('aria-label', `${index + 1} di ${order.length}: ${data.title}`);

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
  else if (openCard) view.replaceChildren(promo, createAgentPage(openCard, cards));
  else {
    const overview = el('div', 'agency-overview');
    if (!cards.length) overview.append(el('p', 'rel-empty', 'Nessun agente. Aggiungi un agente con Hire Agent.'));
    overview.append(...cards.map(createSummary));
    const request = createPurchaseButton();
    const bar = request && el('div', 'agency-request-bar');
    const merits = request ? availableMerits(purchasingAgentId()) : 0;
    bar?.append(el('span', 'agency-request-text', `Hai ★ ${meritText(merits)} da spendere: chiedi un’Acquisizione all’Amministrazione.`), request);
    view.replaceChildren(promo, ...(bar ? [bar] : []), overview, createTeamItems(cards));
  }
  view.scrollTop = scrollTop;
}

/**
 * Take up the team's items and Distinzioni. Called once the team is known (a published copy
 * holds the snapshot's only after the settings load), so it never reads, or seeds the
 * standard kit into, the copy this browser keeps.
 */
export function loadAgency() {
  const saved = loadSettings()?.world?.items;
  items = Array.isArray(saved) ? saved.map(normalizeItem) : STANDARD_KIT.map(normalizeItem);
  if (!Array.isArray(saved)) saveItems();   // a new branch, or one saved before items existed
  const distinctions = loadSettings()?.world?.distinctions;
  holders = { mvp: distinctions?.mvp ?? null, suspended: distinctions?.suspended ?? null };
  decorateAgentCards();
  if (!view.hidden) renderAgency();
}

export function initAgency() {
  view = document.getElementById('agencyView');
  document.body.append(createCatalog());
  promo = createPromo();
  // Hiring, recalling, removing an agent all end in updateTopCharacters(), which fires this.
  document.addEventListener('dashboard-refresh', () => {
    decorateAgentCards();
    if (!view.hidden) renderAgency();
  });
  // Signed in on a published copy: the purchase request button appears once the line is known.
  document.addEventListener('messages-ready', () => {
    if (!view.hidden) renderAgency();
  });
  view.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !(openCard || openItem) || event.target.closest('input, textarea, select')) return;
    event.preventDefault();
    goBack();
  });
}
