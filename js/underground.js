// underground.js - the bottom of the Anomaly tab, purely cosmetic: where the Agency's banner gets
// answered. A pirate signal breaking into the Agency's channel, whose break-ins follow the
// breach (how far the team's Tracciati Anomalia are filled, on average, 0 to 1), and the
// Agency's posters, now and then tagged in blue and expunged.
import { PROMO_DIR } from './agencyData.js';
import { TRACK_LENGTH } from './lifeWorkTrack.js';
import { AGENCY_LINES, PIRATE_LINES, SIGNAL_RESTORED } from './undergroundData.js';
import { motionAllowed } from './motion.js';

const POSTERS_FILE = './texts/anomaly-posters.txt';
const POSTER_TIME = 4000;     // each poster stays up this long as the Agency printed it
const CORRUPT_CHANCE = 0.3;   // then it may get tagged...
const TAGGED_TIME = 3000;     // ...and stays tagged this long before it is expunged
let breach = 0;
let broadcast = null;   // both kept across renders, so their timers and current state carry on
let posterFeed = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pick = list => list[Math.floor(Math.random() * list.length)];

/** Runs `fn` after `ms`, or keeps waiting while `root` is off screen or `held()` is true. */
function scheduler(root, held = () => false) {
  let timer = null;
  const visible = () => root.isConnected && !document.hidden && !root.closest('[hidden]');
  const later = (fn, ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => (visible() && !held() ? fn() : later(fn, 500)), ms);
  };
  return later;
}

// ---------- pirate broadcast ----------
/**
 * The Agency's channel, with a line every few seconds. Between lines the pirate signal may
 * break in (more likely as the breach widens): static, a message typed out, then the Agency
 * takes the channel back. Nothing advances while the tab is hidden.
 */
function createBroadcast() {
  const root = el('section', 'pirate');
  root.setAttribute('aria-label', 'Canale interno dell’Agenzia');

  const agency = el('div', 'pirate-agency');
  const agencyLine = el('p', 'pirate-agency-line');
  agency.append(el('span', 'pirate-agency-head', '▲ Triangle Agency · Canale interno'), agencyLine);

  const hijack = el('div', 'pirate-hijack');
  const hijackLine = el('p', 'pirate-hijack-line');
  const hijackHead = el('span', 'pirate-hijack-head');
  hijackHead.append(el('span', 'pirate-dot', '◉'), ' Segnale sconosciuto');
  hijack.append(hijackHead, hijackLine);

  const strength = el('strong', '');
  const meter = el('div', 'pirate-meter');
  meter.append(el('span', '', 'Segnale Agenzia'), el('span', 'pirate-meter-bar'), strength);

  root.append(agency, hijack, el('div', 'pirate-noise'), meter);

  const later = scheduler(root);
  let typing = null;
  let agencyIndex = 0;
  const pirateOrder = [...PIRATE_LINES].sort(() => Math.random() - 0.5);
  let pirateIndex = 0;

  const setState = state => {
    root.dataset.state = state;
    agency.setAttribute('aria-hidden', String(state === 'jammed'));
    hijack.setAttribute('aria-hidden', String(state !== 'jammed'));
  };

  function type(text) {
    clearInterval(typing);
    if (!motionAllowed()) { hijackLine.textContent = text; return; }
    let shown = 0;
    hijackLine.textContent = '';
    typing = setInterval(() => {
      hijackLine.textContent = text.slice(0, ++shown);
      if (shown >= text.length) clearInterval(typing);
    }, 45);
  }

  function calm() {
    setState('calm');
    agencyLine.textContent = AGENCY_LINES[agencyIndex++ % AGENCY_LINES.length];
    later(tick, 7000);
  }
  function tick() {
    if (Math.random() < 0.2 + breach * 0.7) interrupt();
    else calm();
  }
  function interrupt() {
    setState('glitch');
    // the break-in carries on even if the tab is left mid-way
    setTimeout(() => {
      setState('jammed');
      type(pirateOrder[pirateIndex++ % pirateOrder.length]);
      later(restore, 6500);
    }, motionAllowed() ? 500 : 0);
  }
  function restore() {
    setState('restored');
    agencyLine.textContent = pick(SIGNAL_RESTORED);
    later(calm, 2800);
  }

  calm();
  return {
    root,
    update() {
      root.style.setProperty('--breach', breach.toFixed(3));
      strength.textContent = `${Math.round((1 - breach) * 100)}%`;
    }
  };
}

// ---------- the poster carousel ----------
/** "Icon | Title | Slogan | picture >> New title | New slogan" lines of texts/anomaly-posters.txt. */
function parsePosters(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const [agency, tagged = ''] = line.split('>>');
    const [icon = '', title = '', slogan = '', image = ''] = agency.split('|').map(part => part.trim());
    const [newTitle = '', newSlogan = ''] = tagged.split('|').map(part => part.trim());
    return { icon, title, slogan, image, newTitle, newSlogan };
  }).filter(poster => poster.title);
}

function scrawl() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'defaced-scrawl');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M51 7 L93 85 Q50 90 8 87 L49 10 M46 14 L54 6');
  path.setAttribute('pathLength', '1');   // so the CSS can draw it on with a 0-1 dash
  svg.append(path);
  return svg;
}

/** A poster as the Agency printed it, with its graffiti and the Agency's stamp ready to show. */
function createPoster(poster) {
  const figure = el('figure', 'defaced');
  figure.setAttribute('aria-label', poster.title);
  const art = el('div', 'defaced-art');
  art.append(el('span', 'defaced-icon', poster.icon));
  if (poster.image) {
    const image = el('img', 'defaced-image');
    image.alt = '';
    image.addEventListener('error', () => image.remove());
    image.src = PROMO_DIR + poster.image;
    art.append(image);
  }
  art.append(scrawl(), el('span', 'defaced-stamp', 'Expunged'));
  const copy = el('figcaption', 'defaced-copy');
  copy.append(el('span', 'defaced-title', poster.title), el('span', 'defaced-tagline', poster.slogan), el('span', 'defaced-brand', '▲ Triangle Agency'));
  // the marker is sprayed over the printed text, so a tagged poster keeps its size
  const graffiti = el('span', 'defaced-graffiti');
  graffiti.append(el('span', 'defaced-rewrite', poster.newTitle), el('span', 'defaced-tag', poster.newSlogan));
  figure.append(el('span', 'defaced-tape'), art, copy, graffiti, el('span', 'defaced-flash'));
  return figure;
}

/**
 * One poster at a time, picked at random. Each stays up as the Agency printed it; some get
 * tagged (static, then the blue marker) and a few seconds later expunged (a red flash and
 * the Agency's stamp). Then the next one crossfades in over it. Hovering holds the current phase.
 */
function createPosterFeed() {
  const root = el('section', 'poster-feed');
  root.setAttribute('aria-label', 'Bacheca dell’Agenzia');
  let hovered = false;
  root.addEventListener('pointerenter', () => { hovered = true; });
  root.addEventListener('pointerleave', () => { hovered = false; });
  const later = scheduler(root, () => hovered);

  let posters = [];
  let current = -1;
  let figure = null;
  const setPhase = phase => { figure.dataset.phase = phase; };

  /** A random poster, never the one just shown, fading in while the last one fades out. */
  function next() {
    const step = posters.length > 1 ? 1 + Math.floor(Math.random() * (posters.length - 1)) : 0;
    current = (current + step) % posters.length;
    const previous = figure;
    if (previous) {
      previous.classList.toggle('expunged', previous.dataset.phase === 'expunging');   // the stamp stays on the way out
      previous.dataset.phase = 'leaving';
      setTimeout(() => previous.remove(), 1000);
    }
    figure = createPoster(posters[current]);
    setPhase('clean');
    root.append(figure);
    later(() => (posters[current].newTitle && Math.random() < CORRUPT_CHANCE ? corrupt() : next()), POSTER_TIME);
  }
  function corrupt() {
    setPhase('corrupting');
    figure.setAttribute('aria-label', `${posters[current].title}, corretto in: ${posters[current].newTitle}`);
    later(() => {
      setPhase('corrupted');
      later(expunge, TAGGED_TIME);
    }, motionAllowed() ? 900 : 0);
  }
  function expunge() {
    setPhase('expunging');
    figure.setAttribute('aria-label', `${posters[current].title}: expunged`);
    later(next, 2200);
  }

  fetch(POSTERS_FILE, { cache: 'no-cache' })
    .then(response => (response.ok ? response.text() : Promise.reject(new Error(response.status))))
    .then(text => {
      posters = parsePosters(text);
      if (!posters.length) return;
      current = Math.floor(Math.random() * posters.length) - 1;
      root.classList.add('ready');
      next();
    })
    .catch(error => console.warn(`Could not read ${POSTERS_FILE}`, error));

  return { root };
}

/**
 * The whole bottom section for the overview. `agents` is one { progress } per agent card.
 */
export function createUnderground(agents) {
  breach = agents.length ? agents.reduce((sum, agent) => sum + agent.progress, 0) / (agents.length * TRACK_LENGTH) : 0;
  broadcast ||= createBroadcast();
  posterFeed ||= createPosterFeed();
  broadcast.update();

  const section = el('section', 'underground');
  section.setAttribute('aria-label', 'Frequenze non autorizzate');
  section.append(broadcast.root, posterFeed.root);
  return section;
}
