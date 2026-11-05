// messageAlert.js
// On the local tracker only: whenever a message passes on any channel (a player's, or the
// Manager's as themselves, an NPC or an anomaly), a phone slides up in the corner, buzzes
// on the table and reads "New message for: <who>", so the table remembers to check their
// phones. Who it is for, never what it says (the table may be watching the screen). The
// phone's screen takes the colour of the conversation: red for the Manager's line, green
// between agents, yellow with a relationship, blue with an anomaly.
// The messages come live from phoneFeed.js (ntfy). The sound and the room-light cue are the
// "Message" event on /settings. Nothing shows while the tracker is behind the login screen;
// messages arriving close together queue, one phone per recipient.

import { getSnapshot } from './config.js';
import { motionAllowed } from './motion.js';
import { ensureFeed, onArrival } from './phoneFeed.js';
import { playEvent, soundStartDelay } from './soundEffects.js';
import { VIBRATE_PULSES } from './synth.js';

const ENTER_MS = 520;
const HOLD_MS = 4800;        // on screen after it has come in, buzz included
const LEAVE_MS = 420;
const MAX_QUEUED = 6;
const KINDS = ['manager', 'agent', 'npc', 'anomaly'];

const queue = [];
let showing = false;
let alert = null;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sessionOpen = () => document.documentElement.dataset.session === 'open';

function build() {
  alert = document.createElement('div');
  alert.className = 'message-alert';
  alert.setAttribute('role', 'status');
  alert.setAttribute('aria-live', 'polite');
  alert.innerHTML = `
    <span class="message-alert-waves" aria-hidden="true"><span></span><span></span></span>
    <div class="message-alert-phone">
      <span class="message-alert-notch" aria-hidden="true"></span>
      <div class="message-alert-screen">
        <span class="message-alert-status" aria-hidden="true"><span>▲</span><span>▮▮▮▯</span></span>
        <span class="message-alert-icon" aria-hidden="true">✉</span>
        <span class="message-alert-title">New message</span>
        <span class="message-alert-for">for:</span>
        <strong class="message-alert-to"></strong>
        <span class="message-alert-count" hidden></span>
      </div>
    </div>`;
  document.body.append(alert);
}

/** The phone's two buzzes, in step with the vibrate sound, which starts `delay` ms from now. */
async function buzz(delay) {
  const start = performance.now() + delay;
  for (const [offset, length] of VIBRATE_PULSES) {
    await wait(Math.max(0, start + offset * 1000 - performance.now()));
    alert.classList.add('is-buzzing');
    await wait(length * 1000);
    alert.classList.remove('is-buzzing');
  }
}

async function show(message) {
  if (!alert) build();
  KINDS.forEach(kind => alert.classList.toggle(`kind-${kind}`, kind === message.kind));
  alert.querySelector('.message-alert-to').textContent = message.to || 'Unknown';
  const count = alert.querySelector('.message-alert-count');
  count.hidden = message.count < 2;
  count.textContent = `×${message.count}`;
  alert.setAttribute('aria-label', `New message for ${message.to}`);

  alert.classList.remove('is-leaving');
  alert.classList.add('is-shown');
  await wait(motionAllowed() ? ENTER_MS * 0.6 : 0);
  playEvent('message');
  // Read after asking for the sound: a sleeping amplifier is woken by it.
  if (motionAllowed()) buzz(soundStartDelay());
  await wait(HOLD_MS);
  alert.classList.add('is-leaving');
  await wait(LEAVE_MS);
  alert.classList.remove('is-shown', 'is-leaving', 'is-buzzing');
}

async function drain() {
  if (showing) return;
  showing = true;
  try {
    while (queue.length) await show(queue.shift());
  } finally {
    showing = false;
  }
}

function arrived({ kind, to }) {
  if (!sessionOpen()) return;
  // Another for whoever is waiting in the queue: one phone, counted.
  const waiting = queue.find(item => item.to === to && item.kind === kind);
  if (waiting) waiting.count++;
  else if (queue.length < MAX_QUEUED) queue.push({ kind: KINDS.includes(kind) ? kind : 'npc', to, count: 1 });
  drain();
}

export function initMessageAlert() {
  if (getSnapshot()) return;   // the local tracker only
  onArrival(arrived);
  ensureFeed();
}
