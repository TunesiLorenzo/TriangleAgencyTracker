// login.js
// The sign-in screen shown when the tracker is opened in a new browser session, and the
// Log Out button at the bottom of every tab that brings it back. The page loads black; a
// click anywhere switches the screen on like a CRT. The next click anywhere types
// in the Manager's credentials; the Manager badge drops in on its lanyard and goes through
// the card reader; the retina scanner rises and scans; then a triangular window opens out
// of the logo onto the main screen. Log Out runs that window in reverse, counts down
// "Secure link severed", collapses the screen like a CRT powering off, then stops the server.
// The page stays black until manually refreshed. Purely theatrical: nothing is checked, and the main screen keeps running
// underneath. Behind it all, the moving contour lines of loginBackdrop.js. Its sounds are
// the "Log in / out" buttons on /settings; the timing of every step and the badge picture
// are on the Login tab there. Ctrl + left-click skips the sequence and opens the tracker.
// The room lights follow the screen switching on, the login screen and Log Out (the scenes
// of lights.py, set under Session lights on /settings).

import { getConfig, onConfigChange } from './config.js';
import { createBackdrop } from './loginBackdrop.js';
import { createBadgeRig } from './loginBadge.js';
import { playButton, powerOffAudio, soundStartDelay } from './soundEffects.js';
import { motionAllowed } from './motion.js';
import { triggerLightScene } from './lights.js';
import { stopVoiceMeeterBridge } from './voicemeeter.js';

const READER_ZOOM = 2;     // the close-up on the badge going through the card reader
const PURGE_SECONDS = 4;   // Log Out: the countdown before the CRT switches off
const POWER_OFF_MS = 1100;
const POWER_ON_MS = 1400;  // page load: the black screen switching on, the same collapse backwards
const WARM_UP_MS = 3500;   // the picture wobbling under crawling scanlines once it is on
const USERNAME = 'Manager#56776544';
const PASSWORD = '*'.repeat(14);

// Without motion every beat is short: the steps still show, nothing travels.
const wait = ms => new Promise(resolve => setTimeout(resolve, motionAllowed() ? ms : Math.min(ms, 150)));
const canClipWindow = window.CSS?.supports?.('clip-path', 'path(evenodd, "M0 0H1V1Z")') ?? false;

const els = {};
let state = 'standby';    // standby | powering-on | locked | authenticating | open | closing | severed | powering-off | off
let switchingOn = false;  // clicked in standby, waiting for the amplifier before the picture comes up
let settled = Promise.resolve();   // resolves once the picture has stopped wobbling after power on
let signedInWaiters = [];
let clockTimer = 0;
let backdrop = null;      // the moving background; null without WebGL
let badge = null;         // the badge on its lanyard (loginBadge.js)

function setState(next) {
  state = next;
  els.screen.dataset.state = next;
  const open = next === 'open';
  const poweredOff = next === 'powering-off' || next === 'off';
  els.screen.inert = poweredOff;
  // Signed in: login.css hides the screen.
  if (open) document.documentElement.dataset.session = 'open';
  else delete document.documentElement.dataset.session;
  els.main.inert = !open;

  if (open || poweredOff || next === 'standby') {
    clearInterval(clockTimer);
    clockTimer = 0;
    backdrop?.stop();
    if (open) signedInWaiters.splice(0).forEach(resolve => resolve());
  } else {
    backdrop?.start();
    if (!clockTimer) {
      showTime();
      clockTimer = setInterval(showTime, 1000);
    }
  }
  document.dispatchEvent(new CustomEvent('session-changed', { detail: { state: next, open } }));
}

/** Where the background's triangle sits: the logo's centre and its frame's outer circumradius, in px. */
function logoFocus() {
  const box = els.logoMark.getBoundingClientRect();
  const scale = box.width / 200;                  // the logo's viewBox is 200 wide
  // The frame's centroid is 117.6 down the viewBox; its outer edge is 114 from there.
  return { x: box.left + box.width / 2, y: box.top + 117.6 * scale, size: 114 * scale };
}

function showTime() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  els.clock.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * The timings saved on /settings, in ms. Read when a sign-in or Log Out starts; the steps
 * that are CSS transitions get theirs as custom properties on the screen.
 */
function applyTiming() {
  const seconds = getConfig().login.timing;
  const ms = Object.fromEntries(Object.entries(seconds).map(([key, value]) => [key, Math.max(0, Number(value) || 0) * 1000]));
  ms.scanPasses = Math.max(1, Math.round(Number(seconds.scanPasses) || 1));
  const style = els.screen.style;
  style.setProperty('--login-scanner-rise', `${ms.scannerRise}ms`);
  style.setProperty('--login-badge-enter', `${ms.badgeEnter}ms`);
  style.setProperty('--login-badge-read', `${ms.badgeRead}ms`);
  style.setProperty('--login-badge-eject', `${ms.badgeEject}ms`);
  style.setProperty('--login-lens-open', `${ms.lensOpen}ms`);
  style.setProperty('--login-exit', `${ms.exit}ms`);
  style.setProperty('--scan-pass', `${ms.scanPass}ms`);
  style.setProperty('--scan-passes', String(ms.scanPasses));
  return ms;
}

/** The Manager's own photo on the badge (uploaded on /settings), or the silhouette. */
function showBadgePicture(path) {
  const { badgePhoto, badgePicture } = els;
  if (path === badgePicture.dataset.path) return;
  badgePicture.dataset.path = path;
  if (path) badgePicture.src = path;
  else badgePicture.removeAttribute('src');
  badgePhoto.classList.toggle('has-picture', !!path);
}

function setStatus(text, { ok = false } = {}) {
  els.status.textContent = text;
  els.status.classList.toggle('is-ok', ok);
}

/** Back to an untouched login screen. Called while the screen is hidden, so nothing animates. */
function resetScreen() {
  els.screen.classList.remove('is-scanner-open', 'is-lens-open', 'is-scanning', 'is-matched',
    'is-verified', 'is-granted', 'is-badge-shown', 'is-badge-reading', 'is-badge-read', 'is-reader-done', 'is-badge-leaving');
  els.screen.style.removeProperty('--scan');
  badge.reset();
  backdrop?.reset();
  els.panel.style.removeProperty('--lift');
  els.panel.style.removeProperty('--shift');
  els.fields.forEach(field => {
    field.classList.remove('is-typing', 'is-done');
    field.querySelector('.login-value').textContent = '';
  });
  els.checks.forEach(item => item.classList.remove('is-ok'));
  els.percent.textContent = '00%';
  setStatus('');
}

/** The badge's barcode, drawn from the ID so it is the same every time. */
function buildBarcode() {
  const widths = [2, 1, 1];
  for (const digit of USERNAME.replace(/\D/g, '')) {
    widths.push(1 + (digit % 3), 1 + ((digit >> 1) % 2), 1 + ((digit * 7) % 3), 1);
  }
  widths.push(1, 1, 2);
  els.barcode.replaceChildren(...widths.map((width, index) => {
    const bar = document.createElement('span');
    bar.style.flexGrow = String(width);
    if (index % 2) bar.className = 'gap';
    return bar;
  }));
}

/** The print running down both sides of the lanyard. */
function printLanyard() {
  const print = '▲ Triangle Agency   '.repeat(12);
  els.screen.querySelectorAll('.login-lanyard-strap > span').forEach(strap => { strap.textContent = print; });
}

async function typeInto(field, text, pace) {
  const value = field.querySelector('.login-value');
  if (!motionAllowed()) {
    value.textContent = text;
    return;
  }
  field.classList.add('is-typing');
  for (const char of text) {
    value.textContent += char;
    playButton('session', 'typing');
    await wait(pace * (0.6 + Math.random() * 0.8));
  }
  field.classList.remove('is-typing');
}

/**
 * Move the logo and form left just enough to clear the card reader beside them (wide
 * screens; on narrow ones the reader sits in the top corner instead).
 */
function shiftPanel() {
  if (!window.matchMedia('(min-width: 901px)').matches) return;
  const panel = els.panel.getBoundingClientRect();
  const rig = els.rig.getBoundingClientRect();
  const readerLeft = rig.left - rig.width * 0.17;          // the reader is 1.34 badges wide, centred on the badge
  const shift = Math.max(0, Math.min(panel.right + 24 - readerLeft, panel.left - 16));
  els.panel.style.setProperty('--shift', `${shift}px`);
}

/**
 * The close-up while the badge goes through the reader: the whole rig at READER_ZOOM times
 * its size, its slot in the middle of the screen (wide screens; login.css applies it).
 */
function frameReader() {
  if (!window.matchMedia('(min-width: 901px)').matches) return;
  const { rig, slit } = els;
  let slotY = slit.offsetHeight / 2;
  for (let node = slit; node && node !== rig; node = node.offsetParent) slotY += node.offsetTop;
  const box = rig.getBoundingClientRect();
  const x = window.innerWidth / 2 - box.left - READER_ZOOM * box.width / 2;
  const y = window.innerHeight * 0.52 - box.top - READER_ZOOM * slotY;
  rig.style.setProperty('--zoom', `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${READER_ZOOM})`);
}

/** Move the logo and form up just enough to clear the scanner rising from the bottom edge. */
function liftPanel() {
  const panel = els.panel.getBoundingClientRect();
  const scannerTop = window.innerHeight - els.scanner.offsetHeight;
  const lift = Math.max(0, Math.min(panel.bottom + 20 - scannerTop, panel.top - 12));
  els.panel.style.setProperty('--lift', `${lift}px`);
}

/** The beam sweeps the lens while the progress, the vessel map and the checklist fill in. */
function scan({ scanPass, scanPasses }) {
  const { screen } = els;
  const passes = motionAllowed() ? scanPasses : 1;
  const duration = Math.max(1, motionAllowed() ? scanPasses * scanPass : 900);
  screen.classList.add('is-scanning');
  if (backdrop) backdrop.heat = 0.3;
  for (let pass = 0; pass < passes; pass++) {
    setTimeout(() => {
      playButton('session', 'scan');
      backdrop?.ring();
    }, pass * scanPass);
  }

  return new Promise(resolve => {
    const start = performance.now();
    const frame = now => {
      const progress = Math.min(1, (now - start) / duration);
      screen.style.setProperty('--scan', progress.toFixed(3));
      els.percent.textContent = `${String(Math.floor(progress * 100)).padStart(2, '0')}%`;
      els.checks.forEach((item, index) => item.classList.toggle('is-ok', progress >= (index + 1) / els.checks.length));
      if (progress < 1) {
        requestAnimationFrame(frame);
        return;
      }
      screen.classList.remove('is-scanning');
      resolve();
    };
    requestAnimationFrame(frame);
  });
}

const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;

/**
 * The triangular window between the login screen and the main screen. Opening grows it
 * out of the logo's core until it holds the whole screen; closing is the same move
 * reversed. The first frame is drawn before this returns, so a screen that was hidden
 * a moment ago never paints without its window.
 */
function iris(direction, duration) {
  const { stage, content, core, edge, edgeLines } = els;
  const opening = direction === 'open';

  if (!motionAllowed() || !canClipWindow) {
    const fade = stage.animate([{ opacity: opening ? 1 : 0 }, { opacity: opening ? 0 : 1 }], { duration: 300, easing: 'ease', fill: 'forwards' });
    return fade.finished.then(() => () => fade.cancel());
  }

  const box = core.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 3;              // the core points down: its centre is a third of the way from the top
  const from = box.width / Math.sqrt(3);           // the core's circumradius
  const width = window.innerWidth;
  const height = window.innerHeight;
  const corners = [[0, 0], [width, 0], [0, height], [width, height]];
  // A triangle's incircle is half its circumradius; once it holds every corner, the screen is clear.
  const to = 2.1 * Math.max(...corners.map(([cx, cy]) => Math.hypot(cx - x, cy - y)));

  content.style.transformOrigin = `${x}px ${y}px`;
  core.style.opacity = '0';                        // the window takes the core's place

  const render = progress => {
    const r = from * (to / from) ** progress;      // exponential, so it reads as one steady zoom
    const half = r * Math.sqrt(3) / 2;
    const points = [[x - half, y - r / 2], [x + half, y - r / 2], [x, y + r]].map(([px, py]) => `${px.toFixed(1)} ${py.toFixed(1)}`);
    stage.style.clipPath = `path(evenodd, "M0 0H${width}V${height}H0Z M${points[0]}L${points[1]}L${points[2]}Z")`;
    edgeLines.forEach(line => line.setAttribute('points', points.join(' ')));
    edge.style.opacity = String(Math.min(1, (1 - progress) * 4));
    content.style.transform = `scale(${1 + 0.4 * progress})`;
    content.style.opacity = String(Math.max(0, 1 - progress * 1.8));
    // The background dives into the triangle with the window (and climbs back out on Log Out).
    if (backdrop) {
      backdrop.zoom = 2.6 * progress;
      backdrop.boost = progress;
    }
  };
  render(opening ? 0 : 1);

  return new Promise(resolve => {
    const start = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - start) / Math.max(1, duration));
      render(easeInOutSine(opening ? t : 1 - t));
      if (t < 1) {
        requestAnimationFrame(frame);
        return;
      }
      // Clean-up for the caller to run once the screen has been hidden or the core is back.
      resolve(() => {
        stage.style.clipPath = '';
        edge.style.opacity = '';
        core.style.opacity = '';
        content.style.transform = '';
        content.style.opacity = '';
        content.style.transformOrigin = '';
      });
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Page load leaves the screen black; the first click (or Enter / Space) switches it on like a
 * CRT, the Log Out collapse run backwards, then the picture takes a few seconds to settle.
 */
async function powerOn() {
  if (state !== 'standby' || switchingOn) return;
  switchingOn = true;
  // This click also wakes a sleeping amplifier: hold the picture back until the sound can be heard.
  await new Promise(resolve => setTimeout(resolve, soundStartDelay()));
  const moving = motionAllowed();
  const duration = moving ? POWER_ON_MS : 150;
  els.screen.style.setProperty('--login-power-on', `${duration}ms`);
  setState('powering-on');
  playButton('session', 'powerOn');
  triggerLightScene('powerOn');
  await new Promise(resolve => setTimeout(resolve, duration));
  if (moving) settled = warmUp();
  // The room pulses for as long as the picture is unsteady.
  settled.then(() => triggerLightScene('login'));
  setState('locked');
}

const TAU = Math.PI * 2;
const spread = () => Math.random() * 2 - 1;

/**
 * The tube warming up, for WARM_UP_MS: the chaos atmosphere of effects.js at full strength,
 * dying away. The picture drifts toward random targets with sharp jolts (colour fringes on
 * each), sways sideways and breathes; scanlines crawl over it and a glowing band sweeps up
 * the screen. Resolves when the picture is still.
 */
function warmUp() {
  const { screen, stage, crtLines, crtBand } = els;
  const jitter = { x: 0, y: 0, skew: 0, tx: 0, ty: 0, tskew: 0, nextRetarget: 0, burstUntil: 0 };
  const start = performance.now();
  let last = start;
  let bandY = 0;
  screen.classList.add('is-warming');

  return new Promise(resolve => {
    const frame = now => {
      const t = (now - start) / WARM_UP_MS;
      if (t >= 1 || state === 'open') {
        screen.classList.remove('is-warming', 'is-crt-glitch');
        stage.style.transform = '';
        stage.style.opacity = '';
        resolve();
        return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const seconds = now / 1000;
      // In over the first instant, so nothing pops up on the settled picture, then a long decay.
      const level = Math.min(1, t / 0.04) * (1 - t) ** 1.5;

      let bursting = now < jitter.burstUntil;
      if (!bursting && Math.random() < dt * 3.5 * level) {
        jitter.burstUntil = now + 70 + Math.random() * 150;
        jitter.nextRetarget = 0;
        bursting = true;
      }
      screen.classList.toggle('is-crt-glitch', bursting);
      if (now >= jitter.nextRetarget) {
        const amp = bursting ? 3 + 14 * level : 3 * level;
        jitter.tx = spread() * amp;
        jitter.ty = spread() * amp * 0.35;       // a tube loses its horizontal hold first
        jitter.tskew = spread() * (bursting ? 2.2 : 0.35) * level;
        jitter.nextRetarget = now + (bursting ? 30 : 130);
      }
      const k = 1 - Math.exp(-dt / (bursting ? 0.02 : 0.09));
      jitter.x += (jitter.tx - jitter.x) * k;
      jitter.y += (jitter.ty - jitter.y) * k;
      jitter.skew += (jitter.tskew - jitter.skew) * k;

      const sway = Math.sin(seconds * TAU * 5.3) * 2.5 * level;
      const breathe = 1 + Math.sin(seconds * TAU * 1.3) * 0.012 * level;
      stage.style.transform = `translate(${(jitter.x + sway).toFixed(2)}px, ${jitter.y.toFixed(2)}px) skewX(${jitter.skew.toFixed(3)}deg) scaleY(${breathe.toFixed(4)})`;
      // mains hum in the brightness, and a dip on each jolt
      stage.style.opacity = (1 - level * (0.1 + 0.07 * Math.sin(seconds * TAU * 9)) - (bursting ? 0.22 * level : 0)).toFixed(3);

      crtLines.style.opacity = (level * 0.55).toFixed(3);
      crtLines.style.transform = `translateY(${((seconds * 22) % 10).toFixed(1)}px)`;
      bandY += (90 + 260 * level) * dt;
      if (bandY > window.innerHeight + 60) bandY = 0;
      crtBand.style.opacity = (level * 0.8).toFixed(3);
      crtBand.style.transform = `translateY(${(-bandY).toFixed(1)}px)`;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function signIn(event) {
  if (event?.button !== undefined && event.button !== 0) return;
  if (state === 'standby') {
    if (event?.ctrlKey) setState('open');
    else powerOn();
    return;
  }
  if (state !== 'locked') return;
  if (event?.ctrlKey) {
    event.preventDefault();
    setState('open');
    return;
  }
  setState('authenticating');
  const t = applyTiming();
  const { screen, fields } = els;

  // Typing sounds wait for a sleeping amplifier, so start once they can be heard.
  await wait(Math.max(t.typingStart, soundStartDelay()));
  setStatus('Transmitting credentials…');
  await typeInto(fields[0], USERNAME, t.userCharacter);
  await wait(t.fieldGap);
  await typeInto(fields[1], PASSWORD, t.passwordCharacter);
  fields.forEach(field => field.classList.add('is-done'));
  setStatus('Credentials accepted · Present your badge');
  backdrop?.ring();
  await wait(t.credentialsHold);

  // The reader rises beside the form while the badge drops in on its lanyard...
  await settled;   // measured on a still picture, should the tube still be warming up
  shiftPanel();
  frameReader();
  screen.classList.add('is-badge-shown');
  badge.drop(t.badgeEnter, { onCatch: () => playButton('session', 'badgeDrop') });
  await wait(t.badgeEnter);
  // ...goes into the slot, and is read.
  setStatus('Reading badge…');
  // The sound ends on the latch catching (synth "Card into reader"), so it lands as the card bottoms out.
  setTimeout(() => playButton('session', 'badgeInsert'), motionAllowed() ? Math.max(0, t.badgeInsert - 180) : 0);
  await badge.insert(t.badgeInsert);
  screen.classList.add('is-badge-reading');
  await wait(t.badgeRead);
  screen.classList.add('is-badge-read');
  playButton('session', 'badgeRead');
  backdrop?.ring();
  setStatus('Badge accepted · Retina scan required');

  // The reader pushes the badge back out and sinks away as the retina scanner rises.
  liftPanel();
  badge.eject(t.badgeEject);
  screen.classList.add('is-reader-done', 'is-scanner-open');
  playButton('session', 'scannerOpen');
  await wait(t.scannerRise);
  screen.classList.add('is-lens-open');
  await wait(t.lensOpen);
  setStatus('Hold still · Scanning retina');
  await scan(t);

  screen.classList.add('is-matched', 'is-verified');
  playButton('session', 'verified');
  backdrop?.ring('green');
  setStatus('Identity confirmed · Welcome back, Manager', { ok: true });
  await wait(t.verifiedHold);
  screen.classList.add('is-granted');
  playButton('session', 'granted');
  if (backdrop) backdrop.heat = 1;
  await wait(t.grantedHold);

  screen.classList.add('is-badge-leaving');
  badge.leave(t.exit);
  screen.classList.remove('is-lens-open');
  await wait(t.exit / 2);
  screen.classList.remove('is-scanner-open');
  playButton('session', 'enter');
  const cleanUp = await iris('open', t.windowOpen);
  setState('open');
  cleanUp();
  resetScreen();
}

async function signOut() {
  if (state !== 'open') return;
  // The sound comes from the button itself (Log in / out on /settings).
  resetScreen();
  setState('closing');
  const cleanUp = await iris('close', applyTiming().windowClose);
  cleanUp();
  // Not 'locked': a click during the countdown must not start a sign-in.
  setState('severed');
  triggerLightScene('severed');
  await purgeCountdown();
  await powerOff();
  await stopServer();
}

/**
 * "Secure link severed": counts down to 0, one real second at a time (reduced motion too).
 * The purge sound already holds every beep of the countdown, so it plays once, at the start.
 */
async function purgeCountdown() {
  if (backdrop) backdrop.heat = 0.4;
  playButton('session', 'purgeTick');
  for (let left = PURGE_SECONDS; left > 0; left--) {
    els.purgeCount.textContent = String(left);
    backdrop?.ring();
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  els.purgeCount.textContent = '0';
}

/** Collapse the countdown image into a line, then keep an opaque black screen. */
async function powerOff() {
  const duration = motionAllowed() ? POWER_OFF_MS : 150;
  els.screen.style.setProperty('--login-power-off', `${duration}ms`);
  setState('powering-off');
  const sound = powerOffAudio();
  await new Promise(resolve => setTimeout(resolve, duration));
  setState('off');
  triggerLightScene('shutdown');
  // Keep the server available until the audio has finished loading and playing.
  await sound;
}

/** Stop the server after the picture and sound finish, leaving this page black. */
async function stopServer() {
  try {
    const response = await fetch('/api/shutdown', { method: 'POST' });
    if (!response.ok) return;
  } catch {
    return;   // already stopped or served without the tracker backend
  }
  // The server lets the lights finish, stops LightRPG and goes. The VoiceMeeter bridge is
  // on this computer, which may not be the server's, so it is stopped from here: the
  // server no longer answering is the sign that the lights are done.
  for (let tries = 0; tries < 90; tries++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    try {
      await fetch('/api/config', { method: 'HEAD', cache: 'no-store' });
    } catch {
      break;
    }
  }
  stopVoiceMeeterBridge(getConfig().effects.voicemeeter).catch(() => { /* none running here */ });
}

/** Resolves once the Manager is signed in (at once if they already are). */
export function whenSignedIn() {
  return state === 'open' ? Promise.resolve() : new Promise(resolve => signedInWaiters.push(resolve));
}

export function initLogin() {
  const screen = document.getElementById('loginScreen');
  Object.assign(els, {
    screen,
    main: document.getElementById('pageWrapper'),
    stage: screen.querySelector('.login-stage'),
    crtLines: screen.querySelector('.login-crt-lines'),
    crtBand: screen.querySelector('.login-crt-band'),
    content: screen.querySelector('.login-content'),
    panel: screen.querySelector('.login-panel'),
    logoMark: screen.querySelector('.login-logo-mark'),
    rig: screen.querySelector('.login-rig'),
    slit: screen.querySelector('.login-reader-slit'),
    core: screen.querySelector('.login-logo-core'),
    clock: screen.querySelector('.login-clock'),
    fields: [...screen.querySelectorAll('.login-field')],
    start: screen.querySelector('.login-start'),
    status: screen.querySelector('.login-status'),
    purgeCount: screen.querySelector('.login-purge-count'),
    scanner: screen.querySelector('.login-scanner'),
    percent: screen.querySelector('.login-percent'),
    checks: [...screen.querySelectorAll('.login-checks li')],
    barcode: screen.querySelector('.login-badge-barcode'),
    badgePhoto: screen.querySelector('.login-badge-photo'),
    badgePicture: screen.querySelector('.login-badge-picture'),
    edge: screen.querySelector('.login-iris-edge'),
    edgeLines: [...screen.querySelectorAll('.login-iris-edge polygon')]
  });
  buildBarcode();
  printLanyard();
  badge = createBadgeRig({
    badge: screen.querySelector('.login-badge'),
    swing: screen.querySelector('.login-badge-swing'),
    card: screen.querySelector('.login-badge-card'),
    slit: screen.querySelector('.login-reader-slit'),
    animate: motionAllowed
  });
  const canvas = screen.querySelector('.login-backdrop');
  backdrop = createBackdrop(canvas, { focus: logoFocus, animate: motionAllowed });
  if (!backdrop) canvas.hidden = true;
  // A picture that has gone missing from images/badge/ falls back to the silhouette.
  els.badgePicture.addEventListener('error', () => els.badgePhoto.classList.remove('has-picture'));
  onConfigChange(config => showBadgePicture(config.login.badgePicture));

  screen.addEventListener('click', signIn);
  // Nothing on the black screen can take focus, so the keyboard switches it on from anywhere.
  document.addEventListener('keydown', event => {
    if (state === 'standby' && (event.key === 'Enter' || event.key === ' ')) powerOn();
  });
  document.getElementById('logoutButton').addEventListener('click', signOut);

  setState('standby');
}
