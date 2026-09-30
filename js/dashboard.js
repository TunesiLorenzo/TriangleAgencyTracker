// dashboard.js
// Mission-performance dashboard: Agent Performance, Mission Timeline, Mission Risk.
// Renders onto the existing three canvases; timeline history persists in localStorage
// under world.timeline (same store the rest of the app uses).

import { getAgentStats } from './charSystem.js';
import { loadSettings, updateSettings } from './storage.js';

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

let timeline = [];
let lastRiskLevel = null;
let lastChaosBucket = 0;
const els = {};

/* ---------- timeline persistence (world.timeline in localStorage) ---------- */
function persistTimeline() {
  updateSettings(settings => { settings.world.timeline = timeline; });
}

/* ---------- crisp canvases on HiDPI screens ----------
   The width/height attributes in index.html are the logical drawing size.
   The backing store is scaled by devicePixelRatio and the context transformed,
   so all drawing code keeps working in logical units. */
function setupCanvas(canvas) {
  const logical = { w: canvas.width, h: canvas.height };
  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
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

  const rows = 5;
  const headerH = 18;
  const rowH = (h - headerH) / rows;
  const midX = w / 2;
  const maxVal = Math.max(1, ...stats.map(s => Math.max(s.merit, s.demerit)));
  const barMax = midX - 46; // leave room for name + net text

  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`DEMERIT  ${maxVal}  ←  0  →  ${maxVal}  MERIT`, midX, 11);

  stats.forEach((s, i) => {
    const y0 = headerH + i * rowH;
    const cy = y0 + rowH / 2;

    if (s.isTopMerit || s.isTopDemerit) {
      ctx.strokeStyle = s.isTopDemerit ? '#ff9500' : COLOR_GOLD;
      ctx.lineWidth = 1;
      ctx.strokeRect(2, y0 + 2, w - 4, rowH - 4);
    }

    ctx.fillStyle = s.dead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText((s.name || `Agent ${i + 1}`).slice(0, 10), 4, y0 + 14);

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.beginPath(); ctx.moveTo(midX, y0 + 4); ctx.lineTo(midX, y0 + rowH - 4); ctx.stroke();

    const meritW = (s.merit / maxVal) * barMax;
    const demeritW = (s.demerit / maxVal) * barMax;
    const barH = Math.max(6, rowH * 0.28);

    ctx.fillStyle = COLOR_MERIT;
    ctx.fillRect(midX, cy - barH / 2, meritW, barH);

    ctx.fillStyle = COLOR_DEMERIT;
    ctx.fillRect(midX - demeritW, cy - barH / 2, demeritW, barH);

    ctx.fillStyle = s.isTopNet ? COLOR_GOLD : 'rgba(255,255,255,0.85)';
    ctx.font = s.isTopNet ? 'bold 12px sans-serif' : '12px sans-serif';
    ctx.textAlign = 'right';
    const netLabel = `${s.net > 0 ? '+' : ''}${s.net}${s.isTopNet ? ' ★' : ''}`;
    ctx.fillText(netLabel, w - 4, y0 + 14);

    ctx.font = '13px sans-serif';
    if (s.isTopMerit) { ctx.textAlign = 'left'; ctx.fillText('\u{1F451}', Math.min(midX + meritW + 3, w - 20), cy + 4); }
    if (s.isTopDemerit) { ctx.textAlign = 'right'; ctx.fillText('⚠', Math.max(midX - demeritW - 3, 20), cy + 4); }
  });
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

  renderAgentPerformance();
  renderTimeline();
  renderRisk();

  document.addEventListener('triangle-action', e => {
    const { type, element } = e.detail;
    pushEvent({ label: type === 'merit' ? 'Merit' : 'Demerit' });
    flash(element?.closest('.char'), type === 'merit' ? 'fx-merit' : 'fx-demerit');
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
