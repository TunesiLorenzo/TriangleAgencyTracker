import { animateCRT, stepJitter, updateScanlineOverlay } from './effects.js';
import { noise } from './noise.js';
import { saveSettings } from './storage.js';
import { backgroundhue } from './witnesseffects.js';

const bgController = backgroundhue(document.getElementById('backgroundHue'));
const crtLine = document.getElementById('crtScanline');
const scanlineOverlay = document.getElementById('scanlineOverlay');

let witness = 0;
let chaos = 0;
let currentVideo = 1;
let currentVideoSource = './images/bck_calm.mp4';

export function initWorld() {
  const witnessElement = document.getElementById('witnessCounter');
  const chaosElement = document.getElementById('chaosCounter');

  witnessElement.addEventListener('click', () => {
    witness += 1;
    witnessElement.textContent = witness;
    bgController.setWitnessCount(witness, true);
    saveSettings();
  });
  witnessElement.addEventListener('contextmenu', event => {
    event.preventDefault();
    witness = Math.max(0, witness - 1);
    witnessElement.textContent = witness;
    bgController.setWitnessCount(witness);
    saveSettings();
  });

  chaosElement.addEventListener('click', () => {
    chaos += 1;
    chaosElement.textContent = chaos;
    updateEffects();
    saveSettings();
  });
  chaosElement.addEventListener('contextmenu', event => {
    event.preventDefault();
    chaos = Math.max(0, chaos - 1);
    chaosElement.textContent = chaos;
    updateEffects();
    saveSettings();
  });

  noise.setDensity(0.5);
  noise.setColor('rgba(255,255,255,0.01)');
  noise.start();
}

export function setWorldData(data = {}) {
  witness = Number(data.witness || 0);
  chaos = Number(data.chaos || 0);

  document.getElementById('branchName').value = data.branchName || '';
  document.getElementById('witnessCounter').textContent = witness;
  document.getElementById('chaosCounter').textContent = chaos;
  bgController.setWitnessCount(witness);
  updateEffects();
}

export function updateEffects() {
  const wrapper = document.getElementById('pageWrapper');
  updateScanlineOverlay(scanlineOverlay, chaos);
  stepJitter(wrapper, chaos);
  animateCRT(crtLine, document.querySelectorAll('.char'), chaos, Number.parseFloat(crtLine.style.bottom) || 1);
  noise.setChaos(chaos / 30);
  bgController.setWitnessCount(witness);
  updateBackgroundVideo();
}

function getBackgroundVideo() {
  return chaos >= 2 ? './images/bck_strong.mp4' : './images/bck_calm.mp4';
}

function updateBackgroundVideo() {
  const newSource = getBackgroundVideo();
  if (newSource === currentVideoSource) return;
  currentVideoSource = newSource;

  const firstVideo = document.getElementById('bgVideo1');
  const secondVideo = document.getElementById('bgVideo2');
  const current = currentVideo === 1 ? firstVideo : secondVideo;
  const next = currentVideo === 1 ? secondVideo : firstVideo;

  next.src = newSource;
  next.currentTime = 0;
  next.style.opacity = 0;
  next.play().catch(() => {});
  next.style.transition = 'opacity 5s';
  current.style.transition = 'opacity 5s';
  next.style.opacity = 1;
  current.style.opacity = 0;

  currentVideo = currentVideo === 1 ? 2 : 1;
  setTimeout(() => current.pause(), 1000);
}
