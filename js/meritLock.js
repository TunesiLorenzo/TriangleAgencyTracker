// meritLock.js
// Sealed merits: while the lock is on, each agent's merit and demerit triangles show a
// padlock instead of this mission's count (components.css). The triangles keep counting
// underneath, so clicks, tasks and the save file work as usual. The net score under them
// keeps its direction but not its number (components.css), and the Agent Performance bars
// and the meter on each card drift instead of holding still (dashboard.js), so a standing
// can be guessed but not read. The lock is a /settings
// option (Effects tab), so the key and padlock on the task panel, like the toggle there,
// switch every open viewer; revealing plays the sound chosen beside that toggle.

import { animateTriangle } from './charSystem.js';
import { getConfig, isServerAvailable, onConfigChange, updateConfig } from './config.js';
import { isMuted, playSlot } from './soundEffects.js';

const icon = paths => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const KEY_ICON = icon('<circle cx="8" cy="15" r="4"/><path d="M10.8 12.2 20 3M17 6l2 2M14.5 8.5l1.5 1.5"/>');
const LOCK_ICON = icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');

let locked = null;      // null until the first settings arrive: loading a locked branch is not a reveal
let keyButton = null;
let lockButton = null;
let pending = Promise.resolve();

/** Only the button that would change something can be pressed. */
function syncButtons() {
  if (!keyButton) return;
  keyButton.disabled = !locked;
  lockButton.disabled = !!locked;
  lockButton.setAttribute('aria-pressed', String(!!locked));
}

function show(next) {
  if (next === locked) return;
  const switched = locked !== null;
  locked = next;
  document.body.classList.toggle('merits-locked', locked);
  syncButtons();
  document.dispatchEvent(new CustomEvent('merit-lock-changed', { detail: { locked } }));
  if (!switched) return;

  document.querySelectorAll('.char .triangle, .char .triangle-down')
    .forEach(triangle => animateTriangle(triangle, locked ? 'down' : 'up'));
  // Heard on every signed-in viewer, whichever screen turned the key.
  const open = document.documentElement.dataset.session === 'open';
  if (!locked && open && !isMuted()) void playSlot(getConfig().effects.meritLock.sound);
}

/** Save the lock so every open viewer follows; this one switches when the save comes back. */
function setLocked(next) {
  // Without the Flask server there are no shared settings: the lock stays on this screen.
  if (!isServerAvailable()) {
    show(next);
    return;
  }
  // One at a time, so a quick lock-then-key ends revealed on every screen.
  pending = pending
    .then(() => updateConfig(config => { config.effects.meritLock.enabled = next; }))
    .catch(error => {
      console.error('Merit lock was not saved; it applies to this screen only', error);
      show(next);
    });
}

/** True while the counts are sealed; 'merit-lock-changed' on document announces every switch. */
export function isMeritLocked() {
  return locked === true;
}

/** Viewer only: follow the setting. Call once the settings have loaded. */
export function initMeritLock() {
  onConfigChange(config => show(config.effects.meritLock.enabled === true));
}

/** The key (reveal) and padlock (lock) buttons for the right-hand side of the task panel. */
export function createMeritLockControls() {
  const button = (className, title, html, next) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = className;
    el.title = title;
    el.setAttribute('aria-label', title);
    el.innerHTML = html;
    el.addEventListener('click', () => setLocked(next));
    return el;
  };
  keyButton = button('merit-key-btn', 'Reveal merit and demerit counts', KEY_ICON, false);
  lockButton = button('merit-lock-btn', 'Lock merit and demerit counts', LOCK_ICON, true);

  const controls = document.createElement('div');
  controls.className = 'task-controls merit-lock-controls';
  controls.append(keyButton, lockButton);
  syncButtons();
  return controls;
}
