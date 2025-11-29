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
}

// optional getters/setters for external code
export function setWitness(v, trigger=true){ witness = Number(v||0); document.getElementById('witnessCounter').textContent = witness; saveSettings(); bgController.setWitnessCount(witness, trigger); }
export function setChaos(v){ chaos = Number(v||0); document.getElementById('chaosCounter').textContent = chaos; updateEffects(); saveSettings(); }
export function getWorld(){ return { witness, chaos }; }


function setBackground(src) {
  const bg = document.getElementById('backgroundHue');
  bg.style.backgroundImage = `url('${src}')`;
}

