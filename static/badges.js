/* The printable cards on /badges: the login screen's badge (index.html, css/login.css) for
 * every agent, with what badge.js says goes on it; and on /badges/access, a card in its style
 * with each player account's username and password. */
import { divisionOf, drawBarcode, qualificationOf } from '/js/badge.js';

const SVG = 'http://www.w3.org/2000/svg';
const mode = document.body.dataset.mode;
const cards = JSON.parse(document.getElementById('cards').textContent || '[]');
const site = JSON.parse(document.getElementById('site').textContent || '""');

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(viewBox, className, shapes) {
  const node = document.createElementNS(SVG, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  if (className) node.setAttribute('class', className);
  shapes.forEach(([tag, attributes]) => {
    const shape = document.createElementNS(SVG, tag);
    Object.entries(attributes).forEach(([name, value]) => shape.setAttribute(name, value));
    node.append(shape);
  });
  return node;
}

function metaRow(label, value) {
  const row = el('div');
  row.append(el('dt', '', label), el('dd', '', value));
  return row;
}

function header() {
  const head = el('div', 'login-badge-head');
  const brand = el('span');
  brand.append('Triangle', el('br'), 'Agency');
  head.append(
    svg('0 0 200 180', 'login-badge-logo', [['polygon', { points: '100,16 12,168.42 188,168.42' }], ['polygon', { points: '75.75,103.61 124.25,103.61 100,145.61' }]]),
    brand,
    el('span', 'login-badge-chip')
  );
  return head;
}

// Always the size the login badge gives a long name, so every card lines up whatever the
// name's length (the bigger size is for the login screen's role words: AGENT, MANAGER).
function nameplate(name) {
  return el('p', 'login-badge-role is-long', name);
}

function printable(card, label, title) {
  const wrap = el('article', 'print-badge');
  wrap.setAttribute('aria-label', label);
  if (title) wrap.title = title;
  wrap.append(card);
  return wrap;
}

function badge(agent) {
  const card = el('div', 'login-badge-card');
  card.append(el('span', 'login-badge-slot'));
  const head = header();

  // Their portrait, or the silhouette of the login screen.
  const photo = el('div', 'login-badge-photo');
  photo.append(svg('0 0 100 125', '', [['circle', { cx: 50, cy: 48, r: 20 }], ['path', { d: 'M12 125 C12 92 31 78 50 78 C69 78 88 92 88 125 Z' }]]));
  if (agent.icon) {
    const picture = el('img', 'login-badge-picture');
    picture.alt = '';
    picture.addEventListener('error', () => photo.classList.remove('has-picture'));
    picture.src = agent.icon;
    photo.append(picture);
    photo.classList.add('has-picture');
  }

  const name = agent.name || 'Agent';
  const role = nameplate(name);

  const meta = el('dl', 'login-badge-meta');
  const clearance = metaRow('Clearance', '');
  const pips = el('span', 'login-badge-pips');
  for (let i = 0; i < 5; i++) pips.append(el('i'));
  clearance.querySelector('dd').append(pips);
  meta.append(
    clearance,
    metaRow('Division', divisionOf(agent.competency) || 'Observation'),
    metaRow('Qualification', qualificationOf(agent.progress))
  );

  const barcode = el('div', 'login-badge-barcode');
  drawBarcode(barcode, agent.badge || name);

  card.append(
    head,
    photo,
    role,
    el('p', 'login-badge-id', agent.badge ? `#${agent.badge}` : '#————'),
    meta,
    barcode,
    el('p', 'login-badge-fine', 'Property of the Agency · If found, do not investigate')
  );
  return printable(card, `Badge of ${name}`, agent.badge ? '' : 'No account on the Players tab, so no badge number');
}

/* ---------- the access card: what a player types at the login screen ---------- */
function credential(label, value) {
  const field = el('div', 'access-field');
  const text = el('span', 'access-value', value);
  // Long ones shrink to stay on one line: a password must be read exactly.
  text.style.setProperty('--chars', Math.max(value.length, 8));
  field.append(el('span', 'access-label', label), text);
  return field;
}

function accessCard(account) {
  const card = el('div', 'login-badge-card access-card');
  card.append(el('span', 'login-badge-slot'), header());
  const name = account.name || account.username;
  card.append(
    el('p', 'access-title', 'Access credentials'),
    nameplate(name),
    el('p', 'login-badge-id', account.badge ? `#${account.badge}` : '#————'),
    credential('Username', account.username),
    credential('Password', account.password),
    el('p', 'access-hint', 'The password is case-sensitive')
  );
  if (site) {
    const terminal = el('p', 'access-site');
    // Host and path on a line each, in a plain face: the badge's font draws every A as a triangle.
    const [host, ...path] = site.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/');
    const url = el('span', 'access-url');
    url.append(el('span', '', path.length ? `${host}/` : host));
    if (path.length) url.append(el('span', '', path.join('/')));
    terminal.append(el('span', 'access-label', 'Terminal'), url);
    card.append(terminal);
  }
  const barcode = el('div', 'login-badge-barcode');
  drawBarcode(barcode, account.badge || account.username);
  card.append(barcode, el('p', 'login-badge-fine', 'Confidential · Memorise, then destroy'));
  return printable(card, `Access card of ${name}`);
}

const sheet = document.getElementById('sheet');
// ?solo=N (the Communication Center's Update cards): only card N, filling the window.
const solo = document.body.dataset.solo;
const shown = solo === undefined ? cards : cards.slice(Number(solo), Number(solo) + 1);

/* ---------- duplex: badges on one page, their access cards behind on the next ---------- */
// Nine to a sheet, in a grid centred on the page. Flipped on the long edge, the back page's
// columns run the other way, so each card goes in the mirrored column of its badge's row.
const PER_PAGE = 9;
const COLUMNS = 3;

function slot(card, index, mirrored) {
  const row = Math.floor(index / COLUMNS);
  const column = index % COLUMNS;
  const place = card || el('div', 'print-badge duplex-blank');
  place.style.gridRow = String(row + 1);
  place.style.gridColumn = String((mirrored ? COLUMNS - 1 - column : column) + 1);
  return place;
}

function duplexPages(pairs) {
  const pages = [];
  for (let start = 0; start < pairs.length; start += PER_PAGE) {
    const chunk = pairs.slice(start, start + PER_PAGE);
    const sheetNo = start / PER_PAGE + 1;
    const front = el('section', 'duplex-page duplex-front');
    front.dataset.label = `Sheet ${sheetNo} · front: badges`;
    front.append(...chunk.map((pair, index) => slot(pair.front && badge(pair.front), index, false)));
    const back = el('section', 'duplex-page duplex-back');
    back.dataset.label = `Sheet ${sheetNo} · back: access cards (mirrored)`;
    back.append(...chunk.map((pair, index) => slot(pair.back && accessCard(pair.back), index, true)));
    pages.push(front, back);
  }
  return pages;
}

if (mode === 'duplex') {
  sheet.classList.add('duplex');
  sheet.replaceChildren(...duplexPages(cards));
} else {
  sheet.replaceChildren(...shown.map(mode === 'access' ? accessCard : badge));
}
document.getElementById('empty').hidden = cards.length > 0;
document.getElementById('print').addEventListener('click', () => window.print());
document.getElementById('cutLines').addEventListener('change', event => {
  sheet.classList.toggle('with-cut-lines', event.target.checked);
});
