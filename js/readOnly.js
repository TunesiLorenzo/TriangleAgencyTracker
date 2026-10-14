// readOnly.js
// A published copy (build_static.py) is for looking only: nothing done there is kept, so
// nothing on it should look changeable either. readOnly.css hides the buttons that add,
// remove or advance things; this module freezes the controls that also show a value (the
// counters, the tracks, the fields), so they stay on screen but no longer respond.
// Opening pages, switching tabs, flipping cards and the case viewer keep working. Pressing
// anything locked buzzes and throws UNAUTHORIZED ACCESS across the screen.

import { getConfig } from './config.js';
import { isMuted, playSlot } from './soundEffects.js';

// Clicked, right-clicked or dropped on, these change the team.
const LOCKED = [
  '.world .counter',                              // witnesses, chaos, anomalies
  '.triangle', '.triangle-down', '.back-action-btn',
  '.char-portrait img', '.rel-picture',           // portrait pickers
  '.task', '.merit-key-btn', '.merit-lock-btn',
  '.rel-track', '.dose-track', '.reality-square',
  '.anomaly-square', '.answer-square', '.anomaly-used',
  '.competency-square', '.agency-item-page-icon'
].join(', ');
// Step tracks that also move with the arrow keys.
const KEYBOARD_LOCKED = '.rel-track, .dose-track';
// Fields that only change how something is shown, not the team.
const FREE_FIELDS = '.case-brightness-panel input';
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);
// Keys that only move focus or select, which a frozen field still takes.
const HARMLESS_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape']);
const WARNING_MS = 1600;      // how long UNAUTHORIZED ACCESS stays up after the last press
const WARNING_SOUND = { source: 'file:buzz.wav', volume: 1, next: '' };
let warning = null;
let warningTimer = 0;

function block(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** A press on something locked: a buzz, and the red banner across the screen at a new slight tilt. */
function warn() {
  if (!isMuted()) playSlot(WARNING_SOUND, { gain: getConfig().sounds.buttonVolume });
  if (!warning) {
    warning = document.createElement('div');
    warning.className = 'unauthorized-warning';
    warning.setAttribute('role', 'alert');
    document.body.append(warning);
  }
  const tilt = (1.5 + Math.random() * 4.5) * (Math.random() < 0.5 ? -1 : 1);   // never quite level
  warning.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
  warning.innerHTML = '<p>Unauthorized access</p>';   // new each time: the pulse starts over and is announced again
  warning.classList.add('is-shown');
  clearTimeout(warningTimer);
  warningTimer = setTimeout(() => warning.classList.remove('is-shown'), WARNING_MS);
}

/** Typed fields become read-only (still selectable); the rest are disabled. */
function freezeFields(root) {
  if (!(root instanceof Element)) return;
  const fields = root.matches('input, textarea, select') ? [root] : root.querySelectorAll('input, textarea, select');
  for (const field of fields) {
    if (field.matches(FREE_FIELDS)) continue;
    field.dataset.frozen = '';
    if (field instanceof HTMLTextAreaElement || (field instanceof HTMLInputElement && TEXT_INPUTS.has(field.type))) field.readOnly = true;
    else field.disabled = true;
  }
  // "Click to add" and the like no longer apply.
  for (const node of [root, ...root.querySelectorAll(LOCKED)]) {
    if (node.matches(LOCKED) && /click/i.test(node.title)) node.removeAttribute('title');
  }
}

/** Log Out, moved to the top as DISCONNECT, in place of every other control there (readOnly.css). */
function showDisconnect() {
  const button = document.getElementById('logoutButton');
  if (!button) return;
  button.lastChild.textContent = ' Disconnect';
  document.querySelector('.top-buttons-right')?.append(button);
}

export function initReadOnly() {
  document.documentElement.dataset.readOnly = '';
  showDisconnect();

  // Capturing on window runs before every handler the page put on its elements.
  const guard = event => {
    if (!(event.target instanceof Element)) return;
    // A frozen checkbox is pressed through the label drawn over it.
    const frozenLabel = event.type === 'click' && event.target.closest('label')?.control?.matches('[data-frozen]');
    if (!event.target.closest(LOCKED) && !frozenLabel) return;
    block(event);
    // Not on the drag passing over, nor twice for a double click.
    if (['click', 'contextmenu', 'drop'].includes(event.type)) warn();
  };
  ['click', 'dblclick', 'contextmenu', 'dragover', 'drop'].forEach(type => window.addEventListener(type, guard, true));
  window.addEventListener('keydown', event => {
    if (!(event.target instanceof Element) || HARMLESS_KEYS.has(event.key)) return;
    if (event.target.closest(KEYBOARD_LOCKED)) {
      block(event);
      if (!event.repeat) warn();
      return;
    }
    // Typing into a read-only field (copying out of it is fine).
    const editing = event.key.length === 1 ? !event.ctrlKey && !event.metaKey : ['Backspace', 'Delete', 'Enter'].includes(event.key);
    if (editing && !event.repeat && event.target.matches('[data-frozen]')) warn();
  }, true);
  // A disabled field gets no click, only the pointer going down on it.
  window.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.matches('[data-frozen]:disabled')) warn();
  }, true);

  // Cards, tabs and pages are drawn and redrawn all session: freeze each as it arrives.
  freezeFields(document.body);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(freezeFields));
  }).observe(document.body, { childList: true, subtree: true });
}
