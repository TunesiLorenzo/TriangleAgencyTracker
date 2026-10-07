// graIncidents.js
// Random incidents while the G.R.A. takeover holds the display: traffic driving across
// the screen (with its pass-by sound), Autoverrox navigation pop-ups, and breakdowns that
// make the tracker look like it is failing for several seconds at a time. Everything is
// drawn in the takeover's overlay or as a passing effect on the page (graIncidents.css);
// no tracker data or control is touched.
//
// One strength (0..1) drives them: a base set on /settings plus a share that grows with
// the Chaos counter. It scales how often each kind happens (the per-minute rates are for
// full strength) and how heavy and long the breakdowns are. Reduced motion turns it all off.
//
// The takeover's "chaos effects" setting decides whether a taken-over display shows chaos
// through these incidents, through the tracker's usual atmosphere (effects.js), or both.

import { getConfig, getSoundFiles, onConfigChange } from './config.js';
import { chaosIntensity, setChaosEffectsMuted } from './effects.js';
import { motionAllowed } from './motion.js';
import { isMuted } from './soundEffects.js';
import { getAudioContext } from './synth.js';

const pick = list => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => min + Math.random() * (max - min);
const whole = (min, max) => Math.floor(between(min, max + 1));
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (from, to, share) => from + (to - from) * share;

/* ---------- content ---------- */
// Side views heading right. `width` is the size in the middle lane in px, `beam` the reach
// of the headlights in vehicle lengths, `cross` the seconds a far and a near one take to
// cross the screen at 100% traffic speed (about the pace of the recordings, so that they
// play near their own pitch), and `sound` picks the pass-by recording (see "traffic sound").
const VEHICLES = [
  { // saloon
    sound: 'car', width: 300, beam: 1.5, cross: [3, 1.75],
    svg: `<svg viewBox="0 0 240 76" aria-hidden="true">
      <path class="gra-car-shell" d="M8 58V46q2-8 16-10l38-4q22-20 50-21h38q22 1 40 21l32 6q11 3 11 12v8z"/>
      <path class="gra-car-glass" d="M70 32q18-15 42-16h12v16zM130 16h20q16 2 30 16h-50z"/>
      <circle class="gra-car-wheel" cx="58" cy="58" r="14"/><circle class="gra-car-hub" cx="58" cy="58" r="5"/>
      <circle class="gra-car-wheel" cx="184" cy="58" r="14"/><circle class="gra-car-hub" cx="184" cy="58" r="5"/>
      <rect class="gra-car-head" x="226" y="42" width="8" height="6" rx="2"/>
      <rect class="gra-car-tail" x="6" y="42" width="6" height="7" rx="2"/>
    </svg>`
  },
  { // city car
    sound: 'car', width: 230, beam: 1.5, cross: [3, 1.75],
    svg: `<svg viewBox="0 0 190 76" aria-hidden="true">
      <path class="gra-car-shell" d="M8 58V40q2-10 14-14l26-12q12-4 30-4h34q16 1 28 14l14 12 18 4q10 3 10 12v6z"/>
      <path class="gra-car-glass" d="M40 32l14-14q8-3 24-3h6v17zM90 15h22q12 1 22 12l5 5H90z"/>
      <circle class="gra-car-wheel" cx="46" cy="58" r="13"/><circle class="gra-car-hub" cx="46" cy="58" r="5"/>
      <circle class="gra-car-wheel" cx="146" cy="58" r="13"/><circle class="gra-car-hub" cx="146" cy="58" r="5"/>
      <rect class="gra-car-head" x="176" y="44" width="7" height="6" rx="2"/>
      <rect class="gra-car-tail" x="6" y="40" width="6" height="7" rx="2"/>
    </svg>`
  },
  { // lorry
    sound: 'truck', width: 440, beam: 0.7, cross: [5.2, 3.4],
    svg: `<svg viewBox="0 0 320 106" aria-hidden="true">
      <path class="gra-car-shell" d="M6 88V14q0-6 6-6h196q6 0 6 6v74z"/>
      <path class="gra-car-shell" d="M218 88V34q0-6 6-6h38q10 1 18 14l20 18q10 3 10 12v16z"/>
      <path class="gra-car-glass" d="M232 36h28q8 1 14 12l8 10h-50z"/>
      <path class="gra-car-glass" d="M20 22h180M20 40h180M20 58h180" fill="none"/>
      <circle class="gra-car-wheel" cx="50" cy="88" r="15"/><circle class="gra-car-hub" cx="50" cy="88" r="5"/>
      <circle class="gra-car-wheel" cx="86" cy="88" r="15"/><circle class="gra-car-hub" cx="86" cy="88" r="5"/>
      <circle class="gra-car-wheel" cx="266" cy="88" r="15"/><circle class="gra-car-hub" cx="266" cy="88" r="5"/>
      <rect class="gra-car-head" x="304" y="68" width="7" height="7" rx="2"/>
      <rect class="gra-car-tail" x="4" y="70" width="5" height="9" rx="2"/>
    </svg>`
  }
];
const PAINTS = ['#03130a', '#03130a', '#0b1c33', '#2a0c0c', '#1c1c1c', '#3a2f05'];
const TAIL_TRAIL = 1.3;         // reach of the tail-light trail in vehicle lengths (graIncidents.css)
const MAX_VEHICLES = 5;

// { label, title, note, tone }; "{agent}" becomes the name of a random agent on the branch.
const POPUPS = [
  { label: 'Ricalcolo percorso', title: 'Torna indietro. Sempre.', note: 'Nuovo arrivo previsto: mai' },
  { label: 'Tra 300 metri', title: 'Svolta dove non c’è strada', note: 'Fidati del navigatore' },
  { label: 'Traffico rilevato', title: 'Rimozione conducenti in corso', note: 'Soluzione ottimale calcolata', tone: 'alert' },
  { label: 'Limite di velocità', title: 'Nessuno', note: 'Accelera' },
  { label: 'Pedaggio dovuto', title: 'Un agente', note: 'Pagamento alla prossima uscita', tone: 'alert' },
  { label: 'Prossima uscita', title: 'Non esiste', note: 'Resta sul raccordo' },
  { label: 'Aggiornamento mappe', title: 'La realtà non coincide', note: 'Correzione della realtà in corso' },
  { label: 'Arrivo previsto', title: 'Ieri', note: 'Sei in ritardo' },
  { label: 'Conducente distratto', title: 'Guarda la strada', note: 'La strada ti guarda', tone: 'alert' },
  { label: 'Coda a tratti', title: 'Per i prossimi ∞ km', note: 'Percorsi alternativi: nessuno' },
  { label: 'Area di servizio', title: 'Chiusa per sempre', note: 'Prosegui' },
  { label: 'Veicolo non autorizzato', title: 'Triangle Agency', note: 'Rimozione forzata disposta', tone: 'danger' },
  { label: 'Corsia assegnata', title: 'Quella che non c’è', note: 'Mantieni la destra' },
  { label: 'Segnale GPS', title: 'Ti abbiamo trovato', note: 'Posizione condivisa con tutti i veicoli', tone: 'alert' },
  { label: 'Destinazione raggiunta', title: 'Era qui dall’inizio', note: 'Non scendere' },
  { label: 'Inversione a U', title: 'Vietata nello spazio e nel tempo', note: 'Sanzione: immediata', tone: 'danger' },
  { label: 'Conducente problematico', title: '{agent}', note: 'Intervento in arrivo sulla tua corsia', tone: 'danger' },
  { label: 'Passeggero rilevato', title: '{agent}', note: 'Allacciare le cinture. Non si scende.' }
];

const FAULT_TAGS = ['Modulo non risponde', 'Segnale perso', 'Corsia chiusa', 'Fuori servizio', 'Dati deviati', 'Errore 0xA90'];
const ERRORS = [
  { title: 'TRIANGLE_AGENCY.EXE non risponde', text: 'Autoverrox sta chiudendo il programma. E la filiale.' },
  { title: 'REALTÀ.DLL non trovata', text: 'Il percorso specificato non esiste più. Continuare senza realtà?' },
  { title: 'Memoria insufficiente', text: 'Troppi agenti caricati. Liberare spazio rimuovendone uno.' },
  { title: 'Accesso negato', text: 'Questa interfaccia appartiene ad Autoverrox. Lo è sempre stata.' },
  { title: 'Eccezione non gestita', text: 'Il traffico ha raggiunto un’istruzione non valida. Tu.' }
];
const BLOCKS = ['invert', 'invert', 'shift', 'shift', 'smear', 'solid', 'void', 'stripes'];
// Tracker panels a fault can pick, on whichever tab is open.
const PANELS = '.char:not(.leaving), .graph-box, .world, #taskPanel, .rel-summary, .anomaly-summary, .agency-summary';
const WARNING_TRIANGLE = `<svg viewBox="0 0 120 106" aria-hidden="true">
  <path d="M60 6 114 100H6z" fill="#fff" stroke="#ff3c35" stroke-width="12" stroke-linejoin="round"/>
  <path d="M60 40v30M60 82v2" stroke="#111" stroke-width="9" stroke-linecap="round"/></svg>`;

/* ---------- stage ---------- */
const KINDS = ['car', 'popup', 'glitch'];
const TICK_MS = 500;
let layer = null;               // .gra-incidents in the takeover overlay
let tearNoise = null;           // the SVG filter primitives behind the page tear
let tearBands = null;
let tearShift = null;
let takeover = false;           // the G.R.A. skin is on this display
let mode = 'both';              // config.effects.graTakeover.chaosEffects: 'both', 'gra' or 'default'
let running = false;
let settings = null;            // config.effects.graIncidents
let ticker = 0;
let glitchBusyUntil = 0;        // one breakdown at a time
const progress = {};            // per kind: how far along to the next one (fires at `due`)
const due = {};
const waiting = new Set();      // timeouts inside an incident
const live = new Set();         // clean-ups of whatever is on screen or playing
let popupBag = [];

function later(ms, run) {
  const id = window.setTimeout(() => { waiting.delete(id); run(); }, ms);
  waiting.add(id);
}

/** Register a clean-up; calling the returned function runs it once (stop() runs them all). */
function hold(cleanup) {
  const release = () => { if (live.delete(release)) cleanup(); };
  live.add(release);
  return release;
}

/** Put an element in the incidents layer; the returned function takes it out again. */
function stage(element) {
  layer.appendChild(element);
  return hold(() => element.remove());
}

function build() {
  const overlay = document.getElementById('graTakeoverOverlay');
  if (!overlay) return false;
  layer = document.createElement('div');
  layer.className = 'gra-incidents';
  overlay.appendChild(layer);

  // Rows of noise, cut into a few hard steps, push slices of the page sideways.
  overlay.insertAdjacentHTML('beforeend', `<svg class="gra-tear-defs" aria-hidden="true">
    <filter id="graTearFilter" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.0001 0.03" numOctaves="1" seed="1"/>
      <feComponentTransfer result="bands"><feFuncR type="discrete" tableValues="0.5"/><feFuncG type="discrete" tableValues="0.5"/></feComponentTransfer>
      <feDisplacementMap in="SourceGraphic" in2="bands" scale="0" xChannelSelector="R" yChannelSelector="G"/>
    </filter></svg>`);
  tearNoise = overlay.querySelector('#graTearFilter feTurbulence');
  tearBands = overlay.querySelector('#graTearFilter feFuncR');
  tearShift = overlay.querySelector('#graTearFilter feDisplacementMap');
  return true;
}

/** The base strength plus the share the Chaos counter adds, 0..1. */
function currentStrength() {
  if (!settings) return 0;
  return clamp(Number(settings.baseStrength) + Number(settings.chaosStrength) * chaosIntensity(), 0, 1) || 0;
}

/* ---------- traffic sound ----------
   Pass-by recordings live in audio/GRA: a file with "truck" in its name plays for lorries
   and one with "car" for everything else (several of a kind: one at random). Each is read
   once to find where the vehicle is loudest and how long it took to come up, which gives
   the time it would naturally take to cross the screen. A vehicle on screen plays it
   faster or slower than that, pitch included, so that the recording passes at the speed
   of the animation and peaks as the vehicle crosses the middle. */
const PASS_FOLDER = 'gra/';
const passBys = new Map();      // file -> { buffer, peakAt, natural }, or null while loading or unusable

/** Loudest stretch of a recording and the crossing time it suggests, in seconds. */
function measurePass(buffer) {
  const size = Math.floor(buffer.sampleRate * 0.05);
  const levels = [];
  for (let start = 0; start + size <= buffer.length; start += size) {
    let sum = 0;
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = start; i < start + size; i++) sum += data[i] * data[i];
    }
    levels.push(Math.sqrt(sum / size));
  }
  const top = Math.max(...levels, 1e-6);
  let from = levels.indexOf(top);
  let to = from;
  while (from > 0 && levels[from - 1] >= top * 0.5) from--;
  while (to < levels.length - 1 && levels[to + 1] >= top * 0.5) to++;
  let onset = from;                                   // back to where it first became audible
  while (onset > 0 && levels[onset - 1] >= top * 0.15) onset--;
  const peakAt = (from + to + 1) / 2 * 0.05;
  const approach = Math.max(0.4, peakAt - onset * 0.05);
  return { peakAt, natural: approach * 2 };
}

function loadPassBy(file) {
  if (passBys.has(file)) return;
  passBys.set(file, null);
  (async () => {
    const response = await fetch(`audio/${file.split('/').map(encodeURIComponent).join('/')}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // An offline context decodes without waiting for the first click the page needs for sound.
    const buffer = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await response.arrayBuffer());
    passBys.set(file, { buffer, ...measurePass(buffer) });
  })().catch(error => console.warn('Traffic sound could not be read:', file, error));
}

/** The recordings for 'car' or 'truck' that are ready to play; starts reading the others. */
function passBysFor(kind) {
  const files = getSoundFiles().filter(file => file.toLowerCase().startsWith(PASS_FOLDER)
    && file.toLowerCase().slice(PASS_FOLDER.length).includes(kind));
  files.forEach(loadPassBy);
  return files.map(file => passBys.get(file)).filter(Boolean);
}

/**
 * Play a recording for one pass. Times are seconds from now: `peakIn` when the vehicle is
 * mid-screen, `panFrom`/`panTo` while it crosses from one edge to the other, `goneIn` when
 * it has left. `direction` is 1 heading right, -1 heading left.
 */
function playPassBy(sound, { rate, peakIn, panFrom, panTo, goneIn, direction, level }) {
  const volume = clamp(Number(settings.trafficVolume) * Number(getConfig().sounds.masterVolume) * level, 0, 1);
  if (isMuted() || !(volume > 0)) return;
  try {
    const ac = getAudioContext();
    const now = ac.currentTime;
    const source = ac.createBufferSource();
    source.buffer = sound.buffer;
    source.playbackRate.value = rate;

    // The recording's own left-to-right movement is folded to mono; the animation steers it.
    const mono = ac.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    const pan = ac.createStereoPanner();
    pan.pan.setValueAtTime(-0.85 * direction, now);
    pan.pan.setValueAtTime(-0.85 * direction, now + Math.max(0, panFrom));
    pan.pan.linearRampToValueAtTime(0.85 * direction, now + Math.max(0.05, panTo));
    const gain = ac.createGain();
    const startAt = now + Math.max(0, peakIn - sound.peakAt / rate);
    const end = now + goneIn + 2.6;                    // driven off: fade out rather than rumble on
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(volume, startAt + 0.08);
    gain.gain.setValueAtTime(volume, Math.max(startAt + 0.08, end - 2.4));
    gain.gain.linearRampToValueAtTime(0, end);

    source.connect(mono).connect(pan).connect(gain).connect(ac.destination);
    source.start(startAt);
    source.stop(end + 0.05);
    const silence = hold(() => {
      try { source.stop(); } catch { /* already over */ }
      gain.disconnect();
    });
    source.onended = silence;
  } catch (error) {
    console.warn('Traffic sound could not play', error);
  }
}

/* ---------- traffic ---------- */
/** The speed set on /settings, as a multiple of the vehicles' own pace. */
function trafficSpeed() {
  return clamp(Number(settings.trafficSpeed) || 1, 0.25, 4);
}

/** One vehicle across the screen. Lanes lower on the screen are nearer: bigger and faster. */
function drive(lane, rightward) {
  if (layer.querySelectorAll('.gra-car').length >= MAX_VEHICLES) return;
  const model = pick(VEHICLES);
  const width = model.width * (0.7 + lane * 0.95);
  const car = document.createElement('div');
  car.className = `gra-car${rightward ? '' : ' gra-car-leftward'}`;
  car.style.width = `${width}px`;
  car.style.top = `${10 + lane * 60}%`;
  car.style.setProperty('--gra-car-paint', pick(PAINTS));
  car.style.setProperty('--gra-car-beam', model.beam);
  car.innerHTML = `<div class="gra-car-body"><i class="gra-car-beam"></i><i class="gra-car-trail"></i>${model.svg}</div>`;
  const remove = stage(car);

  // Positions of the vehicle's leading-side box edge (translateX), heading right; the way
  // back is the mirror image. It starts with the tip of its headlights at the edge of the
  // screen and ends when the tail-light trail has left.
  const screen = window.innerWidth;
  const crossing = mix(model.cross[0], model.cross[1], lane) * between(0.9, 1.1) / trafficSpeed();   // s per screen width
  const speed = screen / crossing;                                                   // px per second
  const start = -width * (1 + model.beam);
  const finish = screen + width * TAIL_TRAIL;
  const at = position => (position - start) / speed;       // seconds until the box is at `position`
  const mirror = position => screen - width - position;
  const path = [start, finish].map(position => `translateX(${rightward ? position : mirror(position)}px)`);

  const sound = pick(passBysFor(model.sound));
  let wait = 0;                                             // the sound may need a head start
  if (sound) {
    const rate = clamp(sound.natural / crossing, 0.5, 1.6);
    const middle = at((screen - width) / 2);
    wait = Math.max(0, sound.peakAt / rate - middle);
    playPassBy(sound, {
      rate,
      peakIn: wait + middle,
      panFrom: wait + at(-width / 2),
      panTo: wait + at(screen - width / 2),
      goneIn: wait + at(screen),
      direction: rightward ? 1 : -1,
      level: 0.55 + lane * 0.45
    });
  }
  car.animate({ transform: path }, { duration: at(finish) * 1000, delay: wait * 1000, easing: 'linear', fill: 'both' }).onfinish = remove;
}

function traffic() {
  const lane = Math.random();
  const rightward = Math.random() < 0.5;
  // Now and then a short queue on the same lane.
  const queue = Math.random() < 0.3 ? whole(2, 3) : 1;
  for (let i = 0; i < queue; i++) later(i * between(900, 1650) / trafficSpeed(), () => drive(lane, rightward));
}

/* ---------- pop-ups ---------- */
function agentName() {
  const names = [...document.querySelectorAll('.char:not(.leaving) [data-stat="name"]')].map(input => input.value.trim()).filter(Boolean);
  return names.length ? pick(names) : '';
}

/** The next pop-up text: every message once, in random order, before any repeats. */
function nextPopup() {
  for (let tries = 0; tries < POPUPS.length; tries++) {
    if (!popupBag.length) popupBag = [...POPUPS].sort(() => Math.random() - 0.5);
    const message = popupBag.pop();
    if (!message.title.includes('{agent}')) return message;
    const name = agentName();
    if (name) return { ...message, title: message.title.replace('{agent}', name) };
  }
  return POPUPS[0];
}

/** A place for a pop-up of this size that covers no other pop-up, nor the fixed navigation card. */
function freeSpot(width, height) {
  const taken = [...document.querySelectorAll('#graTakeoverOverlay .gra-navigation-card')]
    .map(card => card.getBoundingClientRect())
    .filter(rect => rect.width && (rect.left || rect.top));
  let spot;
  for (let tries = 0; tries < 12; tries++) {
    spot = {
      x: between(16, Math.max(16, window.innerWidth - width - 16)),
      y: between(70, Math.max(70, window.innerHeight - height - 90))
    };
    const clear = !taken.some(rect => spot.x < rect.right + 12 && spot.x + width > rect.left - 12
      && spot.y < rect.bottom + 12 && spot.y + height > rect.top - 12);
    if (clear) break;
  }
  return spot;
}

function popup() {
  if (layer.querySelectorAll('.gra-popup').length >= 3) return;
  const message = nextPopup();
  const card = document.createElement('div');
  card.className = `gra-navigation-card gra-popup${message.tone ? ` gra-popup-${message.tone}` : ''}`;
  card.innerHTML = `<div class="gra-nav-brand"><span class="gra-boar-mark">AV</span> AUTOVERROX</div>
    <span class="gra-nav-label"></span><strong></strong>
    <div class="gra-nav-progress"><span></span></div><small></small>`;
  // Agent names are typed by the players: set as text, never as markup.
  card.querySelector('.gra-nav-label').textContent = message.label;
  card.querySelector('strong').textContent = message.title;
  card.querySelector('small').textContent = message.note;
  const remove = stage(card);

  const spot = freeSpot(card.offsetWidth, card.offsetHeight);
  card.style.left = `${spot.x}px`;
  card.style.top = `${spot.y}px`;
  const fromLeft = spot.x + card.offsetWidth / 2 < window.innerWidth / 2;
  const life = between(4500, 7500);
  card.animate([
    { opacity: 0, transform: `translateX(${fromLeft ? -40 : 40}px)`, filter: 'blur(4px)' },
    { opacity: 1, transform: 'none', filter: 'none' }
  ], { duration: 280, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
  card.querySelector('.gra-nav-progress span').animate({ width: ['0%', '100%'] }, { duration: life, easing: 'linear', fill: 'both' });
  later(life, () => {
    card.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(6px)', filter: 'blur(3px)' }],
      { duration: 220, fill: 'forwards' }).onfinish = remove;
  });
}

function popups() {
  // Sometimes a small burst.
  const burst = Math.random() < 0.15 ? whole(2, 3) : 1;
  for (let i = 0; i < burst; i++) later(i * between(160, 420), popup);
}

/* ---------- breakdowns ----------
   Each takes the strength (0..1) and how long it lasts in ms. They are slow on purpose:
   states are held long enough to be read, and only one runs at a time. */

/** Frames that hold each value and jump to the next (a single easing would glide instead). */
const jumps = frames => frames.map(frame => ({ ...frame, easing: 'steps(1)' }));

/**
 * Slices of the page hang sideways with colour fringes, swaying slowly like bad tracking
 * and re-cutting every second or so; a strong tear also knocks the whole page about.
 */
function tear(strength, life) {
  const frame = document.getElementById('pageFrame');
  if (!frame || frame.classList.contains('gra-tearing')) return;
  const reach = mix(40, 190, strength);                 // px between the furthest-thrown slices
  const sway = between(1.2, 2.4);                       // radians per second
  const started = performance.now();
  let nextCut = 0;

  const recut = () => {
    // Most rows stay put (0.5); a few buckets of the noise are thrown left or right.
    const table = Array.from({ length: 11 }, (_, i) => (i >= 3 && i <= 7 && i !== 5 && Math.random() < 0.65 ? between(0, 1) : 0.5));
    tearBands.setAttribute('tableValues', table.map(value => value.toFixed(2)).join(' '));
    tearNoise.setAttribute('seed', whole(1, 999));
    tearNoise.setAttribute('baseFrequency', `0.0001 ${between(0.006, 0.04).toFixed(4)}`);
    if (strength > 0.45 && Math.random() < 0.6) {
      const shove = () => `${between(-28, 28).toFixed(0)}px ${between(-12, 12).toFixed(0)}px`;
      frame.animate(jumps([{ translate: shove() }, { translate: shove() }, { translate: '0 0' }]), { duration: 320 });
    }
  };
  const end = hold(() => {
    frame.classList.remove('gra-tearing');
    frame.style.removeProperty('--gra-tear-split');
    tearShift.setAttribute('scale', 0);
  });
  const step = () => {
    const elapsed = performance.now() - started;
    if (elapsed >= life) {
      end();
      return;
    }
    if (elapsed >= nextCut) {
      recut();
      nextCut = elapsed + between(500, 1600);
    }
    // In over 0.4s, out over 0.7s; in between the slices slide slowly back and forth.
    const envelope = clamp(Math.min(elapsed / 400, (life - elapsed) / 700), 0, 1);
    tearShift.setAttribute('scale', (reach * envelope * (0.6 + 0.4 * Math.sin(elapsed / 1000 * sway))).toFixed(1));
    later(90, step);
  };
  frame.style.setProperty('--gra-tear-split', `${mix(2, 8, strength).toFixed(1)}px`);
  frame.classList.add('gra-tearing');
  step();
}

/** Blocks and strips of the screen invert, smear or go dead, spreading and clearing over the seconds. */
function corrupt(strength, life) {
  for (let i = Math.round(mix(5, 22, strength)); i > 0; i--) {
    const block = document.createElement('i');
    block.className = `gra-block gra-block-${pick(BLOCKS)}`;
    const strip = Math.random() < 0.65;
    Object.assign(block.style, {
      left: `${between(-5, 85)}%`,
      top: `${between(0, 95)}%`,
      width: `${strip ? between(12, 55) : between(3, 12)}%`,
      height: `${strip ? between(1, 7) : between(6, 22)}%`
    });
    const remove = stage(block);
    // Each block arrives in its own time and holds every state for a good part of a second.
    const start = between(0, 0.55) * life;
    const span = between(1400, Math.max(1500, life - start));
    const states = Array.from({ length: Math.max(2, Math.round(span / between(450, 1100))) }, (_, index) => ({
      visibility: index === 0 || Math.random() < 0.8 ? 'visible' : 'hidden',
      transform: `translateX(${between(-45, 45).toFixed(0)}px)`
    }));
    block.animate(jumps([...states, { visibility: 'hidden' }]), { delay: start, duration: span, fill: 'forwards' });
    later(start + span, remove);
  }
}

/** Panels of the tracker flicker out, stay dead, may sag off their mounting, and get a fault label. */
function panelFault(strength, life) {
  const candidates = [...document.querySelectorAll(PANELS)].filter(candidate => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 60 && rect.bottom > 40 && rect.top < window.innerHeight - 40;
  }).sort(() => Math.random() - 0.5);
  const dead = 'grayscale(1) brightness(.5) contrast(1.5)';
  const at = ms => clamp(ms / life, 0, 1);              // keyframe offsets from real times

  candidates.slice(0, 1 + Math.floor(strength * between(0, 2.4))).forEach(panel => {
    const effects = [panel.animate(jumps([
      { opacity: 1, filter: 'none' }, { opacity: 0.15, filter: 'none', offset: at(90) },
      { opacity: 1, filter: 'invert(1) hue-rotate(180deg)', offset: at(190) }, { opacity: 0.4, filter: dead, offset: at(320) },
      { opacity: 1, filter: dead, offset: at(460) }, { opacity: 0.3, filter: dead, offset: at(640) },
      { opacity: 1, filter: dead, offset: at(790) },
      // dead for the duration, with one stutter part-way through
      { opacity: 0.25, filter: dead, offset: at(life * 0.5) }, { opacity: 1, filter: dead, offset: at(life * 0.5 + 170) },
      { opacity: 0.2, filter: 'none', offset: at(life - 560) }, { opacity: 1, filter: 'invert(1)', offset: at(life - 420) },
      { opacity: 0.5, filter: 'none', offset: at(life - 300) }, { opacity: 1, filter: 'none', offset: at(life - 180) },
      { opacity: 1, filter: 'none' }
    ]), { duration: life })];

    if (Math.random() < 0.55) {
      // `rotate` and `translate` add to the panel's own transform (tilted cards) instead of replacing it.
      const tilt = between(2, 5) * (Math.random() < 0.5 ? -1 : 1);
      const drop = between(10, 26);
      const sagging = { rotate: `${tilt}deg`, translate: `0 ${drop}px` };
      effects.push(panel.animate([
        { rotate: '0deg', translate: '0 0', offset: 0 },
        { rotate: '0deg', translate: '0 0', offset: at(460), easing: 'cubic-bezier(.6,0,1,.5)' },
        { ...sagging, offset: at(760), easing: 'ease-out' },
        { rotate: `${tilt * 0.6}deg`, translate: `0 ${drop * 0.7}px`, offset: at(910), easing: 'ease-in' },
        { ...sagging, offset: at(1080) },
        { ...sagging, offset: at(life - 180), easing: 'steps(1)' },
        { rotate: '0deg', translate: '0 0', offset: 1 }
      ], { duration: life }));
    }

    const rect = panel.getBoundingClientRect();
    const tag = document.createElement('div');
    tag.className = 'gra-fault-tag';
    tag.textContent = pick(FAULT_TAGS);
    tag.style.left = `${rect.left + rect.width / 2}px`;
    tag.style.top = `${rect.top + rect.height / 2}px`;
    const removeTag = stage(tag);
    // Shown once the panel is dead and gone as it recovers; it blinks slowly in between (CSS).
    tag.animate(jumps([{ visibility: 'hidden' }, { visibility: 'visible', offset: at(460) }, { visibility: 'hidden', offset: at(life - 560) },
      { visibility: 'hidden' }]), { duration: life, fill: 'both' });

    const end = hold(() => {
      effects.forEach(effect => effect.cancel());
      removeTag();
    });
    later(life, end);
  });
}

/** The same error window, again and again, each a step further down the screen. */
function errorCascade(strength, life) {
  const error = pick(ERRORS);
  const copies = whole(3, 5) + Math.round(strength * 7);
  const step = 26;
  const opening = clamp(life * 0.45 / copies, 180, 520);     // ms between windows
  const closing = 110;
  const x = between(20, Math.max(20, window.innerWidth - 400 - copies * step));
  const y = between(70, Math.max(70, window.innerHeight - 200 - copies * step));
  const windows = [];
  for (let i = 0; i < copies; i++) {
    later(i * opening, () => {
      const box = document.createElement('div');
      box.className = 'gra-error';
      box.innerHTML = `<header><span class="gra-boar-mark">AV</span> Autoverrox · errore di sistema <b>×</b></header>
        <div class="gra-error-body"><i>!</i><div><strong></strong><p></p></div></div>
        <footer><span>Ricalcola</span><span>Ignora</span></footer>`;
      box.querySelector('strong').textContent = error.title;
      box.querySelector('p').textContent = error.text;
      box.style.left = `${x + i * step}px`;
      box.style.top = `${y + i * step}px`;
      windows.push(stage(box));
      box.animate([{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }], { duration: 140 });
    });
  }
  // They close as they came, newest first, the last one as the breakdown ends.
  later(life - copies * closing, () => windows.reverse().forEach((remove, i) => later(i * closing, remove)));
}

/** The whole tracker cuts to an Autoverrox breakdown screen, counts to 100% and comes back torn. */
function crash(strength, life) {
  if (layer.querySelector('.gra-crash')) return;
  const screen = document.createElement('div');
  screen.className = 'gra-crash';
  screen.innerHTML = `${WARNING_TRIANGLE}
    <strong>Sistema Triangle Agency in panne</strong>
    <p>Autoverrox ha rilevato un guasto sulla tua corsia e sta rimuovendo il veicolo. Non spegnere la realtà.</p>
    <p class="gra-crash-progress">Rimozione forzata: <b>0</b>%</p>
    <p>Codice di arresto: TRAFFIC_ANOMALY_NOT_HANDLED</p>
    <pre class="gra-crash-dump"></pre>`;
  const remove = stage(screen);
  screen.animate(jumps([{ opacity: 0 }, { opacity: 1 }, { opacity: 0.3 }, { opacity: 1 }]), { duration: 220 });

  const percent = screen.querySelector('b');
  const dump = screen.querySelector('pre');
  const hex = () => whole(0, 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const lines = [];
  const aftermath = 1500;                                // the torn picture it comes back to
  const counting = life - aftermath - 700;               // then it sits at 100% for a moment
  const ticks = Math.round(counting / 260);
  for (let i = 1; i <= ticks; i++) {
    later(i * counting / ticks, () => {
      percent.textContent = Math.round(i / ticks * 100);
      lines.push(`GRA:${hex()}  ${hex()} ${hex()} ${hex()} ${hex()}  CORSIA_${whole(1, 9)} ${pick(['OCCUPATA', 'CHIUSA', 'DEVIATA', 'ASSORBITA'])}`);
      dump.textContent = lines.slice(-6).join('\n');
    });
  }
  later(life - aftermath, () => {
    remove();
    tear(Math.max(0.6, strength), aftermath);
  });
}

const BREAKDOWNS = { tear, corrupt, panelFault, errorCascade, crash };

/** How long a breakdown lasts at this strength, in ms: 3.5 to 10 seconds at full strength. */
function breakdownLife(strength) {
  return (between(3.5, 5.5) + strength * between(0.5, 4.5)) * 1000;
}

function breakdown(strength, name) {
  // The alarming ones come with strength: error windows more often, the full screen only up high.
  const odds = { tear: 3, corrupt: 3, panelFault: 3, errorCascade: 0.5 + 2.5 * strength, crash: 2 * strength * strength };
  let chosen = name;
  if (!chosen) {
    let roll = Math.random() * Object.values(odds).reduce((sum, weight) => sum + weight, 0);
    chosen = Object.keys(odds).find(key => (roll -= odds[key]) < 0) || 'tear';
  }
  // The full screen hides the tracker, so it is the short one.
  const life = chosen === 'crash' ? mix(5000, 8000, strength) * between(0.9, 1.1) : breakdownLife(strength);
  glitchBusyUntil = performance.now() + life + 1500;
  BREAKDOWNS[chosen](strength, life);
}

const INCIDENTS = { car: traffic, popup: popups, glitch: breakdown };

/* ---------- scheduling ---------- */
/** Nothing appears behind the toll barriers, on a locked display or in a hidden tab. */
function onShow() {
  return running && !document.hidden
    && document.documentElement.dataset.session === 'open'
    && !document.body.classList.contains('gra-transitioning');
}

/**
 * Twice a second each kind moves toward its next occurrence at its rate times the current
 * strength, so a change of chaos or of a slider is felt at once. Gaps stay within half and
 * one and a half times the average: never bunched up, never long overdue.
 */
function tick() {
  if (!onShow()) return;
  const strength = currentStrength();
  for (const kind of KINDS) {
    const perMinute = Math.max(0, Number(settings[`${kind === 'glitch' ? 'glitches' : `${kind}s`}PerMinute`]) || 0);
    progress[kind] += perMinute * strength * TICK_MS / 60000;
    if (progress[kind] < due[kind]) continue;
    if (kind === 'glitch' && performance.now() < glitchBusyUntil) continue;   // wait for the one running
    progress[kind] = 0;
    due[kind] = between(0.5, 1.5);
    INCIDENTS[kind](strength);
  }
}

function stop() {
  running = false;
  window.clearInterval(ticker);
  waiting.forEach(id => window.clearTimeout(id));
  waiting.clear();
  [...live].forEach(release => release());
  glitchBusyUntil = 0;
}

function start() {
  if (!layer && !build()) return;
  running = true;
  KINDS.forEach(kind => {
    due[kind] = between(0.5, 1.5);
    progress[kind] = due[kind] * between(0.3, 0.8);       // the first of each comes sooner
  });
  // Read the pass-by recordings ahead of the first vehicle.
  ['car', 'truck'].forEach(passBysFor);
  ticker = window.setInterval(tick, TICK_MS);
}

/** Run the incidents, the tracker's usual chaos effects or both, as the takeover is set to. */
function apply() {
  const incidents = takeover && mode !== 'default' && motionAllowed();
  // "Incidents only" quiets the usual atmosphere, but never leaves a display with neither.
  setChaosEffectsMuted(incidents && mode === 'gra');
  if (incidents === running) return;
  if (incidents) start();
  else stop();
}

/** Tell the incidents whether the takeover holds this display (graTakeover.js). */
export function setGraIncidents(on) {
  takeover = !!on;
  if (!settings) {
    // The first call also sets `settings` and `mode`, and applies them.
    onConfigChange(config => {
      settings = config.effects.graIncidents;
      mode = config.effects.graTakeover.chaosEffects;
      apply();
    });
    return;
  }
  apply();
}

/**
 * Show one incident now: 'car', 'popup', 'glitch', or a breakdown by name ('tear',
 * 'corrupt', 'panelFault', 'errorCascade', 'crash'), at the current or a given strength.
 */
export function playIncident(kind, strength = currentStrength()) {
  if (!running) return;
  if (BREAKDOWNS[kind]) breakdown(strength, kind);
  else INCIDENTS[kind]?.(strength);
}
