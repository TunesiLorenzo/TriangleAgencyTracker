/* The printable agent badges on /badges: the login screen's badge (index.html, css/login.css)
 * for every agent, with what badge.js says goes on it. */
import { divisionOf, drawBarcode, qualificationOf } from '/js/badge.js';

const SVG = 'http://www.w3.org/2000/svg';
const agents = JSON.parse(document.getElementById('agents').textContent || '[]');

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

function badge(agent) {
  const card = el('div', 'login-badge-card');
  card.append(el('span', 'login-badge-slot'));

  const head = el('div', 'login-badge-head');
  const brand = el('span');
  brand.append('Triangle', el('br'), 'Agency');
  head.append(
    svg('0 0 200 180', 'login-badge-logo', [['polygon', { points: '100,16 12,168.42 188,168.42' }], ['polygon', { points: '75.75,103.61 124.25,103.61 100,145.61' }]]),
    brand,
    el('span', 'login-badge-chip')
  );

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
  const role = el('p', 'login-badge-role', name);
  role.classList.toggle('is-long', name.length > 9);

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
  const wrap = el('article', 'print-badge');
  wrap.setAttribute('aria-label', `Badge of ${name}`);
  if (!agent.badge) wrap.title = 'No account on the Players tab, so no badge number';
  wrap.append(card);
  return wrap;
}

const sheet = document.getElementById('sheet');
sheet.replaceChildren(...agents.map(badge));
document.getElementById('empty').hidden = agents.length > 0;
document.getElementById('print').addEventListener('click', () => window.print());
document.getElementById('cutLines').addEventListener('change', event => {
  sheet.classList.toggle('with-cut-lines', event.target.checked);
});
