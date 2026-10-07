// G.R.A. mission skin controlled from /settings. A changed takeover setting
// deliberately reloads each viewer so the display appears to be seized remotely.

import { getConfig, onConfigChange } from './config.js';
import { motionAllowed } from './motion.js';

const RELOAD_SESSION_KEY = 'ta-gra-preserve-open-session';

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
let bootTimer = 0;
let reloadTimer = 0;

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
  window.clearTimeout(bootTimer);
  window.clearTimeout(reloadTimer);
  messageTimer = 0;
  clockTimer = 0;
  messageSwapTimer = 0;
  bootTimer = 0;
  reloadTimer = 0;
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
    if (active) {
      heading?.setAttribute('aria-label', 'Autoverrox — Grande Raccordo Adimensionale. Interface control acquired.');
    } else {
      heading?.removeAttribute('aria-label');
    }

    stopTimers();
    if (!active) {
      messageIndex = 0;
      message.textContent = MESSAGES[0];
      message.classList.remove('is-changing');
      code.textContent = 'G.R.A. // 00';
      toll?.classList.remove('is-approaching', 'is-opening');
      return;
    }

    if (playToll('is-opening')) {
      bootTimer = window.setTimeout(() => toll.classList.remove('is-opening'), 3100);
    }

    updateClock(clock);
    clockTimer = window.setInterval(() => updateClock(clock), 1000);
    messageTimer = window.setInterval(() => rotateMessage(message, code), 3900);
  };

  const configuredState = config => config.effects?.graTakeover?.enabled === true;
  setActive(configuredState(getConfig()));

  let reloadQueued = false;
  onConfigChange(config => {
    const desired = configuredState(config);
    if (desired === active || reloadQueued) return;
    reloadQueued = true;
    // Only a display that is already open bypasses login after this one reload.
    // A locked or mid-authentication display remains locked.
    if (document.documentElement.dataset.session === 'open') {
      try { sessionStorage.setItem(RELOAD_SESSION_KEY, '1'); } catch { /* storage unavailable */ }
    }
    const reload = () => window.location.reload();
    if (playToll('is-approaching')) {
      document.body.classList.add('gra-transitioning');
      reloadTimer = window.setTimeout(reload, 780);
    } else {
      reload();
    }
  });
}
