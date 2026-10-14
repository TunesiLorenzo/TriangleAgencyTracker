// relationshipsExtras.js
// Responsibilities: the bottom of the Relationships overview. The Network map draws every agent
// with their relationships around them (a relationship two agents share by name sits between
// them; line weight follows the bond, Network relationships glow). The phone shows a lock screen
// where the relationships keep texting the agents, and the HR ticker scrolls the Agency's memos
// on having a life. The phone and the ticker are built once and kept across renders, like the
// Agency's promo banner, so their timers and scroll survive a refresh.

import { MAX_CONNECTION } from './charSystem.js';
import { AGENCY_SENDER, TEXTS, textsReady } from './relationshipsData.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 1000;             // map viewBox
const H = 600;
const CX = W / 2;
const CY = H / 2;
const AGENT_RX = 210;       // the agents' ellipse
const AGENT_RY = 125;
const OUTER_RX = 420;       // the private relationships' ellipse
const OUTER_RY = 235;
const LABEL_CHARS = 14;

const PHONE_SLOTS = 4;      // notifications on the lock screen
const PHONE_EVERY = 8000;   // ms between messages, plus up to half as much at random
const AGENCY_ODDS = 0.12;   // chance a message comes from the Agency instead

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function initialOf(name) {
  return Array.from(name.trim())[0]?.toUpperCase() || '?';
}

function shorten(text) {
  return text.length > LABEL_CHARS ? `${text.slice(0, LABEL_CHARS - 1)}…` : text;
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/** Fills {name} placeholders; unknown ones are left as written. */
function fill(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

// ---------- Network map ----------

/**
 * Agents on an inner ellipse; each agent's own relationships fanned out on the outer one behind
 * them; relationships shared by name between agents pulled in between those agents.
 */
function layout(agents) {
  const n = agents.length;
  const start = -Math.PI / 2 + Math.PI / n;   // keeps two agents side by side, not stacked
  agents.forEach((agent, i) => {
    agent.angle = n === 1 ? -Math.PI / 2 : start + (i * 2 * Math.PI) / n;
    agent.x = n === 1 ? CX : CX + AGENT_RX * Math.cos(agent.angle);
    agent.y = n === 1 ? CY : CY + AGENT_RY * Math.sin(agent.angle);
  });

  const nodes = [];
  const byName = new Map();
  agents.forEach(agent => {
    const seen = new Set();
    agent.relationships.forEach(relationship => {
      const key = relationship.name.trim().toLowerCase();
      if (key && seen.has(key)) return;   // one node per name and agent
      if (key) seen.add(key);
      let node = key && byName.get(key);
      if (!node) {
        node = { links: [] };
        nodes.push(node);
        if (key) byName.set(key, node);
      }
      node.links.push({ agent, relationship });
    });
  });

  const shared = nodes.filter(node => node.links.length > 1);
  shared.forEach((node, k) => {
    const x = node.links.reduce((sum, link) => sum + link.agent.x, 0) / node.links.length;
    const y = node.links.reduce((sum, link) => sum + link.agent.y, 0) / node.links.length;
    const spread = shared.length > 1 ? 1 : 0;
    const angle = -Math.PI / 2 + (k * 2 * Math.PI) / shared.length;
    node.x = CX + (x - CX) * 0.4 + spread * 80 * Math.cos(angle);
    node.y = CY + (y - CY) * 0.4 + spread * 55 * Math.sin(angle);
  });

  agents.forEach(agent => {
    const own = nodes.filter(node => node.links.length === 1 && node.links[0].agent === agent);
    const m = own.length;
    const span = n === 1 ? 2 * Math.PI : ((2 * Math.PI) / n) * 0.8;
    const step = n === 1 ? span / Math.max(m, 1) : m > 1 ? Math.min(0.45, span / (m - 1)) : 0;
    own.forEach((node, k) => {
      const angle = n === 1 ? -Math.PI / 2 + k * step : agent.angle + (k - (m - 1) / 2) * step;
      const reach = m > 2 && k % 2 ? 0.8 : 1;   // alternate rings so crowded fans keep their labels apart
      node.x = CX + OUTER_RX * reach * Math.cos(angle);
      node.y = CY + OUTER_RY * reach * Math.sin(angle);
    });
  });

  nodes.forEach(node => {
    node.connection = Math.max(...node.links.map(link => link.relationship.connection));
    node.name = node.links[0].relationship.name.trim() || 'Unnamed';
    node.picture = node.links.find(link => link.relationship.picture)?.relationship.picture || '';
  });
  return nodes;
}

/** A round picture, or the initial until there is one. */
function createDisc(radius, picture, name) {
  const body = svg('g', { class: 'net-body' });
  body.append(svg('circle', { class: 'net-disc', r: radius }));
  if (picture) {
    const image = svg('image', {
      href: picture, x: -radius, y: -radius, width: radius * 2, height: radius * 2,
      'clip-path': 'url(#netClip)', preserveAspectRatio: 'xMidYMid slice'
    });
    body.append(image);
  } else {
    const initial = svg('text', { class: 'net-initial', 'font-size': radius });
    initial.textContent = initialOf(name);
    body.append(initial);
  }
  body.append(svg('circle', { class: 'net-ring', r: radius }));
  return body;
}

function createNode({ className, x, y, radius, picture, name, label, onOpen }) {
  const node = svg('g', { class: `net-node ${className}`, transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, tabindex: 0, role: 'button' });
  node.setAttribute('aria-label', label);
  const title = svg('title');
  title.textContent = label;
  const text = svg('text', { class: 'net-label', y: radius + 20 });
  text.textContent = shorten(name);
  node.append(title, createDisc(radius, picture, name), text);
  node.addEventListener('click', onOpen);
  node.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onOpen();
  });
  return node;
}

/** Hovering or focusing a node dims everything it isn't connected to. */
function bindFocus(map, node, edges, partners) {
  const on = () => {
    map.classList.add('focusing');
    [node, ...edges, ...partners].forEach(part => part.classList.add('hot'));
  };
  const off = () => {
    map.classList.remove('focusing');
    map.querySelectorAll('.hot').forEach(part => part.classList.remove('hot'));
  };
  node.addEventListener('pointerenter', on);
  node.addEventListener('pointerleave', off);
  node.addEventListener('focus', on);
  node.addEventListener('blur', off);
}

/**
 * `agents`: [{ card, name, portrait, dead, relationships }]; `open(card, relationship)` opens a page.
 */
export function createNetworkMap(agents, open) {
  const nodes = layout(agents);
  const total = agents.reduce((sum, agent) => sum + agent.relationships.length, 0);
  const inNetwork = nodes.filter(node => node.connection >= MAX_CONNECTION).length;
  const shared = nodes.filter(node => node.links.length > 1).length;

  const panel = el('section', 'net-panel');
  panel.setAttribute('aria-label', 'Mappa del Network');
  const head = el('header', 'net-head');
  head.append(
    el('h3', 'net-title', 'Mappa del Network'),
    el('span', 'net-meta', [
      `${total} ${total === 1 ? 'Relazione' : 'Relazioni'}`,
      `🌐 ${inNetwork} nel Network`,
      shared ? `${shared} ${shared === 1 ? 'condivisa' : 'condivise'}` : ''
    ].filter(Boolean).join(' · '))
  );

  const map = svg('svg', { class: 'net-map', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
  const defs = svg('defs');
  const clip = svg('clipPath', { id: 'netClip', clipPathUnits: 'objectBoundingBox' });
  clip.append(svg('circle', { cx: 0.5, cy: 0.5, r: 0.5 }));
  defs.append(clip);
  const edgeLayer = svg('g', { class: 'net-edges' });
  const nodeLayer = svg('g', { class: 'net-nodes' });
  map.append(defs, edgeLayer, nodeLayer);

  const agentNodes = new Map();
  agents.forEach(agent => {
    const node = createNode({
      className: `net-agent${agent.dead ? ' dead' : ''}`, x: agent.x, y: agent.y, radius: 32,
      picture: agent.portrait, name: agent.name, label: `${agent.name}: apri le relazioni`,
      onOpen: () => open(agent.card, null)
    });
    agentNodes.set(agent, { node, edges: [], partners: [] });
  });

  nodes.forEach(item => {
    const network = item.connection >= MAX_CONNECTION;
    const radius = 16 + item.connection * 0.8;
    const owners = item.links.map(link => link.agent.name).join(', ');
    const node = createNode({
      className: `net-rel${network ? ' network' : ''}${item.links.length > 1 ? ' shared' : ''}`,
      x: item.x, y: item.y, radius, picture: item.picture, name: item.name,
      label: `${item.name} (${owners}): ${network ? 'Network' : `legame ${item.connection} / ${MAX_CONNECTION}`}`,
      onOpen: () => open(item.links[0].agent.card, item.links[0].relationship)
    });
    if (network) node.querySelector('.net-body').prepend(svg('circle', { class: 'net-pulse', r: radius }));

    const edges = item.links.map(({ agent, relationship }) => {
      const bond = relationship.connection;
      const edge = svg('line', {
        class: `net-edge${bond >= MAX_CONNECTION ? ' network' : ''}${bond === 0 ? ' zero' : ''}`,
        x1: agent.x.toFixed(1), y1: agent.y.toFixed(1), x2: item.x.toFixed(1), y2: item.y.toFixed(1),
        'stroke-width': (1.5 + bond * 0.55).toFixed(2)
      });
      edge.style.setProperty('--bond', bond / MAX_CONNECTION);
      edgeLayer.append(edge);
      const owner = agentNodes.get(agent);
      owner.edges.push(edge);
      owner.partners.push(node);
      return edge;
    });
    bindFocus(map, node, edges, item.links.map(link => agentNodes.get(link.agent).node));
    nodeLayer.append(node);
  });

  // agents last, so they sit on top of the lines
  agentNodes.forEach(({ node, edges, partners }) => {
    bindFocus(map, node, edges, partners);
    nodeLayer.append(node);
  });

  if (!nodes.length) {
    const empty = svg('text', { class: 'net-empty', x: CX, y: H - 36 });
    empty.textContent = 'Nessuna Relazione. Il Network è vuoto.';
    map.append(empty);
  }

  const legend = el('p', 'net-legend');
  legend.append(
    el('span', 'net-key bond', 'Spessore = Legame'),
    el('span', 'net-key network', 'Nel Network'),
    el('span', 'net-key shared', 'Condivisa')
  );

  panel.append(head, map, legend);
  return panel;
}

// ---------- Phone ----------

function relativeTime(at) {
  const minutes = Math.floor((Date.now() - at) / 60000);
  if (minutes < 1) return 'ora';
  if (minutes < 60) return `${minutes} min fa`;
  return `${Math.floor(minutes / 60)} h fa`;
}

/**
 * The lock screen. `sources()` lists { card, relationship, agent } for every relationship of the
 * branch; `open(card, relationship)` opens one when its notification is clicked.
 */
export function createPhone({ sources, open }) {
  const phone = el('aside', 'rl-phone');
  phone.setAttribute('aria-label', 'Telefono personale');

  const status = el('div', 'phone-status');
  status.append(el('span', 'phone-carrier', 'TRIANGLE ▲'), el('span', 'phone-battery', '5G ▮▮▮▯'));
  const clock = el('div', 'phone-clock');
  const date = el('div', 'phone-date');
  const list = el('ul', 'phone-notes');
  list.setAttribute('aria-live', 'polite');
  const lock = el('div', 'phone-lock', '🔒 Proprietà dell’Agenzia');
  phone.append(status, clock, date, list, lock);

  let lastText = '';

  // A random line of the bond's file (texts/phone-*.txt), or of any tier while that file is empty.
  const message = (agencyOdds = AGENCY_ODDS) => {
    const pool = sources();
    if (!pool.length) {
      const line = pick(TEXTS.strangers);
      if (!line) return null;
      const [sender, ...text] = line.split('|');
      return text.length ? { sender: sender.trim(), text: text.join('|').trim() } : { sender: 'Numero sconosciuto', text: line };
    }
    const source = pick(pool);
    const agent = source.agent;
    if (TEXTS.agency.length && Math.random() < agencyOdds) {
      return { sender: AGENCY_SENDER, text: fill(pick(TEXTS.agency), { agent }), agent, agency: true };
    }
    const { connection } = source.relationship;
    const tier = connection >= MAX_CONNECTION ? 'network' : connection >= 4 ? 'warm' : 'cold';
    const lines = TEXTS[tier].length ? TEXTS[tier] : [...TEXTS.cold, ...TEXTS.warm, ...TEXTS.network];
    if (!lines.length) return null;
    let text = pick(lines);
    if (text === lastText) text = pick(lines);
    return {
      sender: source.relationship.name.trim() || 'Sconosciuto',
      picture: source.relationship.picture,
      text: fill(text, { agent }),
      agent, network: tier === 'network', source
    };
  };

  const push = (at = Date.now(), animate = true, agencyOdds = AGENCY_ODDS) => {
    const data = message(agencyOdds);
    if (!data) return;
    lastText = data.text;
    const note = el('li', `phone-note${data.agency ? ' agency' : ''}${data.network ? ' network' : ''}`);
    note.dataset.at = String(at);
    const avatar = el('span', 'phone-avatar');
    if (data.picture) {
      const img = document.createElement('img');
      img.src = data.picture;
      img.alt = '';
      avatar.append(img);
    } else avatar.textContent = data.agency ? '▲' : initialOf(data.sender);

    const body = el('span', 'phone-body');
    const head = el('span', 'phone-head');
    head.append(el('strong', 'phone-sender', data.sender), el('span', 'phone-time', relativeTime(at)));
    body.append(head, el('span', 'phone-text', data.text));
    if (data.agent) body.append(el('span', 'phone-to', `per ${data.agent}`));
    note.append(avatar, body);

    if (data.source) {
      note.tabIndex = 0;
      note.setAttribute('role', 'button');
      note.title = 'Apri la relazione';
      const go = () => open(data.source.card, data.source.relationship);
      note.addEventListener('click', go);
      note.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        go();
      });
    }

    list.prepend(note);
    if (animate) note.classList.add('arriving');
    while (list.children.length > PHONE_SLOTS) list.lastElementChild.remove();
  };

  const tickClock = () => {
    const now = new Date();
    clock.textContent = now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    date.textContent = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    list.querySelectorAll('.phone-time').forEach(time => {
      time.textContent = relativeTime(Number(time.closest('.phone-note').dataset.at));
    });
  };

  // Messages only arrive while the phone is on screen; the first few are already waiting.
  const schedule = () => setTimeout(() => {
    if (phone.isConnected && document.visibilityState === 'visible') push();
    schedule();
  }, PHONE_EVERY * (1 + Math.random() / 2));

  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    tickClock();
    setInterval(tickClock, 10000);
    textsReady.then(() => {
      const now = Date.now();
      [180, 95, 27, 4].forEach(minutes => push(now - minutes * 60000, false, 0));
      schedule();
    });
  };

  return { el: phone, start };
}

// ---------- HR ticker ----------

/**
 * The scrolling strip of HR memos (texts/hr-memos.txt, in a random order each load);
 * `update(stats)` fills in {network}, {relationships} and {agents}.
 */
export function createTicker() {
  const ticker = el('section', 'hr-ticker');
  ticker.setAttribute('aria-label', 'Comunicazioni delle Risorse Umane');
  const label = el('span', 'hr-ticker-label', 'Comunicazione RU');
  const viewport = el('div', 'hr-ticker-window');
  const track = el('div', 'hr-ticker-track');
  viewport.append(track);
  ticker.append(label, viewport);

  let order = null;   // shuffled once the file has loaded
  let current = '';
  let stats = {};
  const show = () => {
    if (!order) return;
    const memos = order.map(memo => fill(memo, stats));
    ticker.hidden = !memos.length;
    const text = memos.join('\n');
    if (text === current) return;
    current = text;
    // two identical halves: scrolling by -50% loops without a seam
    const group = () => {
      const part = el('div', 'hr-ticker-group');
      part.append(...memos.map(text => el('span', 'hr-memo', text)));
      return part;
    };
    const second = group();
    second.setAttribute('aria-hidden', 'true');
    track.replaceChildren(group(), second);
    track.style.setProperty('--duration', `${Math.max(20, Math.round(memos.join(' ').length * 0.09))}s`);
  };

  const update = next => {
    stats = { network: 0, relationships: 0, agents: 0, ...next };
    show();
  };

  textsReady.then(() => {
    order = [...TEXTS.memos];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    show();
  });

  return { el: ticker, update };
}
