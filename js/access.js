// access.js
// Who is looking at a published copy, and the line between them and the Manager. The
// players sign in with the username and password set for them on the Players tab of
// /settings; anyone else is a guest, an AGENT# with a number drawn for the visit (login.js).
//
// Through ntfy (https://ntfy.sh) the Manager hears who signs in and what they try to
// change (reportAttempt, from readOnly.js). The messages to and from the players, the
// Manager's and the in-character ones, are messages.js's.
//
// build_static.py publishes each account sealed with its own credentials: the keys below
// are worked out the same way from what is typed. Plain JavaScript SHA-256, because
// crypto.subtle is missing on a plain-http page (the tracker's /public on the LAN).

import { getConfig, getSnapshot } from './config.js';
import { isMuted, playSlot } from './soundEffects.js';

const WARNING_SOUND = { source: 'file:buzz.wav', volume: 1, next: '' };
const BATCH_MS = 8000;          // attempts are reported together, at most this often
const MAX_FAILED_REPORTS = 5;   // failed sign-ins reported per page load

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

/** The Players tab as published (build_static.make_access). */
export function access() {
  const data = getSnapshot()?.access;
  return { server: 'https://ntfy.sh', notify: '', notifyGuests: true, copyChats: true, accounts: [], ...data };
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
  return { guest: true, manager: false, accountId: '', username: `AGENT#${badge}`, badge, name: '', picture: '', charId: '', player: '', inbox: '', messages: [], conversations: [], watch: [] };
}

/** The account these credentials open, as an identity; null when they open none. */
export function findAccount(username, password) {
  const { id, key } = accountKeys(username, password);
  const account = access().accounts.find(entry => entry.id === id);
  if (!account) return null;
  try {
    const details = unseal(key, account);
    const agent = agentOf(details.charId);
    const manager = details.manager === true;
    return {
      guest: false,
      manager,
      accountId: id,
      username: details.username,
      badge: details.badge || String(10000 + Math.floor(Math.random() * 90000)),
      name: manager ? 'Manager' : agent?.name?.trim() || '',
      picture: manager ? getConfig().login.badgePicture : agent?.icon || '',
      charId: details.charId || '',
      player: details.player || '',
      inbox: details.inbox || '',
      messages: Array.isArray(details.messages) ? details.messages : [],
      conversations: Array.isArray(details.conversations) ? details.conversations : [],
      watch: Array.isArray(details.watch) ? details.watch : []   // the Manager's: every channel
    };
  } catch {
    return null;
  }
}

export function setIdentity(next) { identity = next; }
export function getIdentity() { return identity; }

/** How the notifications name whoever is signed in. */
export function who(person = identity) {
  if (!person) return 'Someone';
  if (person.guest) return `Guest ${person.username}`;
  if (person.manager) return `The Manager (${person.username})`;
  return person.name ? `Agent ${person.name} (${person.username})` : `Agent ${person.username}`;
}

/* ---------- notifications to the Manager ---------- */
const preview = () => 'publishPreview' in document.documentElement.dataset;

/** A notification on the Manager's channel; resolves to ntfy's response, or null when it could not be sent. */
export function publish(title, message, tags = []) {
  const { server, notify } = access();
  if (!notify) return Promise.resolve(null);
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

/* ---------- the session ---------- */
/** Signed in: tell the Manager. What is waiting for the player comes from messages.js. */
export function startSession() {
  if (identity && reporting()) publish('Sign-in', `${who()} signed in.`, ['key']);
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
}
