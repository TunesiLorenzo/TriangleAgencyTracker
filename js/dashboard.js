// dashboard.js
// Mission-performance dashboard: Agent Performance, Mission Timeline, Mission Risk.
// Renders onto the existing three canvases; timeline history persists in localStorage
// under world.timeline (same store the rest of the app uses).

import { getAgentStats } from './charSystem.js';
import { loadSettings, updateSettings } from './storage.js';
import { motionAllowed } from './motion.js';
import { isMeritLocked } from './meritLock.js';

const MAX_TIMELINE = 150;
const MAX_VISIBLE_TIMELINE = 40;
const MAX_WITNESSES = 20; // matches witnesseffects.js's maxWitnesses
const MAX_CHAOS = 16;     // matches effects.js's chaosToIntensity scale

const rootStyles = getComputedStyle(document.documentElement);
const COLOR_MERIT = rootStyles.getPropertyValue('--competency-color').trim() || '#ff3b30';
const COLOR_DEMERIT = rootStyles.getPropertyValue('--anomaly-color').trim() || '#0a84ff';
const COLOR_CHAOS = rootStyles.getPropertyValue('--reality-color').trim() || '#ffd60a';
const COLOR_WITNESS = rootStyles.getPropertyValue('--witness-color').trim() || '#bf5af2';
const COLOR_GOLD = rootStyles.getPropertyValue('--gold-border').trim() || 'gold';

// Sealed merits (meritLock.js): the Agent Performance bars drift around their real length,
// so a standing can be guessed from the chart but a count cannot be read off it.
const SEAL_FLOOR = 0.11;   // where an empty bar rests, as a share of its track: "none" cannot be read either
const SEAL_REACH = 0.56;   // how much further along the longest bar rests, leaving room to overshoot
const SEAL_DRIFT = 0.33;   // how far a bar wanders either way: over half the gap between empty and longest
const SEAL_EASE_MS = 700;  // the drift fades in on lock and settles onto the real bars on reveal
const SEAL_VISIBLE_FPS = 20; // the drift is slow; 60 full canvas redraws/s add no useful detail
const SEAL_HIDDEN_FPS = 2;
// A status line under the sealed bars, which never quite settles either.
const SEAL_NOTES = ['MERIT FLUX CONTINUUM NOT CONVERGED', 'AGENT BEHAVIOR: PROBABILISTIC PROJECTION'];
const SEAL_NOTE_SECONDS = 7;   // each note resolves out of noise, holds, then breaks up for the next
const SEAL_NOTE_FONT = 'ui-monospace, Consolas, monospace';
const SEAL_NOISE = '▲▼△▽◢◣#%/\\<>=+01';
// the padlock the sealed triangles wear (components.css)
const PADLOCK = new Path2D('M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zm2.5 0h5V7a2.5 2.5 0 0 0-5 0z');

let timeline = [];
let lastRiskLevel = null;
let lastChaosBucket = 0;
let sealed = false;
let sealAmount = 0;        // 0 = real bars, 1 = full drift
let sealFrame = 0;
let sealTimer = 0;
let sealTick = 0;          // time of the previous drift frame
const els = {};

/* ---------- timeline persistence (world.timeline in localStorage) ---------- */
function persistTimeline() {
  updateSettings(settings => { settings.world.timeline = timeline; });
}

/* ---------- crisp canvases on HiDPI screens ----------
   Draw at the canvas's actual layout size, which changes with the dashboard
   grid, then scale the backing store for the display's pixel density. */
function setupCanvas(canvas) {
  const bounds = canvas.getBoundingClientRect();
  const logical = {
    w: Math.max(1, Math.round(bounds.width || canvas.width)),
    h: Math.max(1, Math.round(bounds.height || canvas.height))
  };
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.style.setProperty('--canvas-w', `${logical.w}px`);
  canvas.width = Math.round(logical.w * dpr);
  canvas.height = Math.round(logical.h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, ...logical };
}

function currentTotals() {
  const stats = getAgentStats();
  const merit = stats.reduce((sum, s) => sum + s.merit, 0);
  const demerit = stats.reduce((sum, s) => sum + s.demerit, 0);
  const witness = Number(document.getElementById('witnessCounter')?.textContent || 0);
  const chaos = Number(document.getElementById('chaosCounter')?.textContent || 0);
  return { merit, demerit, witness, chaos };
}

function numericValue(point, key) {
  const value = Number(point?.[key]);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function fittedAxisMax(value) {
  if (!Number.isFinite(value) || value <= 1) return 1;
  return Math.ceil(value);
}

function pushEvent({ label, isTask = false, witnessMarker = false } = {}) {
  timeline.push({ t: Date.now(), label, isTask, witnessMarker, ...currentTotals() });
  if (timeline.length > MAX_TIMELINE) timeline.shift();
  persistTimeline();
  renderTimeline();
}

/* ---------- restrained event effects ---------- */
/** A "+1" (or "−1") rising from the triangle that was clicked. */
function floatScore(triangle, type, delta) {
  const card = triangle?.closest('.char');
  if (!card || !motionAllowed()) return;
  const from = triangle.getBoundingClientRect();
  const box = card.getBoundingClientRect();
  const label = document.createElement('span');
  label.className = `fx-float ${type}`;
  label.textContent = delta < 0 ? '−1' : '+1';
  label.style.left = `${from.left - box.left + from.width / 2}px`;
  label.style.top = `${from.top - box.top}px`;
  label.setAttribute('aria-hidden', 'true');
  card.appendChild(label);
  label.addEventListener('animationend', () => label.remove());
  setTimeout(() => label.remove(), 1500);
}

function flash(el, className) {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  // Ignore animationend events bubbling up from children (e.g. the triangle pop),
  // which previously cut the card flash short.
  el.addEventListener('animationend', function handler(event) {
    if (event.target !== el) return;
    el.classList.remove(className);
    el.removeEventListener('animationend', handler);
  });
}

/* ---------- risk ---------- */
function computeRisk() {
  const witness = Number(document.getElementById('witnessCounter')?.textContent || 0);
  const chaos = Number(document.getElementById('chaosCounter')?.textContent || 0);
  const witnessRatio = Math.min(1, Math.max(0, witness / MAX_WITNESSES));
  const chaosRatio = Math.min(1, Math.max(0, chaos / MAX_CHAOS));
  // The mission level is based on the combined threat, while the two rings keep
  // showing Witnesses and Chaos independently.
  const score = witness + chaos;

  let level = 'CONTROLLED';
  if (score >= 18) level = 'CATASTROPHIC';
  else if (score >= 11) level = 'CRITICAL';
  else if (score >= 6) level = 'COMPROMISED';
  else if (score >= 2) level = 'UNSTABLE';

  return { witnessRatio, chaosRatio, score, level, witness, chaos };
}

/* ---------- sealed merits: drifting bars ---------- */
/** A smooth wander in [-1, 1]. Each bar has its own seed, so no two move together. */
function sealDrift(seconds, seed) {
  const t = seconds * (1 + ((seed * 3) % 7) * 0.07);
  return 0.38 * Math.sin(t * 0.37 + seed * 2.4)   // slow: the middle of the swing wanders too
       + 0.36 * Math.sin(t * 2.1 + seed * 4.1)
       + 0.26 * Math.sin(t * 4.7 + seed * 7.3);
}

/** A bar's length as a share of its track: the real share, or a drifting one while sealed. */
function barShare(value, maxVal, seconds, seed) {
  const real = value / maxVal;
  if (!sealAmount) return real;
  // abs: a short bar swinging past empty comes back up instead of sticking there
  const drifting = Math.abs(SEAL_FLOOR + real * SEAL_REACH + SEAL_DRIFT * sealDrift(seconds, seed));
  return real + (Math.min(1, Math.max(0.02, drifting)) - real) * sealAmount;
}

/** 0 to 1, always the same for a given pair: the status line's noise keeps no state between frames. */
function sealNoise(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** The status line under the sealed bars: each note resolves out of noise, holds, and breaks up again. */
function drawSealNote(ctx, w, cy, size, seconds) {
  const turn = seconds / SEAL_NOTE_SECONDS;
  const note = SEAL_NOTES[Math.floor(turn) % SEAL_NOTES.length];
  const age = (turn % 1) * SEAL_NOTE_SECONDS;
  const moving = motionAllowed();
  // Letters settle left to right over the first second and scatter over the last half second.
  // Reduced motion: the note is simply written out.
  const settled = moving ? Math.min(age / 1.1, (SEAL_NOTE_SECONDS - age) / 0.5) * note.length : note.length;
  const tick = Math.floor(seconds * 14);   // the noise changes 14 times a second

  // one cell per letter, shrunk together when the chart is too narrow for the note
  let fontPx = size;
  ctx.font = `bold ${fontPx}px ${SEAL_NOTE_FONT}`;
  let cell = ctx.measureText('M').width + 1;
  const fit = (w - 12) / (cell * note.length);
  if (fit < 1) {
    fontPx *= fit;
    cell *= fit;
    ctx.font = `bold ${fontPx}px ${SEAL_NOTE_FONT}`;
  }

  const x0 = w / 2 - (cell * (note.length - 1)) / 2;
  const glow = 0.9 + 0.1 * Math.sin(seconds * 2.2);
  ctx.textAlign = 'center';
  ctx.fillStyle = COLOR_GOLD;
  [...note].forEach((letter, i) => {
    if (letter === ' ') return;
    // a letter that has settled still slips now and then
    const loose = i >= settled || (moving && sealNoise(i, tick) < 0.003);
    ctx.globalAlpha = sealAmount * (loose ? 0.45 : glow);
    ctx.fillText(loose ? SEAL_NOISE[Math.floor(sealNoise(i + 0.5, tick) * SEAL_NOISE.length)] : letter, x0 + i * cell, cy);
  });
  ctx.globalAlpha = 1;
}

function scheduleSeal() {
  const visible = !document.hidden && !!els.hist.ctx.canvas.offsetParent;
  const fps = visible ? SEAL_VISIBLE_FPS : SEAL_HIDDEN_FPS;
  sealTimer = window.setTimeout(() => {
    sealTimer = 0;
    sealFrame = requestAnimationFrame(sealStep);
  }, 1000 / fps);
}

function sealStep(now) {
  sealFrame = 0;
  const step = (now - sealTick) / SEAL_EASE_MS;
  sealTick = now;
  sealAmount = Math.min(1, Math.max(0, sealAmount + (sealed ? step : -step)));
  const moving = sealed || sealAmount > 0;
  // The dashboard has no layout on other tabs. Keep time there at a very low
  // cadence, then return to 20 FPS as soon as the chart is visible.
  if (els.hist.ctx.canvas.offsetParent && !document.hidden) renderAgentPerformance();
  if (moving) scheduleSeal();
}

/** Follow the lock: animate at the chart's own modest cadence, and let a reveal settle. */
function runSeal() {
  if (!motionAllowed()) {
    sealAmount = sealed ? 1 : 0;
    renderAgentPerformance();
    return;
  }
  if (sealFrame || sealTimer) return;
  sealTick = performance.now();
  scheduleSeal();
}

/* ---------- Agent Performance (was: histogram) ---------- */
function renderAgentPerformance() {
  const { ctx, w, h } = els.hist;
  ctx.clearRect(0, 0, w, h);

  const stats = getAgentStats();
  if (!stats.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No agents', w / 2, h / 2);
    return;
  }

  // Three columns that never share space: names | bars (markers inside) | net score.
  const rows = Math.max(5, stats.length);
  const headerH = 16;
  // Sealed, the status line goes under the last agent: in the spare rows of a short team,
  // or in room the rows of a full one make for it.
  const noteH = Math.min(34, Math.max(22, Math.round(h * 0.15)));
  const rowH = (h - headerH - (stats.length < rows ? 0 : noteH * sealAmount)) / rows;
  const fontPx = Math.max(10, Math.min(13, Math.floor(rowH * 0.55)));
  const nameW = Math.min(150, Math.max(56, Math.round(w * 0.29)));
  const netW = 38;
  const markerW = 14;                                 // room for the crown / warning past a full bar
  const midX = nameW + (w - nameW - netW) / 2;
  const barMax = (w - nameW - netW) / 2 - markerW;
  const maxVal = Math.max(1, ...stats.map(s => Math.max(s.merit, s.demerit)));
  const seconds = performance.now() / 1000;

  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(sealed ? 'DEMERIT ← LOCKED → MERIT' : `DEMERIT ${maxVal} ← 0 → ${maxVal} MERIT`, midX, headerH / 2);

  // Longest prefix of the name that fits its column, with an ellipsis if cut.
  const fitName = text => {
    if (ctx.measureText(text).width <= nameW - 8) return text;
    let cut = text;
    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > nameW - 8) cut = cut.slice(0, -1);
    return `${cut}…`;
  };

  stats.forEach((s, i) => {
    const y0 = headerH + i * rowH;
    const cy = y0 + rowH / 2;

    if (s.isTopMerit || s.isTopDemerit) {
      ctx.strokeStyle = s.isTopDemerit ? '#ff9500' : COLOR_GOLD;
      ctx.lineWidth = 1;
      ctx.strokeRect(1.5, y0 + 1.5, w - 3, rowH - 3);
    }

    ctx.fillStyle = s.dead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
    ctx.font = `${fontPx}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(fitName(s.name || `Agent ${i + 1}`), 5, cy);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(midX, y0 + 3); ctx.lineTo(midX, y0 + rowH - 3); ctx.stroke();

    const meritW = barShare(s.merit, maxVal, seconds, i * 2) * barMax;
    const demeritW = barShare(s.demerit, maxVal, seconds, i * 2 + 1) * barMax;
    const barH = Math.max(4, Math.min(10, rowH * 0.32));
    // The meter on the agent's card wanders with its bars (components.css moves the split).
    if (sealAmount) {
      const meterDrift = sealDrift(seconds, i + 20) * sealAmount;
      s.el.querySelector('.activity-meter')?.style.setProperty('--seal-drift', meterDrift.toFixed(3));
    }

    ctx.fillStyle = COLOR_MERIT;
    ctx.fillRect(midX, cy - barH / 2, meritW, barH);

    ctx.fillStyle = COLOR_DEMERIT;
    ctx.fillRect(midX - demeritW, cy - barH / 2, demeritW, barH);

    ctx.fillStyle = s.isTopNet ? COLOR_GOLD : 'rgba(255,255,255,0.85)';
    if (sealed) {
      // a padlock where the net score would be, still gold for the best one
      const size = fontPx + 2;
      ctx.save();
      ctx.translate(w - 5 - size, cy - size / 2);
      ctx.scale(size / 24, size / 24);
      ctx.fill(PADLOCK, 'evenodd');
      ctx.restore();
    } else {
      ctx.font = `${s.isTopNet ? 'bold ' : ''}${fontPx}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`${s.net > 0 ? '+' : ''}${s.net}${s.isTopNet ? '★' : ''}`, w - 5, cy);
    }

    ctx.font = `${fontPx}px sans-serif`;
    if (s.isTopMerit) { ctx.textAlign = 'left'; ctx.fillText('\u{1F451}', midX + meritW + 2, cy); }
    if (s.isTopDemerit) { ctx.textAlign = 'right'; ctx.fillText('⚠', midX - demeritW - 2, cy); }
  });
  if (sealAmount) drawSealNote(ctx, w, (headerH + stats.length * rowH + h) / 2, noteH - 10, seconds);
  ctx.textBaseline = 'alphabetic';
}

/* ---------- Mission Timeline (was: line graph) ---------- */
function renderTimeline() {
  const { ctx, w, h } = els.line;
  ctx.clearRect(0, 0, w, h);

  if (!timeline.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No mission data yet', w / 2, h / 2);
    return;
  }

  const series = [
    { key: 'merit', label: 'Merit', color: COLOR_MERIT },
    { key: 'demerit', label: 'Demerit', color: COLOR_DEMERIT },
    { key: 'chaos', label: 'Chaos', color: COLOR_CHAOS },
    { key: 'witness', label: 'Witness', color: COLOR_WITNESS }
  ];
  // Limit the visible history so an old spike does not keep the Y axis enlarged
  // for the entire mission. The complete timeline remains persisted.
  const points = timeline.slice(-MAX_VISIBLE_TIMELINE);
  const n = points.length;
  const firstEventIndex = timeline.length - n;
  const largestValue = Math.max(1, ...points.flatMap(point =>
    series.map(({ key }) => numericValue(point, key))
  ));
  const axisMax = fittedAxisMax(largestValue);
  const plot = { left: 32, right: w - 7, top: 28, bottom: h - 20 };
  const xAt = i => plot.left + (i / Math.max(1, n - 1)) * (plot.right - plot.left);
  const yAt = value => plot.bottom - (value / axisMax) * (plot.bottom - plot.top);

  // A single shared numeric axis keeps equal values at equal heights for every
  // color. Previously, each series used its own maximum and distorted the data.
  ctx.font = '11px sans-serif';
  ctx.lineWidth = 1;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let i = 0; i <= 4; i++) {
    const value = (axisMax * i) / 4;
    const y = yAt(value);
    ctx.strokeStyle = i === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.right, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const tickLabel = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
    ctx.fillText(tickLabel, plot.left - 4, y);
  }

  // Use steps rather than diagonal interpolation: one series changes exactly at
  // its event while the other series remain at their previous values.
  function drawSeries({ key, color }) {
    if (n === 1) {
      ctx.beginPath();
      ctx.arc(xAt(0), yAt(numericValue(points[0], key)), 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      return;
    }
    ctx.beginPath();
    let previousY = yAt(numericValue(points[0], key));
    ctx.moveTo(xAt(0), previousY);
    for (let i = 1; i < n; i++) {
      const x = xAt(i);
      const y = yAt(numericValue(points[i], key));
      ctx.lineTo(x, previousY);
      ctx.lineTo(x, y);
      previousY = y;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  series.forEach(drawSeries);

  // Legend includes the current value, so color mapping and axes are explicit.
  ctx.textBaseline = 'alphabetic';
  ctx.font = '10px sans-serif';
  const legendSlot = (plot.right - plot.left) / series.length;
  series.forEach(({ key, label, color }, index) => {
    const legendX = plot.left + index * legendSlot;
    ctx.fillStyle = color;
    ctx.fillRect(legendX, 7, 8, 3);
    ctx.textAlign = 'left';
    ctx.fillText(`${label} ${numericValue(points[n - 1], key)}`, legendX + 11, 12);
  });

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.textAlign = 'left';
  ctx.fillText(firstEventIndex === 0 ? 'START' : `EVENT ${firstEventIndex}`, plot.left, h - 4);
  ctx.textAlign = 'right';
  ctx.fillText(`EVENT ${timeline.length - 1}`, plot.right, h - 4);

  // Compact labels for major (task) events, skipping labels that would land
  // too close together to stay readable. Witnesses are rendered as a series.
  let lastLabelX = -Infinity;
  ctx.font = '11px sans-serif';
  points.forEach((p, i) => {
    const x = xAt(i);
    if (p.isTask && x - lastLabelX > 26) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText(p.label.slice(0, 6), x, plot.bottom - 3);
      lastLabelX = x;
    }
  });
}

/* ---------- Mission Risk (was: pie chart) ---------- */
function renderRisk() {
  const { ctx, w, h } = els.pie;
  ctx.clearRect(0, 0, w, h);

  const risk = computeRisk();
  const cx = w / 2, cy = h / 2;
  const outerR = Math.min(w, h) / 2 - 8;
  const innerR = outerR * 0.62;
  const ringW = outerR * 0.16;

  function ring(r, ratio, color) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = ringW;
    ctx.stroke();

    if (ratio > 0) {
      ctx.beginPath();
      const start = -Math.PI / 2;
      ctx.arc(cx, cy, r, start, start + ratio * Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = ringW;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  ring(outerR - ringW / 2, risk.chaosRatio, COLOR_CHAOS);      // outer ring = chaos
  ring(innerR - ringW / 2, risk.witnessRatio, COLOR_WITNESS);  // inner ring = witnesses

  let fontSize = 18;
  ctx.font = `bold ${fontSize}px sans-serif`;
  while (ctx.measureText(risk.level).width > innerR * 1.5 && fontSize > 10) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px sans-serif`;
  }
  const levelColors = {
    CONTROLLED: '#fff',
    UNSTABLE: '#ff9f70',
    COMPROMISED: '#ff5a4f',
    CRITICAL: '#ff2020',
    CATASTROPHIC: '#ff0000'
  };
  ctx.fillStyle = levelColors[risk.level];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(risk.level, cx, cy);
  ctx.textBaseline = 'alphabetic';

  if (els.pieBox) {
    els.pieBox.dataset.riskLevel = risk.level.toLowerCase();
    if (lastRiskLevel && lastRiskLevel !== risk.level) flash(els.pieBox, 'fx-risk-shift');
  }
  if (lastRiskLevel !== risk.level) {
    document.dispatchEvent(new CustomEvent('risk-changed', { detail: { level: risk.level.toLowerCase() } }));
  }
  lastRiskLevel = risk.level;
}

/* ---------- wiring ---------- */
export function initDashboard() {
  const line = document.getElementById('lineGraph');
  const hist = document.getElementById('histGraph');
  const pie = document.getElementById('pieGraph');
  if (!line || !hist || !pie) return;

  els.line = setupCanvas(line);
  els.hist = setupCanvas(hist);
  els.pie = setupCanvas(pie);
  els.pieBox = pie.closest('.graph-box');
  els.witnessFlash = document.getElementById('witnessFlash');
  els.chaosPulse = document.getElementById('chaosPulseOverlay');

  document.getElementById('restartTimelineButton')?.addEventListener('click', () => {
    timeline = [{ t: Date.now(), label: 'Timeline restart', isTask: false, witnessMarker: false, ...currentTotals() }];
    persistTimeline();
    renderTimeline();
  });

  // Restore persisted mission history; otherwise seed a baseline point so the
  // timeline isn't empty on first paint.
  const savedTimeline = loadSettings()?.world?.timeline;
  if (Array.isArray(savedTimeline) && savedTimeline.length) {
    timeline = savedTimeline.slice(-MAX_TIMELINE);
  } else {
    timeline = [{ t: Date.now(), label: 'Mission start', isTask: false, witnessMarker: false, ...currentTotals() }];
    persistTimeline();
  }
  lastChaosBucket = Math.floor(currentTotals().chaos / 5);

  // A branch that loads locked starts fully drifted: its real bars are never drawn.
  sealed = isMeritLocked();
  sealAmount = sealed ? 1 : 0;

  renderAgentPerformance();
  renderTimeline();
  renderRisk();
  if (sealed) runSeal();
  document.addEventListener('merit-lock-changed', e => {
    sealed = e.detail.locked;
    runSeal();
  });

  // Refit the drawing surface when the viewport or active tab changes. CSS
  // makes the charts full width; without this, their 300px bitmap is stretched.
  if (window.ResizeObserver) {
    let resizeFrame = 0;
    const canvases = [
      { element: line, key: 'line' },
      { element: hist, key: 'hist' },
      { element: pie, key: 'pie' }
    ];
    const observer = new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        let changed = false;
        canvases.forEach(({ element, key }) => {
          const { width, height } = element.getBoundingClientRect();
          if (width < 1 || height < 1) return;
          if (els[key].w === Math.round(width) && els[key].h === Math.round(height)) return;
          els[key] = setupCanvas(element);
          changed = true;
        });
        if (changed) {
          renderAgentPerformance();
          renderTimeline();
          renderRisk();
        }
      });
    });
    canvases.forEach(({ element }) => observer.observe(element));
    els.resizeObserver = observer;
  }

  document.addEventListener('triangle-action', e => {
    const { type, element, delta = 1 } = e.detail;
    pushEvent({ label: type === 'merit' ? 'Merit' : 'Demerit' });
    flash(element?.closest('.char'), type === 'merit' ? 'fx-merit' : 'fx-demerit');
    floatScore(element, type, delta);
    renderAgentPerformance();
    renderRisk();
  });

  document.addEventListener('task-executed', e => {
    const { task, charEl } = e.detail;
    pushEvent({ label: task.title || 'Task', isTask: true });
    flash(charEl, task.type === 'merit' ? 'fx-merit' : 'fx-demerit');
    renderAgentPerformance();
    renderRisk();
  });

  document.addEventListener('world-stat-changed', e => {
    const { type, value } = e.detail;
    pushEvent({ label: type === 'witness' ? 'Witness' : 'Chaos', witnessMarker: type === 'witness' });
    renderRisk();

    if (type === 'witness') {
      flash(els.witnessFlash, 'fx-flash');
    } else {
      const bucket = Math.floor(value / 5);
      if (bucket !== lastChaosBucket) {
        lastChaosBucket = bucket;
        flash(els.chaosPulse, 'chaos-pulse');
      }
    }
  });

  document.addEventListener('dashboard-refresh', () => {
    renderAgentPerformance();
    renderRisk();
  });
}

/**
 * resetDashboard - clear mission history and re-seed a baseline point.
 * Called when the branch is closed so stale history doesn't survive a reset.
 */
export function resetDashboard() {
  timeline = [{ t: Date.now(), label: 'Mission start', isTask: false, witnessMarker: false, ...currentTotals() }];
  lastChaosBucket = Math.floor(currentTotals().chaos / 5);
  persistTimeline();
  renderTimeline();
  renderAgentPerformance();
  renderRisk();
}
