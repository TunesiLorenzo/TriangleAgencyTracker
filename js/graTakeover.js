// G.R.A. mission skin controlled from /settings. Switch skins under the toll
// barriers without navigating away from the running viewer.

import { getConfig, onConfigChange } from './config.js';
import { setGraIncidents } from './graIncidents.js';
import { motionAllowed } from './motion.js';
import { isMuted, playSlot, slotDuration, soundStartDelay } from './soundEffects.js';

// The toll scene's own movements in ms, matched in gra.css: it arrives with the barriers
// down, they lift, and it leaves (signs away, then the dissolve).
const TOLL_ARRIVE_MS = 780;
const TOLL_LIFT_MS = 1150;
const TOLL_EXIT_MS = 1300;

const MESSAGES = [
  'INTERFACCIA ACQUISITA',
  'RICALCOLO DELLA REALTÀ',
  'CONDUCENTE PROBLEMATICO RILEVATO',
  'TRAFFICO: SOLUZIONE IN CORSO',
  'DESTINAZIONE GIÀ RAGGIUNTA',
  'FA’ SPARIRE IL TRAFFICO'
];

let active = false;
let messageIndex = 0;
let messageTimer = 0;
let clockTimer = 0;
let messageSwapTimer = 0;

const clockFormat = new Intl.DateTimeFormat('it-IT', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

function updateClock(element) {
  if (!element) return;
  element.textContent = clockFormat.format(new Date());
}

function rotateMessage(element, code) {
  if (!element) return;
  messageIndex = (messageIndex + 1) % MESSAGES.length;
  const show = () => {
    element.textContent = MESSAGES[messageIndex];
    code.textContent = `G.R.A. // ${String(messageIndex).padStart(2, '0')}`;
    element.classList.remove('is-changing');
  };

  if (!motionAllowed()) {
    show();
    return;
  }
  element.classList.add('is-changing');
  messageSwapTimer = window.setTimeout(show, 160);
}

function stopTimers() {
  window.clearInterval(messageTimer);
  window.clearInterval(clockTimer);
  window.clearTimeout(messageSwapTimer);
  messageTimer = 0;
  clockTimer = 0;
  messageSwapTimer = 0;
}

export function initGraTakeover() {
  const overlay = document.getElementById('graTakeoverOverlay');
  const message = document.getElementById('graTakeoverMessage');
  const code = overlay?.querySelector('.gra-message-code');
  const clock = document.getElementById('graTakeoverClock');
  const toll = overlay?.querySelector('.gra-toll-transition');
  const heading = document.querySelector('h1');
  if (!overlay || !message || !code) return;

  const hasMotion = motionAllowed();
  overlay.classList.toggle('gra-motion', hasMotion);
  document.body.classList.toggle('gra-motion-enabled', hasMotion);

  const playToll = phase => {
    if (!toll || !hasMotion) return false;
    toll.classList.remove('is-approaching', 'is-opening');
    void toll.offsetWidth;
    toll.classList.add(phase);
    return true;
  };

  const setActive = next => {
    active = !!next;
    document.body.classList.toggle('gra-takeover', active);
    // world.js stops decoding the background videos while the street plan covers them.
    document.dispatchEvent(new CustomEvent('gra-takeover-changed'));
    if (active) {
      heading?.setAttribute('aria-label', 'Autoverrox — Grande Raccordo Adimensionale. Interface control acquired.');
    } else {
      heading?.removeAttribute('aria-label');
    }

    stopTimers();
    // Traffic, pop-ups and breakdowns come and go with the skin.
    setGraIncidents(active);
    if (!active) {
      messageIndex = 0;
      message.textContent = MESSAGES[0];
      message.classList.remove('is-changing');
      code.textContent = 'G.R.A. // 00';
      return;
    }

    updateClock(clock);
    clockTimer = window.setInterval(() => updateClock(clock), 1000);
    messageTimer = window.setInterval(() => rotateMessage(message, code), 3900);
  };

  const configuredState = config => config.effects?.graTakeover?.enabled === true;
  let desired = configuredState(getConfig());
  let transitioning = false;
  setActive(desired);

  const switchMode = async () => {
    if (desired === active || transitioning) return;
    // Locked and authenticating displays keep their login state, and reduced
    // motion switches immediately without moving barriers.
    const settings = getConfig().effects.graTakeover;
    const open = document.documentElement.dataset.session === 'open';
    if (!open || !toll || !hasMotion) {
      if (open && !isMuted()) void playSlot(settings.sound);
      setActive(desired);
      return;
    }

    // The sound starts now and the screen follows it: untouched until the toll scene
    // covers it at coverAt, the barriers lift at openAt, and the scene has dissolved
    // when the sound ends. A muted viewer keeps the same timing.
    transitioning = true;
    const soundMs = await slotDuration(settings.sound) * 1000;
    const heardIn = soundStartDelay();
    if (!isMuted()) void playSlot(settings.sound);
    const mark = seconds => heardIn + Math.max(0, Number(seconds) || 0) * 1000;
    const coverAt = mark(settings.coverAt);
    // Never before the scene has covered the old skin, nor too late to lift and leave.
    const openAt = Math.max(mark(settings.openAt), coverAt + TOLL_ARRIVE_MS);
    const endAt = Math.max(heardIn + soundMs, openAt + TOLL_LIFT_MS + TOLL_EXIT_MS);
    toll.style.setProperty('--gra-toll-exit', `${endAt - TOLL_EXIT_MS - openAt}ms`);

    window.setTimeout(() => {
      document.body.classList.add('gra-transitioning');
      playToll('is-approaching');
    }, coverAt);
    // Adopt the latest request if the setting changed before the scene covered the screen.
    window.setTimeout(() => setActive(desired), coverAt + TOLL_ARRIVE_MS);
    window.setTimeout(() => playToll('is-opening'), openAt);
    window.setTimeout(() => {
      toll.classList.remove('is-opening');
      document.body.classList.remove('gra-transitioning');
      transitioning = false;
      // A request received meanwhile is handled as soon as the scene clears.
      switchMode();
    }, endAt);
  };

  onConfigChange(config => {
    desired = configuredState(config);
    // Read the sound's length ahead of time, so a switch starts the moment it is asked for.
    void slotDuration(config.effects.graTakeover.sound);
    switchMode();
  });
}
