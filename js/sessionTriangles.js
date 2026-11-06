// Small, session-only triangle sightings. They are intentionally independent from the
// game state: finding one only lets the Manager know that the agent spotted it.

import { getIdentity, publish, who } from './access.js';

const MIN_DELAY = 2 * 60 * 1000;
const MAX_DELAY = 4 * 60 * 1000;
const LIFETIME = 3500;

let timer = 0;
let active = null;

const nextDelay = () => MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);

function clearActive() {
  if (!active) return;
  const triangle = active;
  active = null;
  triangle.classList.add('is-dissipating');
  setTimeout(() => triangle.remove(), 420);
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    showTriangle();
    schedule();
  }, nextDelay());
}

function showTriangle() {
  if (active || document.hidden) return;
  const triangle = document.createElement('button');
  triangle.type = 'button';
  triangle.className = 'session-triangle';
  triangle.setAttribute('aria-label', 'Anomalous triangle');
  triangle.title = 'Anomalous signal';
  triangle.style.setProperty('--triangle-x', `${5 + Math.random() * 80}vw`);
  triangle.style.setProperty('--triangle-y', `${12 + Math.random() * 70}vh`);
  triangle.innerHTML = '<span aria-hidden="true">△</span>';
  active = triangle;
  const vanish = setTimeout(clearActive, LIFETIME);
  triangle.addEventListener('click', () => {
    clearTimeout(vanish);
    publish('△ Triangle sighting', `${who()} intercepted a transient triangle during their session.`, ['small_red_triangle']);
    clearActive();
  }, { once: true });
  document.body.append(triangle);
}

/** Start for a signed-in agent. A Manager/guest session has no agent activity to track. */
export function startSessionTriangles() {
  const identity = getIdentity();
  if (!identity || identity.manager || identity.guest || timer) return;
  schedule();
}

export function stopSessionTriangles() {
  clearTimeout(timer);
  timer = 0;
  clearActive();
}
