import { onConfigChange } from './config.js';
import { initEffects, setEffectsChaos } from './effects.js';
import { playEvent } from './soundEffects.js';
import { saveSettings } from './storage.js';
import { backgroundhue } from './witnesseffects.js';
import { motionAllowed } from './motion.js';

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

// The backgrounds are 4K masters with a 1080p copy next to each. Decoding 4K costs four
// times as much, so only a display that can actually show it gets the master.
const videoSuffix = Math.max(screen.width, screen.height) * (window.devicePixelRatio || 1) > 2560 ? '' : '_1080';
const videoFile = name => `./images/bck_${name}${videoSuffix}.mp4`;

let video = { strongAtChaos: 2, fadeSeconds: 5 };
let currentVideo = 1;
let currentVideoSource = videoFile('calm');
document.getElementById('bgVideo1').src = currentVideoSource;
let pauseTimer = 0;
let fadingVideo = null;

function backgroundVideos() {
  return [document.getElementById('bgVideo1'), document.getElementById('bgVideo2')].filter(Boolean);
}

/** The G.R.A. takeover hides both videos behind its street plan (gra.css): no point decoding them. */
function videoShown() {
  return motionAllowed() && document.documentElement.dataset.session === 'open' && !document.hidden
    && !document.body.classList.contains('gra-takeover');
}

function syncBackgroundVideoPlayback() {
  const active = currentVideo === 1 ? document.getElementById('bgVideo1') : document.getElementById('bgVideo2');
  const shouldPlay = videoShown();
  backgroundVideos().forEach(videoElement => {
    if (shouldPlay && (videoElement === active || videoElement === fadingVideo)) videoElement.play().catch(() => {});
    else videoElement.pause();
  });
}

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
  document.addEventListener('session-changed', syncBackgroundVideoPlayback);
  document.addEventListener('visibilitychange', syncBackgroundVideoPlayback);
  document.addEventListener('gra-takeover-changed', syncBackgroundVideoPlayback);
  syncBackgroundVideoPlayback();
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

export function finishMissionWorld(outcome) {
  const data = Object.fromEntries(Object.entries(counters).map(([key, counter]) => [key, counter.value]));
  data.branchName = document.getElementById('branchName').value;
  data.globalWitness += data.witness;
  data.witness = 0;
  data.chaos = 0;
  data[outcome] += 1;
  setWorldData(data);
  const outcomeElement = document.getElementById(counters[outcome]?.id);
  if (outcomeElement) bump(outcomeElement, 1);
}

function getBackgroundVideo() {
  return videoFile(counters.chaos.value >= video.strongAtChaos ? 'strong' : 'calm');
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
  if (videoShown()) incoming.play().catch(() => {});
  const fadeMs = Math.max(0, video.fadeSeconds * 1000);
  incoming.style.transition = `opacity ${fadeMs}ms`;
  outgoing.style.transition = `opacity ${fadeMs}ms`;
  incoming.style.opacity = 1;
  outgoing.style.opacity = 0;
  currentVideo = currentVideo === 1 ? 2 : 1;
  fadingVideo = outgoing;
  syncBackgroundVideoPlayback();

  // Pause the outgoing video only once it is fully faded out (it used to freeze
  // 1s into the 5s fade). A newer swap cancels this, so a video that is fading
  // back in is never paused.
  clearTimeout(pauseTimer);
  pauseTimer = setTimeout(() => {
    outgoing.pause();
    if (fadingVideo === outgoing) fadingVideo = null;
    pauseTimer = 0;
  }, fadeMs + 100);
}
