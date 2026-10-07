// effects.js
// Atmosphere controller. Chaos is turned into ONE normalized intensity (0..1)
// that eases toward its target over time, and every chaos-driven layer is
// derived from that single value: page jitter + glitch bursts, the sweeping
// CRT band, the scanline overlay, film grain and the readability vignette.
// At high Mission Risk, bursts also become "critical glitches": red/blue
// colour fringes across the page and a torn title.
// All tuning comes from /settings (config.effects); one loop runs for the page.

import { DEFAULT_CONFIG, RISK_LEVELS, onConfigChange } from './config.js';
import { motionAllowed } from './motion.js';
import { noise } from './noise.js';
import { playEvent } from './soundEffects.js';

const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

let tuning = structuredClone(DEFAULT_CONFIG.effects);

const state = {
  chaos: 0,
  target: 0,   // intensity requested by the current chaos value
  muted: false, // the G.R.A. takeover can replace these layers with its own incidents
  level: 0,    // eased intensity actually rendered
  risk: 'controlled',
  lastTime: 0,
  running: false,
  els: {},
  crtBottom: 0,
  appliedLevel: -1
};

const jitter = { x: 0, y: 0, r: 0, tx: 0, ty: 0, tr: 0, nextRetarget: 0, burstUntil: 0, glitching: false };

const rand = () => Math.random() * 2 - 1;
const easeFactor = (dt, tau) => 1 - Math.exp(-dt / Math.max(0.001, tau));

function glitchActive() {
  const glitch = tuning.glitch;
  return !state.muted && glitch.enabled && motionAllowed()
    && RISK_LEVELS.indexOf(state.risk) >= RISK_LEVELS.indexOf(glitch.minRisk);
}

/* ---------- layers driven by the eased level ---------- */

// Styles that depend only on the level; skipped when the level hasn't moved.
function applyLevelStyles(level) {
  // Small moves are skipped, except the last one down to nothing: off means fully off.
  const landing = level === 0 && state.appliedLevel !== 0;
  if (!landing && Math.abs(level - state.appliedLevel) < 0.002) return;
  state.appliedLevel = level;
  const { scanline, overlay, vignette } = state.els;
  const a = tuning.atmosphere;

  const root = document.documentElement.style;
  root.setProperty('--chaos-level', level.toFixed(3));
  root.setProperty('--panel-blur', `${(level * a.panelBlur).toFixed(2)}px`);

  if (scanline) {
    scanline.style.height = `${10 + 70 * level}px`;
    scanline.style.opacity = motionAllowed() ? (level * 0.8).toFixed(3) : 0;
    scanline.style.background = 'rgba(255,255,255,0.05)';
    scanline.style.boxShadow = `0 0 ${4 + 146 * level}px rgba(255,255,255,0.4)`;
  }
  if (overlay) overlay.style.opacity = (level * a.scanlines).toFixed(3);
  if (vignette) vignette.style.opacity = (level * a.vignette).toFixed(3);
  noise.setIntensity(level * a.grain);
}

function setGlitching(on) {
  if (jitter.glitching === on) return;
  jitter.glitching = on;
  state.els.wrapper?.classList.toggle('glitching', on);
  state.els.title?.classList.toggle('title-tear', on && tuning.glitch.titleTear);
  if (on) playEvent('glitch');
}

// Smoothed drift toward random targets, plus occasional sharp bursts whose
// frequency rises with intensity (and with high Mission Risk).
function updateJitter(now, dt, level) {
  const { wrapper } = state.els;
  if (!wrapper) return;
  const shake = tuning.shake;
  const critical = glitchActive();

  if (!motionAllowed() || (level < 0.002 && !critical)) {
    if (wrapper.style.transform) wrapper.style.transform = '';
    Object.assign(jitter, { x: 0, y: 0, r: 0, tx: 0, ty: 0, tr: 0 });
    setGlitching(false);
    return;
  }

  let bursting = now < jitter.burstUntil;
  if (!bursting) {
    setGlitching(false);
    const rate = (shake.enabled ? shake.burstsPerSecond * level * level : 0)
      + (critical ? tuning.glitch.burstsPerSecond : 0);
    if (Math.random() < dt * rate) {
      jitter.burstUntil = now + 70 + Math.random() * 150;
      jitter.nextRetarget = 0;
      bursting = true;
      if (critical) setGlitching(true);
    }
  }

  // Critical glitches shake even at low chaos, at no less than 40% strength.
  const strength = Math.max(level, jitter.glitching ? 0.4 : 0);
  const shakeOn = shake.enabled || jitter.glitching;
  if (now >= jitter.nextRetarget) {
    const amp = !shakeOn ? 0 : bursting ? 1.5 + shake.burstSize * strength : shake.drift * level;
    const rot = !shakeOn ? 0 : bursting ? shake.burstRotation * strength : shake.driftRotation * level;
    jitter.tx = rand() * amp;
    jitter.ty = rand() * amp;
    jitter.tr = rand() * rot;
    jitter.nextRetarget = now + (bursting ? 30 : 180 - 110 * level);
  }

  const k = easeFactor(dt, bursting ? 0.02 : 0.09);
  jitter.x += (jitter.tx - jitter.x) * k;
  jitter.y += (jitter.ty - jitter.y) * k;
  jitter.r += (jitter.tr - jitter.r) * k;
  wrapper.style.transform = `translate(${jitter.x.toFixed(2)}px, ${jitter.y.toFixed(2)}px) rotate(${jitter.r.toFixed(3)}deg)`;
}

// The CRT band sweeps upward faster as intensity rises.
function updateCrt(dt, level) {
  const { scanline } = state.els;
  if (!scanline || level < 0.002 || !motionAllowed()) return;
  state.crtBottom += (90 + tuning.atmosphere.crtSpeed * level) * dt;
  if (state.crtBottom > window.innerHeight) state.crtBottom = 0;
  scanline.style.bottom = `${state.crtBottom.toFixed(1)}px`;
}

function frame(now) {
  // Clamp dt so returning to a background tab doesn't jump everything.
  const dt = Math.min(0.1, Math.max(0, (now - (state.lastTime || now)) / 1000));
  state.lastTime = now;

  const goal = state.muted ? 0 : state.target;
  state.level += (goal - state.level) * easeFactor(dt, tuning.atmosphere.easeSeconds);
  if (Math.abs(goal - state.level) < 0.001) state.level = goal;

  applyLevelStyles(state.level);
  updateJitter(now, dt, state.level);
  updateCrt(dt, state.level);

  requestAnimationFrame(frame);
}

function updateTarget() {
  const maxChaos = Math.max(1, Number(tuning.atmosphere.maxChaos) || 16);
  state.target = Math.min(1, Math.max(0, state.chaos / maxChaos));
}

/** Bind the effect targets and start the single animation loop. */
export function initEffects({ wrapper, scanline, overlay, vignette, title }) {
  state.els = { wrapper, scanline, overlay, vignette, title };
  if (title) buildTitleLayers(title);

  noise.setDensity(0.5);
  noise.setColor('rgba(255,255,255,0.01)');
  noise.start();

  onConfigChange(config => {
    tuning = config.effects;
    noise.setFps(tuning.atmosphere.grainFps);
    document.documentElement.style.setProperty('--rgb-split', `${tuning.glitch.rgbSplit}px`);
    state.appliedLevel = -1;
    updateTarget();
  });

  // Mission Risk comes from the dashboard.
  document.addEventListener('risk-changed', event => { state.risk = event.detail.level; });

  // Re-apply level styles when the reduced-motion preference flips.
  reducedMotion?.addEventListener?.('change', () => { state.appliedLevel = -1; });

  if (!state.running) {
    state.running = true;
    requestAnimationFrame(frame);
  }
}

// Two colour-shifted copies of the title, shown only while it tears.
function buildTitleLayers(title) {
  if (title.querySelector('.tear-layer')) return;
  title.classList.add('tearable');
  const html = title.innerHTML;
  ['tear-red', 'tear-blue'].forEach(kind => {
    const layer = document.createElement('span');
    layer.className = `tear-layer ${kind}`;
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = html;
    title.appendChild(layer);
  });
}

/** The intensity (0..1) the current chaos value asks for, before easing and whether or not it is shown. */
export function chaosIntensity() {
  return state.target;
}

const mutedBy = new Set();

/**
 * Hide every chaos layer of this module (atmosphere, shake, critical glitch) and the chaos
 * pulse, without losing the chaos value: the G.R.A. takeover does this when it is set to
 * show chaos through its own incidents only, and "Silenzio di Tomba" while the heart is
 * stopped. Each `source` mutes on its own account; the layers return when none is left.
 */
export function setChaosEffectsMuted(muted, source = 'gra') {
  if (muted) mutedBy.add(source);
  else mutedBy.delete(source);
  state.muted = mutedBy.size > 0;
  document.documentElement.classList.toggle('chaos-effects-muted', state.muted);
}

/** Set the chaos value; the rendered intensity eases toward it. */
export function setEffectsChaos(chaos) {
  state.chaos = Number(chaos) || 0;
  updateTarget();
}
