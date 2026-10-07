// silence.js
// "Silenzio di Tomba": the anomaly that stops every sound, and with it the heart. While the
// setting is on (Effects tab of /settings; every open viewer follows it) the tracker's own
// sounds are swallowed and a signed-in display loses its colour, the more the higher Chaos
// stands (silence.css).
// The heart is the Manager's to play from /settings: switched on it fades in and beats at
// the rate set there, heard, drawn as a trace under the title, and letting a breath of
// colour through on each beat; a merit lands as one strong beat, a demerit as a missed one.
// Switched off, it fades away. "Trigger a flatline" makes it falter while darkness closes in
// from the edges, then stops it: the display stops too, fully black and white, under the
// long tone of a heart monitor, until the heart fades back in and everything moves again.
// No tracker data or control is touched.

import { getConfig, onConfigChange } from './config.js';
import { chaosIntensity, setChaosEffectsMuted } from './effects.js';
import { motionAllowed } from './motion.js';
import { isMuted, setSoundSwallow } from './soundEffects.js';
import { getAudioContext } from './synth.js';

const STRONG = 1.5;       // a merit
const R_WAVE = 0.155;     // s into a beat's trace: its spike, and when it is heard and seen
const FALTER = 1.3;       // while darkness closes in, each beat comes this much later than the last
const FLATLINE_HZ = 985;  // the monitor's tone while the heart is stopped
const SWEEP = 150;        // px/s of the trace
const ERASER = 22;        // px cleared ahead of the trace, as on a monitor

const root = document.documentElement;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

let settings = getConfig().effects.silence;
let seenFlatline = settings.flatlineAt;   // the last trigger from /settings this viewer has acted on
let on = false;
let heartOn = false;    // the heartbeat switch
let beating = false;    // the heart is there: also while it fades out, or is stopped by a flatline
let phase = null;       // of a flatline: 'failing' (darkness closing in), then 'flat'
// How present the heart is, 0 to 1: `from` at time `at`, on its way to `to`. It fades in when
// switched on and after a flatline, and out when switched off.
const fade = { from: 0, to: 0, at: 0 };
let fadeTimer = 0;      // the end of a fade-out
let beatTimer = 0;
let phaseTimer = 0;
let greyTimer = 0;
let interval = 1;       // s between the last two beats
let stretch = 1;        // how far apart a failing heart's beats have grown
let failUntil = 0;      // when a failing heart stops
let missed = 0;         // beats still to skip for demerits
let frozen = [];        // looping animations and videos held still while flat
let tone = null;        // the monitor's tone while flat: { oscillator, gain, watch }
let veil = null;
let breath = null;      // the veil's animation for the latest beat
const beats = [];       // { at, strength } of the latest beats, for the trace
const trace = { canvas: null, ctx: null, w: 0, h: 0, x: 0, y: 0, time: 0, frame: 0 };

/** Shown and heard only on a signed-in display: the login screen keeps its own sounds. */
const live = () => on && root.dataset.session === 'open';

/* ---------- colour ---------- */
/** How black and white the display is (0 to 1): a floor, and more as chaos rises. */
function showGrey() {
  const grey = clamp(settings.baseGrey + settings.chaosGrey * chaosIntensity(), 0, 1).toFixed(3);
  if (root.style.getPropertyValue('--silence-grey') !== grey) root.style.setProperty('--silence-grey', grey);
}

/** A breath of colour: the veil thins for a moment. */
function breathe(strength) {
  if (!motionAllowed()) return;
  breath?.cancel();   // a beat on the heels of the last one starts from the veil as it stands
  const held = Number(getComputedStyle(veil).opacity);
  breath = veil.animate(
    [{ opacity: held }, { opacity: held * clamp(1 - 0.45 * strength, 0.1, 1), offset: 0.16 }, { opacity: held }],
    { duration: Math.min(620, interval * 900), easing: 'ease-out' }
  );
}

/* ---------- the trace ---------- */
const bump = (x, at, width) => Math.exp(-(((x - at) / width) ** 2));

/** One beat of the trace, x seconds in: P wave, the QRS spike (1 at R_WAVE), T wave. */
const complex = x => 0.13 * bump(x, 0.05, 0.022) - 0.14 * bump(x, 0.132, 0.009) + bump(x, R_WAVE, 0.0085)
  - 0.3 * bump(x, 0.18, 0.011) + 0.27 * bump(x, 0.37, 0.042);

/** The trace's height at a time: the latest beats laid over each other, nothing while flat. */
function traceLevel(time) {
  let level = 0;
  for (const beat of beats) {
    const x = (time - beat.at) / 1000;
    if (x >= 0 && x < 0.6) level += Math.min(beat.strength, 1.25) * complex(x);
  }
  return level;
}

function traceY(level) {
  return trace.h * 0.66 - trace.h * 0.5 * clamp(level, -0.6, 1.25);
}

function fitTrace() {
  const { canvas } = trace;
  const bounds = canvas.getBoundingClientRect();
  trace.w = Math.round(bounds.width);
  trace.h = Math.round(bounds.height);
  if (!trace.w || !trace.h) return;
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = Math.round(trace.w * dpr);
  canvas.height = Math.round(trace.h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  // the glow is the one thing with a colour of its own, so it shows on the beat
  ctx.shadowColor = getComputedStyle(root).getPropertyValue('--competency-color').trim() || '#ff3b30';
  ctx.shadowBlur = 9;
  trace.ctx = ctx;
  trace.x = 0;
  trace.y = traceY(0);
  if (!motionAllowed()) drawStill();
}

/** Reduced motion: one beat, standing still. */
function drawStill() {
  const { ctx, w, h } = trace;
  ctx.clearRect(0, 0, w, h);
  ctx.beginPath();
  for (let x = 0; x <= w; x++) ctx.lineTo(x, traceY(complex((x - w / 2) / SWEEP + R_WAVE)));
  ctx.stroke();
}

/** The trace sweeps left to right, wiping what the last pass left just ahead of itself. */
function drawTrace(now) {
  trace.frame = requestAnimationFrame(drawTrace);
  let travel = Math.min(0.1, (now - trace.time) / 1000) * SWEEP;
  trace.time = now;
  if (!live() || !trace.w) return;
  const { ctx, w, h } = trace;
  while (travel > 0) {
    const step = Math.min(1, travel);
    travel -= step;
    if (trace.x >= w) trace.x = 0;
    const x = trace.x + step;
    const y = traceY(traceLevel(now - (travel / SWEEP) * 1000));
    ctx.clearRect(x, 0, ERASER, h);
    ctx.beginPath();
    ctx.moveTo(trace.x, trace.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    trace.x = x;
    trace.y = y;
  }
}

/* ---------- one beat ---------- */
// One half of a heartbeat: a low thud, and a softer octave above it that small speakers can carry.
function thud(ac, out, t, pitch, level) {
  [[1, 'sine', 0.8, 0.2], [2, 'triangle', 0.3, 0.11]].forEach(([octave, type, share, decay]) => {
    const oscillator = ac.createOscillator();
    const gain = ac.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(pitch * octave, t);
    oscillator.frequency.exponentialRampToValueAtTime(pitch * octave * 0.48, t + 0.11);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(level * share, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    oscillator.connect(gain).connect(out);
    oscillator.start(t);
    oscillator.stop(t + decay + 0.03);
  });
}

/** "Lub-dub", the second half closer behind the first as the heart speeds up. */
function sound(strength) {
  const volume = settings.volume * (Number(getConfig().sounds.masterVolume) || 0);
  if (isMuted() || volume <= 0) return;
  try {
    const ac = getAudioContext();
    const out = ac.createGain();
    out.gain.value = 0.85 * Math.min(1, volume * strength);
    out.connect(ac.destination);
    const t = ac.currentTime + 0.01;
    const gap = Math.min(0.3, interval * 0.36);
    thud(ac, out, t, 104, 1);
    thud(ac, out, t + gap, 128, 0.6);
    setTimeout(() => out.disconnect(), (gap + 0.4) * 1000);
  } catch {
    /* no audio (or powered off at log out): the trace and the colour still beat */
  }
}

function pulse(strength = 1) {
  const here = presence();
  if (here <= 0.01) return;
  beats.push({ at: performance.now(), strength: strength * here });
  if (beats.length > 6) beats.shift();
  // heard and seen as the trace reaches its spike
  setTimeout(() => {
    if (!live() || phase === 'flat') return;
    sound(strength * here * here);   // squared: a fade that sounds even to the ear
    breathe(strength * here);
  }, R_WAVE * 1000);
}

/* ---------- the heart ---------- */
const fadeSeconds = () => Math.max(0, Number(settings.fadeSeconds) || 0);

function presence() {
  const seconds = fadeSeconds();
  if (!seconds) return fade.to;
  const moved = (performance.now() - fade.at) / (seconds * 1000);
  return fade.to > fade.from ? Math.min(fade.to, fade.from + moved) : Math.max(fade.to, fade.from - moved);
}

function fadeTo(target, from = presence()) {
  Object.assign(fade, { from, to: target, at: performance.now() });
}

function wait() {
  // all but steady: a heart, not a metronome
  interval = (60 / clamp(settings.bpm, 20, 240)) * stretch * (0.97 + Math.random() * 0.06);
  beatTimer = setTimeout(beat, interval * 1000);
}

function beat() {
  if (!live()) {
    beatTimer = setTimeout(beat, 1000);   // behind the login screen: nothing to hear yet
    return;
  }
  if (missed > 0) missed -= 1;
  else pulse(1 / stretch);
  if (phase === 'failing') {
    // each beat weaker and later than the last; the one that would come too late never does
    stretch *= FALTER;
    if (performance.now() + (60 / clamp(settings.bpm, 20, 240)) * stretch * 1000 > failUntil) return;
  }
  wait();
}

function startBeating() {
  beating = true;
  root.classList.add('silence-heart');
  fitTrace();
  if (motionAllowed()) {
    trace.time = performance.now();
    trace.frame = requestAnimationFrame(drawTrace);
  }
  // a flatline in progress keeps hold of the heart until it is over
  if (phase !== 'flat') beatTimer = setTimeout(beat, 700);
}

function stopBeating() {
  beating = false;
  root.classList.remove('silence-heart');
  clearTimeout(beatTimer);
  cancelAnimationFrame(trace.frame);
  beats.length = 0;
  missed = 0;
}

/** Follow the heartbeat switch: the heart fades in, and fades out before it goes. */
function syncHeart() {
  const wanted = on && settings.heartbeat;
  if (wanted === heartOn) return;
  heartOn = wanted;
  clearTimeout(fadeTimer);
  if (heartOn) {
    fadeTo(1);
    if (!beating) startBeating();
    return;
  }
  // With the whole effect switched off there is nothing to fade under: it stops at once.
  const left = on ? fadeSeconds() * presence() : 0;
  fadeTo(0);
  if (left > 0) fadeTimer = setTimeout(stopBeating, left * 1000);
  else stopBeating();
}

/* ---------- a flatline ---------- */
/** The monitor's long tone, for as long as the heart is stopped. */
function startTone() {
  const volume = settings.flatlineVolume * (Number(getConfig().sounds.masterVolume) || 0);
  if (isMuted() || volume <= 0) return;
  try {
    const ac = getAudioContext();
    const oscillator = ac.createOscillator();
    const gain = ac.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = FLATLINE_HZ;
    gain.gain.setValueAtTime(0.0001, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.3 * Math.min(1, volume), ac.currentTime + 0.04);
    oscillator.connect(gain).connect(ac.destination);
    oscillator.start();
    // muting the viewer ends it at once, not at the end of the flatline
    tone = { oscillator, gain, watch: setInterval(() => { if (isMuted()) stopTone(); }, 200) };
  } catch {
    /* no audio: a silent flatline */
  }
}

function stopTone() {
  if (!tone) return;
  const { oscillator, gain, watch } = tone;
  tone = null;
  clearInterval(watch);
  try {
    const now = gain.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    oscillator.stop(now + 0.1);
  } catch {
    /* the audio was powered off at log out */
  }
}

/** Triggered from /settings: the heart falters while darkness closes in, then stops. */
function fail() {
  if (!live() || phase) return;
  const seconds = Math.max(0, Number(settings.failSeconds) || 0);
  phase = 'failing';
  stretch = 1;
  failUntil = performance.now() + seconds * 1000;
  root.style.setProperty('--silence-fail', `${seconds}s`);
  root.classList.add('silence-failing');
  phaseTimer = setTimeout(flatline, seconds * 1000);
}

/** The heart is stopped, and the display with it. */
function flatline() {
  phase = 'flat';
  clearTimeout(beatTimer);
  startTone();
  root.classList.add('silence-flatline');
  root.classList.remove('silence-failing');
  setChaosEffectsMuted(true, 'silence');
  if (motionAllowed()) {
    // Only what loops is held: a dialog or a card that is just arriving still arrives.
    const loops = document.getAnimations()
      .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().iterations === Infinity);
    const videos = [...document.querySelectorAll('#backgroundHue video')].filter(video => !video.paused);
    [...loops, ...videos].forEach(moving => moving.pause());
    frozen = [...loops, ...videos];
  }
  phaseTimer = setTimeout(() => {
    revive();
    // the heart comes back from nothing, the way it does when it is switched on
    if (beating && heartOn) {
      fadeTo(1, 0);
      beatTimer = setTimeout(beat, 400);
    }
  }, Math.max(1, Number(settings.flatlineSeconds) || 0) * 1000);
}

/** Leave a flatline, whichever part of it was reached: darkness lifts and the display moves again. */
function revive() {
  clearTimeout(phaseTimer);
  phase = null;
  stretch = 1;
  stopTone();
  root.classList.remove('silence-failing', 'silence-flatline');
  setChaosEffectsMuted(false, 'silence');
  frozen.forEach(moving => {
    // a background video that was faded out meanwhile stays paused, as world.js left it
    if (moving instanceof HTMLVideoElement && getComputedStyle(moving).opacity === '0') return;
    try { void moving.play()?.catch?.(() => {}); } catch { /* an animation that has ended since */ }
  });
  frozen = [];
}

/** A sound the tracker asked for and did not get: a beating heart takes some of them instead. */
function felt(event) {
  if (!beating || phase) return;
  if (event === 'demerit' || event === 'prime') {
    missed = Math.min(2, missed + 1);
  } else if (event === 'merit' || event === 'encouraged') {
    clearTimeout(beatTimer);
    pulse(STRONG);
    wait();
  }
}

function start() {
  on = true;
  root.classList.add('silence');
  showGrey();
  // chaos moves on its own counter; this just keeps up with it
  greyTimer = setInterval(showGrey, 400);
}

function stop() {
  on = false;
  clearInterval(greyTimer);
  if (phase) revive();
  root.classList.remove('silence');
}

/** Viewer only: follow the settings. Call once they have loaded and the title is built. */
export function initSilence() {
  const title = document.querySelector('h1');
  if (!title) return;

  const layer = id => {
    const element = document.createElement('div');
    element.id = id;
    element.setAttribute('aria-hidden', 'true');
    document.body.appendChild(element);
    return element;
  };
  layer('silenceVignette');
  veil = layer('silenceVeil');

  trace.canvas = document.createElement('canvas');
  trace.canvas.className = 'silence-trace';
  trace.canvas.setAttribute('aria-hidden', 'true');
  title.appendChild(trace.canvas);
  // also when it first shows: it has no size behind the login screen
  if (window.ResizeObserver) new ResizeObserver(() => { if (beating) fitTrace(); }).observe(trace.canvas);

  setSoundSwallow(event => {
    if (!live()) return false;
    if (event) felt(event);
    return true;
  });

  onConfigChange(config => {
    settings = config.effects.silence;
    if (settings.enabled !== on) {
      if (settings.enabled) start();
      else stop();
    }
    if (on) showGrey();
    syncHeart();
    // A new moment on the trigger is one flatline. A viewer that is off, or still behind the
    // login screen, lets it pass.
    if (settings.flatlineAt !== seenFlatline) {
      seenFlatline = settings.flatlineAt;
      if (settings.flatlineAt) fail();
    }
  });
}
