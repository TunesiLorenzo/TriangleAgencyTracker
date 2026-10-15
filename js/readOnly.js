// readOnly.js
// A published copy (build_static.py) is for looking only: nothing done there is kept, so
// nothing on it should look changeable either. readOnly.css hides the buttons that add,
// remove or advance things; this module freezes the controls that also show a value (the
// counters, the tracks, the fields), so they stay on screen but no longer respond.
// Opening pages, switching tabs, flipping cards and the case viewer keep working. Pressing
// anything locked buzzes and throws UNAUTHORIZED ACCESS across the screen; the third time,
// the agent is logged out. Each attempt is also reported to the Manager, in words
// (describeAttempt), through access.js.

import { getConfig } from './config.js';
import { isMuted, playSlot } from './soundEffects.js';
import { getIdentity, noteTerminated, playWarning, reportAttempt } from './access.js';

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
// Fields that only change how something is shown, not the team; and the login screen's own.
const FREE_FIELDS = '.case-brightness-panel input, .login-entry, .transmission-answer, .messages-compose textarea, .manager-message-form input, .manager-message-form select, .manager-message-form textarea';
const TEXT_INPUTS = new Set(['text', 'number', 'search', 'email', 'url', 'tel', 'password']);
// Keys that only move focus or select, which a frozen field still takes.
const HARMLESS_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape']);
const WARNING_MS = 2800;      // how long UNAUTHORIZED ACCESS stays up after the last press
const VIOLATIONS_BEFORE_LOGOUT = 3;
const TERMINATED_MS = 2400;      // the red flashes of SESSION TERMINATED, then the logout (readOnly.css)
let warning = null;
let warningTimer = 0;
let violations = 0;              // this session's, numbered on the banner

function block(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

/* ---------- what was tried, in words, for the Manager ---------- */
const clean = text => String(text || '').replace(/[^\p{L}\p{N}\s.,'’&#()-]/gu, '').replace(/\s+/g, ' ').trim();

/** The agent on a card, or "themselves" when it is the signed-in player's own. */
function agentOnCard(card) {
  if (card._id && card._id === getIdentity()?.charId) return 'themselves';
  return clean(card.querySelector('[data-stat="name"]')?.value) || 'an agent';
}

/** The agent whose page is open on the Relationships, Anomaly or Agency tab, if any. */
function agentOnPage(target) {
  const view = target.closest('[role="tabpanel"], .view');
  const chip = view?.querySelector('[aria-current="true"]');
  return clean(chip?.textContent) || '';
}

const openTab = () => clean(document.querySelector('.view-tab[aria-selected="true"]')?.textContent) || 'tracker';

/** What pressing `target` would have done, as "give a demerit to KARL VOLF". */
function describeAttempt(target, type) {
  const lower = type === 'contextmenu';
  const card = target.closest('.char');
  const agent = card ? agentOnCard(card) : '';
  const possessive = agent === 'themselves' ? 'their own' : `${agent}'s`;
  const page = agentOnPage(target);
  const onPage = page ? ` (${page}'s page, ${openTab()} tab)` : ` (${openTab()} tab)`;

  if (target.closest('.triangle')) return lower ? `take a merit away from ${agent}` : `give a merit to ${agent}`;
  if (target.closest('.triangle-down')) return lower ? `take a demerit away from ${agent}` : `give a demerit to ${agent}`;
  const backAction = target.closest('.back-action-btn');
  if (backAction) {
    return backAction.closest('.encouraged')
      ? `reward ${agent} for their Encouraged Behavior (a merit)`
      : `punish ${agent} for breaking their Prime Directive (a demerit)`;
  }
  if (target.closest('.char-portrait')) return `change ${possessive} portrait`;
  const counter = target.closest('.world .counter');
  if (counter) {
    const label = clean(counter.parentElement?.querySelector('.world-label, .anomaly-label')?.textContent).toLowerCase() || 'a counter';
    return `${lower ? 'lower' : 'raise'} the ${label} count`;
  }
  const task = target.closest('.task');
  if (task) return `use the task “${clean(task.querySelector('.task-title')?.textContent) || 'untitled'}”`;
  if (target.closest('.merit-key-btn')) return 'reveal the merit and demerit counts';
  if (target.closest('.merit-lock-btn')) return 'lock the merit and demerit counts';
  if (target.closest('.rel-track')) return `move a relationship track${onPage}`;
  if (target.closest('.rel-picture')) return `change a relationship's picture${onPage}`;
  if (target.closest('.dose-track, .reality-square')) return `change a reality track${onPage}`;
  if (target.closest('.anomaly-square, .answer-square, .anomaly-used')) return `tamper with the anomaly file${onPage}`;
  if (target.closest('.competency-square')) return `move the competency track${onPage}`;
  if (target.closest('.agency-item-page-icon')) return `change an Agency item's icon${onPage}`;
  const field = target.closest('[data-frozen]') || target.closest('label')?.control;
  if (field) {
    if (card && field.dataset.stat) return `rewrite ${possessive} ${field.dataset.stat}`;
    const label = clean(field.labels?.[0]?.textContent || field.getAttribute('aria-label') || field.placeholder);
    return `edit ${label ? `“${label}”` : 'a field'}${card ? ` on ${possessive} card` : onPage}`;
  }
  const label = clean(target.closest('button, [role="button"]')?.textContent || target.getAttribute('aria-label') || target.title);
  return `press ${label ? `“${label}”` : 'a locked control'}${onPage}`;
}

/**
 * A press on something locked: a buzz, and the red banner across the screen at a new slight
 * tilt, numbering the violation. The third one ends the session once the banner has gone.
 */
function warn(target, type) {
  violations++;
  reportAttempt(describeAttempt(target, type));
  const reprimand = 1000 + Math.floor(Math.random() * 9000);
  playWarning();
  if (!warning) {
    warning = document.createElement('div');
    warning.className = 'unauthorized-warning';
    warning.setAttribute('role', 'alert');
    document.body.append(warning);
  }
  const tilt = (1.5 + Math.random() * 4.5) * (Math.random() < 0.5 ? -1 : 1);   // never quite level
  warning.style.setProperty('--tilt', `${tilt.toFixed(1)}deg`);
  // New each time: the pulse starts over and is announced again.
  warning.innerHTML = `<p>Unauthorized access<span>Violation N° ${violations} : Reprimand #${reprimand} issued</span></p>`;
  warning.classList.add('is-shown');
  clearTimeout(warningTimer);
  warningTimer = setTimeout(() => warning.classList.remove('is-shown'), WARNING_MS);
  if (violations === VIOLATIONS_BEFORE_LOGOUT) setTimeout(terminate, WARNING_MS);
}

/** The whole page flashes red with YOUR SESSION HAS BEEN TERMINATED to the demerit sound, then logs out. */
function terminate() {
  noteTerminated();
  warning.classList.remove('is-shown');
  if (!isMuted()) playSlot(getConfig().sounds.events.demerit);
  const notice = document.createElement('div');
  notice.className = 'session-terminated';
  notice.setAttribute('role', 'alert');
  notice.style.setProperty('--terminated-ms', `${TERMINATED_MS}ms`);
  notice.innerHTML = '<p>Your session has been terminated</p>';
  document.body.append(notice);
  setTimeout(() => {
    document.getElementById('logoutButton')?.click();
    // Under the login screen by now; gone in case the logout did not happen.
    setTimeout(() => notice.remove(), 4000);
  }, TERMINATED_MS);
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

/**
 * Under the title, who is signed in: their badge number and their agent's name (a guest's
 * AGENT# number). Not part of the title, whose tear layers copied it once. The title and
 * the tag share one box, so the portrait layout's grid (rows counted by position) still
 * sees a single item there.
 */
export function showAgentTag(identity = getIdentity()) {
  if (!identity) return;
  let tag = document.querySelector('.agent-tag');
  const title = document.querySelector('h1');
  if (!tag && title) {
    const block = document.createElement('div');
    block.className = 'title-block';
    title.replaceWith(block);
    tag = document.createElement('p');
    tag.className = 'agent-tag';
    block.append(title, tag);
  }
  if (!tag) return;
  const name = identity.manager ? 'Manager' : identity.name || (identity.guest ? 'Guest' : identity.username);
  const badge = document.createElement('span');
  badge.className = 'agent-tag-id';
  badge.textContent = `${identity.manager ? 'Manager' : 'Agent'} #${identity.badge}`;
  const label = document.createElement('span');
  label.className = 'agent-tag-name';
  label.textContent = name;
  tag.replaceChildren(badge, label);
  tag.setAttribute('aria-label', `Signed in as ${name}, ${identity.manager ? 'manager' : 'agent'} number ${identity.badge}`);
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
    if (['click', 'contextmenu', 'drop'].includes(event.type)) warn(event.target, event.type);
  };
  ['click', 'dblclick', 'contextmenu', 'dragover', 'drop'].forEach(type => window.addEventListener(type, guard, true));
  window.addEventListener('keydown', event => {
    if (!(event.target instanceof Element) || HARMLESS_KEYS.has(event.key)) return;
    if (event.target.closest(KEYBOARD_LOCKED)) {
      block(event);
      if (!event.repeat) warn(event.target, event.type);
      return;
    }
    // Typing into a read-only field (copying out of it is fine).
    const editing = event.key.length === 1 ? !event.ctrlKey && !event.metaKey : ['Backspace', 'Delete', 'Enter'].includes(event.key);
    if (editing && !event.repeat && event.target.matches('[data-frozen]')) warn(event.target, event.type);
  }, true);
  // A disabled field gets no click, only the pointer going down on it.
  window.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.matches('[data-frozen]:disabled')) warn(event.target, event.type);
  }, true);

  // Cards, tabs and pages are drawn and redrawn all session: freeze each as it arrives.
  freezeFields(document.body);
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(freezeFields));
  }).observe(document.body, { childList: true, subtree: true });
}
