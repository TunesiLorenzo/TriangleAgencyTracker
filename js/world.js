// world.js
import { backgroundhue } from './witnesseffects.js';
import { stepJitter, animateCRT, updateScanlineOverlay } from './effects.js';
import { noise } from './noise.js';
import { saveSettings, loadSettings } from './storage.js';
import { updateTopCharacters } from './charSystem.js';

const bgController = backgroundhue(document.getElementById('backgroundHue'));
const crtLine = document.getElementById('crtScanline');
const scanlineOverlay = document.getElementById('scanlineOverlay');

let witness = 0, chaos = 0, branchName = '';

export function initWorld() {
  const branchName = document.getElementById('branchName');
  const witnessEl = document.getElementById('witnessCounter');
  const chaosEl = document.getElementById('chaosCounter');

  witnessEl?.addEventListener('click', () => {
    witness++; witnessEl.textContent = witness; saveSettings(); bgController.setWitnessCount(witness,true);
  });
  witnessEl?.addEventListener('contextmenu', e => {
    e.preventDefault(); witness = Math.max(0,witness-1); witnessEl.textContent=witness; saveSettings(); bgController.setWitnessCount(witness);
  });

  chaosEl?.addEventListener('click', () => { chaos++; chaosEl.textContent = chaos; updateEffects(); saveSettings(); });
  chaosEl?.addEventListener('contextmenu', e => { e.preventDefault(); chaos = Math.max(0, chaos-1); chaosEl.textContent = chaos; updateEffects(); saveSettings(); });

  // start noise default
  noise.setDensity(0.5);
  noise.setColor('rgba(255,255,255,0.01)');
  noise.start();
}

export function setWorldData(data) {
  branchName = (data?.branchName || 0);
  witness = Number(data?.witness || 0);
  chaos = Number(data?.chaos || 0);
  
  document.getElementById('branchName').value = branchName;
  document.getElementById('witnessCounter').textContent = witness;
  document.getElementById('chaosCounter').textContent = chaos;
  bgController.setWitnessCount(witness);
  updateEffects();
}

export function updateEffects() {
  const chaosVal = chaos;
  const wrapper = document.getElementById('pageWrapper');
  updateScanlineOverlay(scanlineOverlay, chaosVal);
  stepJitter(wrapper, chaosVal);
  animateCRT(crtLine, document.querySelectorAll('.char'), chaosVal, parseFloat(crtLine.style.bottom) || 1);
  noise.setChaos(chaosVal / 30);
  bgController.setWitnessCount(witness);
  updateBackgroundVideo();
}

// optional getters/setters for external code
export function setWitness(v, trigger=true){ witness = Number(v||0); document.getElementById('witnessCounter').textContent = witness; saveSettings(); bgController.setWitnessCount(witness, trigger); }
export function setChaos(v){ chaos = Number(v||0); document.getElementById('chaosCounter').textContent = chaos; updateEffects(); saveSettings(); }
export function getWorld(){ return { witness, chaos }; }


function setBackground(src) {
  const bg = document.getElementById('backgroundHue');
  bg.style.backgroundImage = `url('${src}')`;
}

// world.js
// Returns a video filename (relative path) based on chaos level (number)
export function getBackgroundVideo() {
	const world = getWorld();
	const chaos = world.chaos;
	// Example thresholds — tweak paths & thresholds as needed
	// chaos: 0..100 (or whatever your scale is)
	if (chaos >= 80) return './images/bck_chaos_high.mp4';
	if (chaos >= 50) return './images/bck_chaos_mid.mp4';
	if (chaos >= 2) return './images/bck_strong.mp4';
	return './images/bck_calm.mp4';
	
}

let currentVideo = 1; // 1 = bgVideo1 visible, 2 = bgVideo2 visible
let currentSrc = '';  // track currently displayed video

export function updateBackgroundVideo() {
  const newSrc = getBackgroundVideo();
  if (newSrc === currentSrc) return; // no change
  currentSrc = newSrc;

  const v1 = document.getElementById('bgVideo1');
  const v2 = document.getElementById('bgVideo2');

  const current = currentVideo === 1 ? v1 : v2;
  const next = currentVideo === 1 ? v2 : v1;

  next.src = newSrc;
  next.currentTime = 0;
  next.style.opacity = 0;
  next.play();

  // Fade animation
  next.style.transition = "opacity 5s";
  current.style.transition = "opacity 5s";
  next.style.opacity = 1;
  current.style.opacity = 0;

  currentVideo = currentVideo === 1 ? 2 : 1;
  setTimeout(() => current.pause(), 1000); // pause old video after fade
}