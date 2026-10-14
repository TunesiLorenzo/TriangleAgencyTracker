// access.js
// Who is looking at a published copy, and the line between them and the Manager. The
// players sign in with the username and password set for them on the Players tab of
// /settings; anyone else is a guest, an AGENT# with a number drawn for the visit (login.js).
//
// Through ntfy (https://ntfy.sh) the Manager hears who signs in and what they try to
// change (reportAttempt, from readOnly.js), and can write to a signed-in player live, on
// that account's own channel. A message left on the account itself is shown at sign-in.
// The player can answer a message: the answer goes to the Manager's channel.
//
// build_static.py publishes each account sealed with its own credentials: the keys below
// are worked out the same way from what is typed. Plain JavaScript SHA-256, because
// crypto.subtle is missing on a plain-http page (the tracker's /public on the LAN).

import { getConfig, getSnapshot } from './config.js';
import { isMuted, playButton, playSlot } from './soundEffects.js';

const WARNING_SOUND = { source: 'file:buzz.wav', volume: 1, next: '' };
const BATCH_MS = 8000;          // attempts are reported together, at most this often
const MAX_FAILED_REPORTS = 5;   // failed sign-ins reported per page load
const TYPE_MS = 24;             // per character of a transmission
const MAX_REPLY = 500;          // characters of a player's answer

/* ---------- SHA-256 ---------- */
const rotr = (x, n) => (x >>> n) | (x << (32 - n));
const PRIMES = [];
for (let n = 2; PRIMES.length < 64; n++) if (PRIMES.every(p => n % p)) PRIMES.push(n);
const fraction32 = x => Math.floor((x - Math.floor(x)) * 2 ** 32) >>> 0;
const K = Uint32Array.from(PRIMES, p => fraction32(Math.cbrt(p)));
const H0 = Uint32Array.from(PRIMES.slice(0, 8), p => fraction32(Math.sqrt(p)));

function sha256(bytes) {
  const length = bytes.length;
  const padded = new Uint8Array((((length + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(length / 0x20000000));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = H0.slice();
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    [a, b, c, d, e, f, g, hh].forEach((value, i) => { h[i] += value; });
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  h.forEach((value, i) => outView.setUint32(i * 4, value));
  return out;
}

const utf8 = text => new TextEncoder().encode(text);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
};
const hex = bytes => [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
const fromBase64 = text => Uint8Array.from(atob(text), ch => ch.charCodeAt(0));

/** The same (id, key) as build_static.account_keys. */
function accountKeys(username, password) {
  const secret = sha256(utf8(`triangle-agency\n${username.trim().toLowerCase()}\n${password}`));
  return { id: hex(sha256(concat(utf8('id'), secret))), key: sha256(concat(utf8('key'), secret)) };
}

/** Undo build_static.seal. */
function unseal(key, { nonce, data }) {
  const sealed = fromBase64(data);
  const salt = fromBase64(nonce);
  const out = new Uint8Array(sealed.length);
  for (let block = 0; block * 32 < sealed.length; block++) {
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, block);
    const stream = sha256(concat(key, salt, counter));
    for (let i = 0; i < 32 && block * 32 + i < sealed.length; i++) out[block * 32 + i] = sealed[block * 32 + i] ^ stream[i];
  }
  return JSON.parse(new TextDecoder().decode(out));
}

/* ---------- who is signed in ---------- */
let identity = null;

function access() {
  const data = getSnapshot()?.access;
  return { server: 'https://ntfy.sh', notify: '', notifyGuests: true, accounts: [], ...data };
}

/** Whether this published copy has accounts to sign in with. */
export function hasAccounts() {
  return access().accounts.length > 0;
}

function agentOf(charId) {
  return (getSnapshot()?.team?.chars || []).find(char => String(char.id) === charId) || null;
}

/** A visitor without an account: AGENT# and a five-digit number drawn for the visit. */
export function guestIdentity() {
  const badge = String(10000 + Math.floor(Math.random() * 90000));
  return { guest: true, username: `AGENT#${badge}`, badge, name: '', picture: '', charId: '', inbox: '', messages: [] };
}

/** The account these credentials open, as an identity; null when they open none. */
export function findAccount(username, password) {
  const { id, key } = accountKeys(username, password);
  const account = access().accounts.find(entry => entry.id === id);
  if (!account) return null;
  try {
    const details = unseal(key, account);
    const agent = agentOf(details.charId);
    return {
      guest: false,
      username: details.username,
      badge: details.badge || String(10000 + Math.floor(Math.random() * 90000)),
      name: agent?.name?.trim() || '',
      picture: agent?.icon || '',
      charId: details.charId || '',
      inbox: details.inbox || '',
      messages: Array.isArray(details.messages) ? details.messages : []
    };
  } catch {
    return null;
  }
}

export function setIdentity(next) { identity = next; }
export function getIdentity() { return identity; }

/** How the notifications name whoever is signed in. */
function who(person = identity) {
  if (!person) return 'Someone';
  if (person.guest) return `Guest ${person.username}`;
  return person.name ? `Agent ${person.name} (${person.username})` : `Agent ${person.username}`;
}

/* ---------- notifications to the Manager ---------- */
const preview = () => 'publishPreview' in document.documentElement.dataset;

function publish(title, message, tags = []) {
  const { server, notify } = access();
  if (!notify) return Promise.resolve();
  // A plain-text body and no custom headers: a "simple" request, with no CORS preflight.
  return fetch(`${server}/`, {
    method: 'POST',
    keepalive: true,
    body: JSON.stringify({ topic: notify, title: preview() ? `[Preview] ${title}` : title, message, tags })
  }).catch(() => null);   // offline, or ntfy is down: the game goes on
}

const reporting = () => identity && (!identity.guest || access().notifyGuests);
const pending = new Map();   // what was tried -> how many times, since the last report
let batchTimer = 0;
let failedReports = 0;
let terminated = false;   // thrown out by readOnly.js for repeated violations

function flushAttempts() {
  clearTimeout(batchTimer);
  batchTimer = 0;
  if (!pending.size) return Promise.resolve();
  const tries = [...pending].map(([what, times]) => `${what}${times > 1 ? ` (×${times})` : ''}`);
  pending.clear();
  const message = tries.length === 1 ? `${who()} tried to ${tries[0]}.` : `${who()} tried to:\n${tries.map(line => `• ${line}`).join('\n')}`;
  return publish('Unauthorized access', message, ['no_entry']);
}

/** A locked control pressed, as "give a demerit to KARL VOLF" (readOnly.js says what). */
export function reportAttempt(what) {
  if (!what || !reporting()) return;
  pending.set(what, (pending.get(what) || 0) + 1);
  if (!batchTimer) batchTimer = setTimeout(flushAttempts, BATCH_MS);
}

/** The session is ending for repeated violations: the goodbye says so. */
export function noteTerminated() {
  terminated = true;
}

export function reportFailedSignIn(username) {
  if (failedReports++ >= MAX_FAILED_REPORTS) return;
  publish('Failed sign-in', `Someone tried to sign in as “${username.trim() || '(blank)'}” with the wrong password.`, ['lock']);
}

/** The buzz of a locked control or a refused sign-in. */
export function playWarning() {
  if (!isMuted()) playSlot(WARNING_SOUND, { gain: getConfig().sounds.buttonVolume });
}

/* ---------- transmissions to the player, and their replies ---------- */
const queue = [];
let overlay = null;
let showing = false;
let current = null;   // the message on screen: { from, text, finish, close }

const part = name => overlay.querySelector(`.transmission-${name}`);

function buildOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'transmission';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Incoming transmission');
  overlay.innerHTML = `
    <div class="transmission-panel">
      <p class="transmission-head"><span class="transmission-dot" aria-hidden="true"></span>Incoming transmission</p>
      <p class="transmission-from"></p>
      <div class="transmission-text" aria-live="polite"></div>
      <div class="transmission-reply" hidden>
        <textarea class="transmission-answer" rows="3" maxlength="${MAX_REPLY}" placeholder="Your answer…" aria-label="Your reply"></textarea>
        <p class="transmission-state" aria-live="polite"></p>
      </div>
      <div class="transmission-actions">
        <button type="button" class="transmission-answer-button">Reply</button>
        <button type="button" class="transmission-send" hidden>Transmit</button>
        <button type="button" class="transmission-close">Acknowledge</button>
      </div>
    </div>`;
  document.body.append(overlay);

  overlay.addEventListener('click', event => {
    if (!current) return;
    event.stopPropagation();
    if (!overlay.classList.contains('is-typed')) {
      current.finish();   // a click while it types shows the rest at once
      return;
    }
    if (event.target.closest('.transmission-answer-button')) openReply();
    else if (event.target.closest('.transmission-send')) sendReply();
    else if (event.target.closest('.transmission-close')) current.close();
    // Outside the panel: acknowledged, unless an answer is being written.
    else if (!event.target.closest('.transmission-panel') && part('reply').hidden) current.close();
  });
  part('answer').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendReply();
    }
  });
}

function openReply() {
  part('reply').hidden = false;
  part('answer-button').hidden = true;
  part('send').hidden = false;
  part('answer').focus();
}

/** The player's answer goes to the Manager's channel, with what it answers. */
async function sendReply() {
  const answer = part('answer');
  const text = answer.value.trim();
  if (!text) {
    answer.focus();
    return;
  }
  const state = part('state');
  const send = part('send');
  send.disabled = answer.readOnly = true;
  state.className = 'transmission-state';
  state.textContent = 'Transmitting…';
  const original = current.text.length > 120 ? `${current.text.slice(0, 117)}…` : current.text;
  const response = await publish(`Reply from ${who()}`, `${text}\n\n↩ to ${current.from}: “${original}”`, ['speech_balloon']);
  if (response?.ok) {
    state.classList.add('is-ok');
    state.textContent = 'Reply transmitted';
    setTimeout(() => current?.close(), 1200);
  } else {
    state.classList.add('is-error');
    state.textContent = 'Transmission failed · try again';
    send.disabled = answer.readOnly = false;
  }
}

/** Type out one message; it stays until acknowledged, or answered. */
function present({ from, text }) {
  part('from').textContent = `From: ${from}`;
  part('text').textContent = '';
  part('reply').hidden = true;
  part('answer').value = '';
  part('answer').readOnly = false;
  part('state').textContent = '';
  part('answer-button').hidden = !access().notify;   // nowhere for an answer to go
  part('send').hidden = true;
  part('send').disabled = false;
  overlay.classList.remove('is-typed');
  overlay.hidden = false;
  playButton('session', 'badgeRead');
  return new Promise(resolve => {
    let shown = 0;
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      part('text').textContent = text;
      overlay.classList.add('is-typed');
    };
    const type = () => {
      shown++;
      part('text').textContent = text.slice(0, shown);
      if (shown % 3 === 0 && text[shown - 1]?.trim()) playButton('session', 'typing');
      if (shown < text.length) timer = setTimeout(type, TYPE_MS);
      else finish();
    };
    const close = () => {
      if (current?.close !== close) return;
      current = null;
      overlay.hidden = true;
      resolve();
    };
    current = { from, text, finish, close };
    timer = setTimeout(type, 500);
  });
}

async function showTransmission(message) {
  if (!message.text?.trim()) return;
  queue.push(message);
  if (showing) return;
  showing = true;
  if (!overlay) buildOverlay();
  while (queue.length) await present(queue.shift());
  showing = false;
}

/* ---------- the session ---------- */
let inbox = null;   // the EventSource on the account's channel

function storage(action) {
  try { return action(localStorage); } catch { return null; }
}

/** The messages left on the account, each once on this device. */
function showLeftMessages() {
  for (const message of identity.messages) {
    const key = `ta-message-${message.id}`;
    if (storage(store => store.getItem(key))) continue;
    storage(store => store.setItem(key, '1'));
    showTransmission({ from: 'The Manager', text: message.text });
  }
}

/** Live messages on the account's channel; on opening, also those sent since the last visit (ntfy keeps them 12 hours). */
function openInbox() {
  const { server } = access();
  if (!identity.inbox || typeof EventSource === 'undefined') return;
  const lastKey = `ta-inbox-${identity.inbox}`;
  const since = storage(store => store.getItem(lastKey)) || 'all';
  const seen = new Set();
  inbox = new EventSource(`${server}/${encodeURIComponent(identity.inbox)}/sse?since=${encodeURIComponent(since)}`);
  inbox.addEventListener('message', event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.event !== 'message' || seen.has(data.id)) return;
    seen.add(data.id);
    storage(store => store.setItem(lastKey, data.id));
    showTransmission({ from: data.title || 'The Manager', text: data.message || '' });
  });
}

/** Signed in: tell the Manager, then deliver what is waiting. */
export function startSession() {
  if (!identity) return;
  if (reporting()) publish('Sign-in', `${who()} signed in.`, ['key']);
  if (identity.guest) return;
  showLeftMessages();
  openInbox();
}

/** Log Out: the last attempts and the goodbye go out before the page closes. */
export function endSession() {
  if (!identity) return;
  const person = who();
  // After the last attempts, so the goodbye arrives last.
  flushAttempts().then(() => {
    if (!reporting()) return;
    if (terminated) publish('Session terminated', `${person} was thrown out for repeated violations.`, ['rotating_light']);
    else publish('Disconnected', `${person} disconnected.`, ['wave']);
  });
  inbox?.close();
  inbox = null;
}
