// dashboard.js
// Mission-performance dashboard: Agent Performance, Mission Timeline, Mission Risk.
// Renders onto the existing three canvases; timeline history persists in localStorage
// under world.timeline (same store the rest of the app uses).

import { getAgentStats } from './charSystem.js';
import { loadSettings } from './storage.js';

const MAX_TIMELINE = 150;
const MAX_WITNESSES = 20; // matches witnesseffects.js's maxWitnesses
const MAX_CHAOS = 16;     // matches effects.js's chaosToIntensity scale

const rootStyles = getComputedStyle(document.documentElement);
const COLOR_MERIT = rootStyles.getPropertyValue('--competency-color').trim() || '#ff3b30';
const COLOR_DEMERIT = rootStyles.getPropertyValue('--anomaly-color').trim() || '#0a84ff';
const COLOR_CHAOS = rootStyles.getPropertyValue('--reality-color').trim() || '#ffd60a';
const COLOR_GOLD = rootStyles.getPropertyValue('--gold-border').trim() || 'gold';

const STORAGE_KEY = 'rpgSettings';
let timeline = [];
let lastChaosBucket = 0;
const els = {};

/* ---------- timeline persistence (world.timeline in localStorage) ---------- */
function persistTimeline() {
  try {
    const saved = loadSettings() || {};
    saved.world = (saved.world && typeof saved.world === 'object') ? saved.world : {};
    saved.world.timeline = timeline;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    console.error('Failed to persist timeline', error);
  }
}

function currentTotals() {
  const stats = getAgentStats();
  const merit = stats.reduce((sum, s) => sum + s.merit, 0);
  const demerit = stats.reduce((sum, s) => sum + s.demerit, 0);
  const witness = Number(document.getElementById('witnessCounter')?.textContent || 0);
  const chaos = Number(document.getElementById('chaosCounter')?.textContent || 0);
  return { merit, demerit, witness, chaos };
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
  el.addEventListener('animationend', function handler() {
    el.classList.remove(className);
    el.removeEventListener('animationend', handler);
  }, { once: true });
}

/* ---------- risk ---------- */
function computeRisk() {
  const witness = Number(document.getElementById('witnessCounter')?.textContent || 0);
  const chaos = Number(document.getElementById('chaosCounter')?.textContent || 0);
  const witnessRatio = Math.min(1, Math.max(0, witness / MAX_WITNESSES));
  const chaosRatio = Math.min(1, Math.max(0, chaos / MAX_CHAOS));
  const score = (witnessRatio + chaosRatio) / 2;

  let level = 'CONTROLLED';
  if (score >= 0.75) level = 'CRITICAL';
  else if (score >= 0.5) level = 'COMPROMISED';
  else if (score >= 0.25) level = 'UNSTABLE';

  return { witnessRatio, chaosRatio, score, level, witness, chaos };
}

/* ---------- Agent Performance (was: histogram) ---------- */
function renderAgentPerformance() {
  const ctx = els.histCtx, canvas = els.hist;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const stats = getAgentStats();
  if (!stats.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No agents', w / 2, h / 2);
    return;
  }

  const rows = 5;
  const rowH = h / rows;
  const midX = w / 2;
  const maxVal = Math.max(1, ...stats.map(s => Math.max(s.merit, s.demerit)));
  const barMax = midX - 46; // leave room for name + net text

  stats.forEach((s, i) => {
    const y0 = i * rowH;
    const cy = y0 + rowH / 2;

    if (s.isTopMerit || s.isTopDemerit) {
      ctx.strokeStyle = s.isTopDemerit ? '#ff9500' : COLOR_GOLD;
      ctx.lineWidth = 1;
      ctx.strokeRect(2, y0 + 2, w - 4, rowH - 4);
    }

    ctx.fillStyle = s.dead ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.85)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText((s.name || `Agent ${i + 1}`).slice(0, 10), 4, y0 + 12);

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
    ctx.font = s.isTopNet ? 'bold 10px sans-serif' : '10px sans-serif';
    ctx.textAlign = 'right';
    const netLabel = `${s.net > 0 ? '+' : ''}${s.net}${s.isTopNet ? ' ★' : ''}`;
    ctx.fillText(netLabel, w - 4, y0 + 12);

    ctx.font = '11px sans-serif';
    if (s.isTopMerit) { ctx.textAlign = 'left'; ctx.fillText('\u{1F451}', Math.min(midX + meritW + 3, w - 20), cy + 4); }
    if (s.isTopDemerit) { ctx.textAlign = 'right'; ctx.fillText('⚠', Math.max(midX - demeritW - 3, 20), cy + 4); }
  });
}

/* ---------- Mission Timeline (was: line graph) ---------- */
function renderTimeline() {
  const ctx = els.lineCtx, canvas = els.line;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  if (timeline.length < 2) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No mission data yet', w / 2, h / 2);
    return;
  }

  const n = timeline.length;
  const maxMerit = Math.max(1, ...timeline.map(p => p.merit));
  const maxDemerit = Math.max(1, ...timeline.map(p => p.demerit));
  const maxChaos = Math.max(1, ...timeline.map(p => p.chaos));
  const pad = 6;
  const xAt = i => (i / (n - 1)) * (w - pad * 2) + pad;

  function drawSeries(key, max, color) {
    ctx.beginPath();
    timeline.forEach((p, i) => {
      const x = xAt(i);
      const y = h - pad - (p[key] / max) * (h - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  drawSeries('merit', maxMerit, COLOR_MERIT);
  drawSeries('demerit', maxDemerit, COLOR_DEMERIT);
  drawSeries('chaos', maxChaos, COLOR_CHAOS);

  // witness eye markers + compact labels for major (task) events, skipping
  // labels that would land too close together to stay readable
  let lastLabelX = -Infinity;
  ctx.font = '10px sans-serif';
  timeline.forEach((p, i) => {
    const x = xAt(i);
    if (p.witnessMarker) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.textAlign = 'center';
      ctx.fillText('\u{1F441}', x, 12);
    } else if (p.isTask && x - lastLabelX > 26) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.textAlign = 'center';
      ctx.fillText(p.label.slice(0, 6), x, h - 2);
      lastLabelX = x;
    }
  });
}

/* ---------- Mission Risk (was: pie chart) ---------- */
function renderRisk() {
  const ctx = els.pieCtx, canvas = els.pie;
  const w = canvas.width, h = canvas.height;
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

  ring(outerR - ringW / 2, risk.chaosRatio, COLOR_MERIT);    // outer ring = chaos
  ring(innerR - ringW / 2, risk.witnessRatio, COLOR_CHAOS);  // inner ring = witnesses

  let fontSize = 15;
  ctx.font = `bold ${fontSize}px sans-serif`;
  while (ctx.measureText(risk.level).width > innerR * 1.5 && fontSize > 8) {
    fontSize -= 1;
    ctx.font = `bold ${fontSize}px sans-serif`;
  }
  ctx.fillStyle = risk.level === 'CRITICAL' ? '#ff4d4d' : '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(risk.level, cx, cy);
  ctx.textBaseline = 'alphabetic';

  els.pieBox?.classList.toggle('risk-critical', risk.level === 'CRITICAL');
}

/* ---------- wiring ---------- */
export function initDashboard() {
  els.line = document.getElementById('lineGraph');
  els.hist = document.getElementById('histGraph');
  els.pie = document.getElementById('pieGraph');
  if (!els.line || !els.hist || !els.pie) return;

  els.lineCtx = els.line.getContext('2d');
  els.histCtx = els.hist.getContext('2d');
  els.pieCtx = els.pie.getContext('2d');
  els.pieBox = els.pie.closest('.graph-box');
  els.witnessFlash = document.getElementById('witnessFlash');
  els.chaosPulse = document.getElementById('chaosPulseOverlay');

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
