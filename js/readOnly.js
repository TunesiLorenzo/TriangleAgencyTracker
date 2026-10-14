// readOnly.js
// A published copy (build_static.py) is for looking only: nothing done there is kept, so
// nothing on it should look changeable either. readOnly.css hides the buttons that add,
// remove or advance things; this module freezes the controls that also show a value (the
// counters, the tracks, the fields), so they stay on screen but no longer respond.
// Opening pages, switching tabs, flipping cards and the case viewer keep working.

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

function block(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/** Typed fields become read-only (still selectable); the rest are disabled. */
function freezeFields(root) {
  if (!(root instanceof Element)) return;
  const fields = root.matches('input, textarea, select') ? [root] : root.querySelectorAll('input, textarea, select');
  for (const field of fields) {
    if (field.matches(FREE_FIELDS)) continue;
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
    if (event.target instanceof Element && event.target.closest(LOCKED)) block(event);
  };
  ['click', 'dblclick', 'contextmenu', 'dragover', 'drop'].forEach(type => window.addEventListener(type, guard, true));
  window.addEventListener('keydown', event => {
    if (event.key !== 'Tab' && event.target instanceof Element && event.target.closest(KEYBOARD_LOCKED)) block(event);
  }, true);

  // Cards, tabs and pages are drawn and redrawn all session: freeze each as it arrives.
  freezeFields(document.body);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(freezeFields));
  }).observe(document.body, { childList: true, subtree: true });
}
