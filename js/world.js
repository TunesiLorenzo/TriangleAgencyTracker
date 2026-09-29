import { onConfigChange } from './config.js';
import { initEffects, setEffectsChaos } from './effects.js';
import { playEvent } from './soundEffects.js';
import { saveSettings } from './storage.js';
import { backgroundhue } from './witnesseffects.js';

const bgController = backgroundhue(document.getElementById('backgroundHue'));
const crtLine = document.getElementById('crtScanline');
const scanlineOverlay = document.getElementById('scanlineOverlay');

// Every clickable world counter. `timeline: true` counters feed the dashboard
// (timeline, risk); the others are tracked and saved but kept off the graphs.
const counters = {
  witness:       { id: 'witnessCounter',       value: 0, timeline: true },
  chaos:         { id: 'chaosCounter',         value: 0, timeline: true },
  globalWitness: { id: 'globalWitnessCounter', value: 0 },
  captured:      { id: 'capturedCounter',      value: 0 },
  killed:        { id: 'killedCounter',        value: 0 },
  escaped:       { id: 'escapedCounter',       value: 0 }
};

let video = { strongAtChaos: 2, fadeSeconds: 5 };
let currentVideo = 1;
let currentVideoSource = './images/bck_calm.mp4';
let pauseTimer = 0;

function bump(element, direction) {
  element.classList.remove('bump-up', 'bump-down');
  void element.offsetWidth;
  element.classList.add(direction > 0 ? 'bump-up' : 'bump-down');
}

function bindCounter(type) {
  const counter = counters[type];
  const element = document.getElementById(counter.id);
  if (!element) return;

  const change = delta => {
    const next = Math.max(0, counter.value + delta);
    if (next === counter.value) return;
    counter.value = next;

    if (type === 'witness') bgController.setWitnessCount(next, delta > 0);
    if (type === 'chaos') updateEffects();

    element.textContent = next;
    bump(element, delta);
    playEvent(delta > 0 ? type : 'counterDown');
    saveSettings();
    if (counter.timeline) {
      document.dispatchEvent(new CustomEvent('world-stat-changed', { detail: { type, value: next } }));
    }
  };

  element.title = 'Click to add, right-click to remove';
  element.addEventListener('click', () => change(1));
  element.addEventListener('contextmenu', event => {
    event.preventDefault();
    change(-1);
  });
}

export function initWorld() {
  Object.keys(counters).forEach(bindCounter);

  initEffects({
    wrapper: document.getElementById('pageWrapper'),
    scanline: crtLine,
    overlay: scanlineOverlay,
    vignette: document.getElementById('chaosVignette'),
    title: document.querySelector('h1')
  });

  onConfigChange(config => {
    video = config.effects.video;
    bgController.configure(config.effects.witnessHue);
    updateBackgroundVideo();
  });
}

export function setWorldData(data = {}) {
  Object.entries(counters).forEach(([type, counter]) => {
    counter.value = Math.max(0, Number(data[type]) || 0);
    const element = document.getElementById(counter.id);
    if (element) element.textContent = counter.value;
  });

  document.getElementById('branchName').value = data.branchName || '';
  bgController.setWitnessCount(counters.witness.value);
  updateEffects();
}

export function updateEffects() {
  const chaos = counters.chaos.value;
  setEffectsChaos(chaos);
  bgController.setWitnessCount(counters.witness.value);
  updateBackgroundVideo();
}

function getBackgroundVideo() {
  return counters.chaos.value >= video.strongAtChaos ? './images/bck_strong.mp4' : './images/bck_calm.mp4';
}

function updateBackgroundVideo() {
  const newSource = getBackgroundVideo();
  if (newSource === currentVideoSource) return;
  currentVideoSource = newSource;

  const firstVideo = document.getElementById('bgVideo1');
  const secondVideo = document.getElementById('bgVideo2');
  const outgoing = currentVideo === 1 ? firstVideo : secondVideo;
  const incoming = currentVideo === 1 ? secondVideo : firstVideo;

  // Reuse the element's current video when it already holds this source (a quick
  // back-and-forth swap), so it resumes instead of reloading from the start.
  const url = new URL(newSource, location.href).href;
  if (incoming.src !== url) incoming.src = url;
  incoming.play().catch(() => {});
  const fadeMs = Math.max(0, video.fadeSeconds * 1000);
  incoming.style.transition = `opacity ${fadeMs}ms`;
  outgoing.style.transition = `opacity ${fadeMs}ms`;
  incoming.style.opacity = 1;
  outgoing.style.opacity = 0;
  currentVideo = currentVideo === 1 ? 2 : 1;

  // Pause the outgoing video only once it is fully faded out (it used to freeze
  // 1s into the 5s fade). A newer swap cancels this, so a video that is fading
  // back in is never paused.
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => outgoing.pause(), fadeMs + 100);
}
