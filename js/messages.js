// messages.js
// What passes between the Manager and the players on a published copy, and between the
// players in character (access.js says who is signed in). All of it travels on ntfy:
//  - The Manager, red: the account's own channel ("inbox"), written to from /settings or
//    the ntfy app, and the message left on the account (sealed in the snapshot). The
//    player's answers stay on that direct channel and are also copied to the Manager's
//    notification channel. A signed-in Manager follows every agent's direct channel.
//  - In character: one channel per conversation (build_static.list_conversations), an
//    agent with another agent (green), one of their relationships (yellow), or their
//    anomaly (blue). An NPC is played by whoever "Played by" names on the relationship;
//    an anomaly is always played by the Manager.
// A message pops up once per agent, not once per device: when it is acknowledged, a receipt
// goes on its channel, and the player's other devices read the receipts before showing
// anything. ntfy.sh keeps messages and receipts 12 hours; each device also remembers what
// it showed, and keeps every conversation's history for the Messages panel.
// The conversations are reached from the Network map of the Relationships tab: the
// characters the player speaks for glow green; pick one, then one of the characters it can
// write to (green too), and the conversation opens in the Messages window. The Messages
// button opens it as well; the Manager is the unlinked red node in the map, while anomalies
// are available from their controlled-character tabs.
//
// On a channel, a message is { title: who writes, message: the text }, tagged with its side
// (ta-agent/ta-npc or ta-a/ta-b). A receipt is { message: the ids, comma separated },
// tagged ta-seen and the side that saw. A one-off Manager transmission may also carry
// ta-class-manager/agent/npc/anomaly, which controls its heading and colour independently
// of the channel side. A Manager message tagged ta-egg-<id> is an easter egg (easterEggs.js),
// played on the agent's screen instead of being typed out.

import { access, getIdentity, publish, who } from './access.js';
import { getConfig, getSnapshot, onConfigChange } from './config.js';
import { EGGS, eggById, playEgg } from './easterEggs.js';
import { playButton } from './soundEffects.js';
import { openModal, toast } from './ui.js';

const TYPE_MS = 24;              // per character of a transmission
const MAX_TEXT = 500;            // characters of anything a player writes
const HISTORY_LIMIT = 200;       // messages kept per conversation on a device
const SEEN_LIMIT = 500;
const ARCHIVE_FILE = './messages.json';
const ARCHIVE_FORMAT = 'triangle-agency-message-archive';
const RECEIPT_DELAY = 1500;      // receipts of one channel go out together
const RECEIPT_RETRY_DELAY = 30000;
const RECEIPT_MAX_BYTES = 3800;  // ntfy's body limit is 4096; keep a comfortable margin
const HEADINGS = { manager: 'Incoming transmission', agent: 'Incoming agent message', npc: 'Incoming message', anomaly: 'Anomalous signal' };
const SIDES = ['agent', 'npc', 'a', 'b'];
const MESSAGE_CLASSES = ['manager', 'agent', 'npc', 'anomaly'];
const EGG_TAG = 'ta-egg-';

let conversations = [];          // the signed-in player's, the Manager's first
const byChannel = new Map();     // channel -> the conversations on it
const histories = new Map();     // channel -> [{ id, time, side, from, text }], oldest first
const receipts = new Map();      // channel -> one Set of seen message ids per conversation side
const localSeen = new Map();     // `${channel}|${side}` -> Set, what this device showed
const offered = new Set();       // `${channel}|${side}|${id}`, already queued this session
let source = null;               // the live EventSource on every channel
let started = false;

/* ---------- storage ---------- */
function storage(action) {
  try { return action(localStorage); } catch { return null; }
}
function readList(key) {
  try { return JSON.parse(storage(store => store.getItem(key)) || '[]'); } catch { return []; }
}
const writeList = (key, list) => storage(store => store.setItem(key, JSON.stringify(list)));

/* ---------- conversations ---------- */
const isTopic = channel => /^[-_A-Za-z0-9]{1,64}$/.test(channel);
const now = () => Math.floor(Date.now() / 1000);
const newMessageId = () => {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  return `ta-${Date.now().toString(36)}-${[...random].map(byte => byte.toString(36).padStart(2, '0')).join('')}`;
};

/** Who the player writes as in a conversation, and who they write to. */
function myName(conv) {
  if (conv.kind === 'agent') return conv.side === 'a' ? conv.agentName : conv.other;
  if (conv.kind === 'manager') return conv.side === 'agent' ? conv.agentName || getIdentity()?.username : 'The Manager';
  return conv.side === 'agent' ? conv.agentName || getIdentity()?.username : conv.other;
}

function theirName(conv) {
  if (conv.kind === 'agent') return conv.side === 'a' ? conv.other : conv.agentName;
  if (conv.kind === 'manager') return conv.side === 'agent' ? 'The Manager' : `Agent ${conv.agentName}`;
  return conv.side === 'agent' ? conv.other : `Agent ${conv.agentName}`;
}

function label(conv) {
  if (conv.kind === 'manager') return { name: conv.side === 'npc' ? `Agent ${conv.agentName}` : 'The Manager', note: 'Direct line' };
  if (conv.kind === 'agent') return { name: theirName(conv), note: 'Agent to agent' };
  if (conv.kind === 'anomaly') return conv.side === 'agent'
    ? { name: conv.other, note: 'Your anomaly' }
    : { name: `${conv.other} → ${conv.agentName}`, note: `You play ${conv.other} · anomaly` };
  if (conv.side === 'agent') return { name: conv.other, note: 'Relationship' };
  return { name: `${conv.other} → ${conv.agentName}`, note: `You play ${conv.other}` };
}

function seenSet(conv) {
  const key = `${conv.channel}|${conv.side}`;
  if (!localSeen.has(key)) localSeen.set(key, new Set(readList(`ta-seen-${key}`)));
  return localSeen.get(key);
}
function receiptSets(channel) {
  if (!receipts.has(channel)) receipts.set(channel, Object.fromEntries(SIDES.map(side => [side, new Set()])));
  return receipts.get(channel);
}
const isSeen = (conv, id) => receiptSets(conv.channel)[conv.side].has(id) || seenSet(conv).has(id);
const incoming = (conv, message) => message.side !== conv.side;

function history(channel) {
  if (!histories.has(channel)) histories.set(channel, readList(`ta-chat-${channel}`));
  return histories.get(channel);
}

/** Keep a message in memory; persist only the recent tail in browser storage. The Google
 * archive can therefore display the complete history without exhausting localStorage. */
function remember(channel, message, { canonical = false } = {}) {
  const list = history(channel);
  const at = list.findIndex(entry => entry.id === message.id);
  if (at !== -1) {
    if (!canonical) return false;
    const cachedTime = Number(list[at].time) || 0;
    const archiveTime = Number(message.time) || 0;
    const canonicalMessage = {
      // An archive that does not carry the egg yet must not turn it into plain text.
      ...(list[at].egg ? { egg: list[at].egg } : {}),
      ...message,
      time: cachedTime && archiveTime ? Math.min(cachedTime, archiveTime) : archiveTime || cachedTime
    };
    const old = list[at];
    const keys = Object.keys(canonicalMessage);
    if (Object.keys(old).length === keys.length && keys.every(key => old[key] === canonicalMessage[key])) return false;
    list[at] = canonicalMessage;
    list.sort((a, b) => a.time - b.time);
    writeList(`ta-chat-${channel}`, list.slice(-HISTORY_LIMIT));
    return false;
  }
  list.push(message);
  list.sort((a, b) => a.time - b.time);
  writeList(`ta-chat-${channel}`, list.slice(-HISTORY_LIMIT));
  return true;
}

/* ---------- ntfy ---------- */
function server() {
  if (getSnapshot()) return access().server;
  try { return new URL(String(getConfig().players.server || '').trim()).origin; }
  catch { return 'https://ntfy.sh'; }
}

/** Post on a channel; resolves to the posted message ({ id, time }), or null. */
function post(topic, body) {
  return fetch(`${server()}/`, { method: 'POST', keepalive: true, body: JSON.stringify({ topic, ...body }) })
    .then(response => (response.ok ? response.json().catch(() => ({})) : null))
    .catch(() => null);
}

/** Everything ntfy still holds on these channels, oldest first. */
async function poll(topics) {
  try {
    const response = await fetch(`${server()}/${topics.join(',')}/json?poll=1&since=all`, { cache: 'no-store' });
    return (await response.text()).split('\n').filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(event => event?.event === 'message')
      .sort((a, b) => a.time - b.time);
  } catch {
    return [];
  }
}

/** A message or receipt off a channel, kept; returns a message new to this device, else null. */
function ingest(event) {
  const tags = event.tags || [];
  // Old NPC/agent messages remain readable; agent-pair messages carry ta-a or ta-b.
  const side = SIDES.find(item => tags.includes(`ta-${item}`)) || 'npc';
  if (tags.includes('ta-seen')) {
    const sets = receiptSets(event.topic);
    const ids = String(event.message || '').split(',').filter(Boolean);
    ids.forEach(id => sets[side].add(id));
    confirmPendingReceipts(event.topic, side, ids);
    updateBadge();
    return null;
  }
  const messageClass = MESSAGE_CLASSES.find(item => tags.includes(`ta-class-${item}`));
  const egg = tags.find(tag => tag.startsWith(EGG_TAG))?.slice(EGG_TAG.length);
  const message = {
    // A rejuvenated ntfy event has a new event id but keeps the original sequence id.
    // Treat the entire sequence as one logical message in history and in read receipts.
    id: event.sequence_id || event.id,
    time: event.time || now(),
    side,
    from: event.title || '',
    text: String(event.message || ''),
    ...(messageClass ? { class: messageClass } : {}),
    ...(egg ? { egg } : {})
  };
  if (!remember(event.topic, message)) return null;
  refreshPanel(event.topic);
  return message;
}

/** Import the collector's permanent history, but only for channels this login owns. */
async function loadPublishedArchive(topics) {
  if (!getSnapshot() || !topics.length) return;
  let archive;
  try {
    const response = await fetch(`${ARCHIVE_FILE}?v=${Date.now()}`, { cache: 'no-store' });
    archive = response.ok ? await response.json() : null;
  } catch {
    return;   // The collector is optional; live ntfy messaging still works without it.
  }
  if (archive?.format !== ARCHIVE_FORMAT || !archive.topics || typeof archive.topics !== 'object') return;
  topics.forEach(channel => {
    const saved = archive.topics[channel];
    if (!saved || typeof saved !== 'object') return;
    const sets = receiptSets(channel);
    SIDES.forEach(side => {
      const ids = (Array.isArray(saved.seen?.[side]) ? saved.seen[side] : []).map(String);
      ids.forEach(id => sets[side].add(id));
      confirmPendingReceipts(channel, side, ids);
    });
    (Array.isArray(saved.messages) ? saved.messages : []).forEach(item => {
      if (!item || !item.id || !SIDES.includes(item.side)) return;
      remember(channel, {
        id: String(item.id),
        time: Number(item.time) || 0,
        side: item.side,
        from: String(item.from || ''),
        text: String(item.text || ''),
        ...(MESSAGE_CLASSES.includes(item.class) ? { class: item.class } : {}),
        ...(typeof item.egg === 'string' && item.egg ? { egg: item.egg } : {})
      }, { canonical: true });
    });
  });
}

/* ---------- receipts ---------- */
const pendingReceipts = new Map();   // `${channel}|${side}` -> Set of ids
let receiptTimer = 0;
let receiptFlush = null;

const pendingReceiptKey = key => `ta-pending-receipts-${key}`;

function persistPendingReceipts(key, ids) {
  if (ids.size) writeList(pendingReceiptKey(key), [...ids]);
  else storage(store => store.removeItem(pendingReceiptKey(key)));
}

function pendingReceiptSet(key) {
  if (!pendingReceipts.has(key)) {
    const saved = readList(pendingReceiptKey(key));
    pendingReceipts.set(key, new Set((Array.isArray(saved) ? saved : []).map(String).filter(Boolean)));
  }
  return pendingReceipts.get(key);
}

function confirmPendingReceipts(channel, side, ids) {
  const key = `${channel}|${side}`;
  const pending = pendingReceipts.get(key);
  if (!pending) return;
  ids.forEach(id => pending.delete(String(id)));
  persistPendingReceipts(key, pending);
  if (!pending.size && pendingReceipts.get(key) === pending) pendingReceipts.delete(key);
}

function receiptBatches(ids) {
  const encoder = new TextEncoder();
  const batches = [];
  let batch = [];
  let bytes = 0;
  ids.forEach(id => {
    const size = encoder.encode(id).length;
    if (batch.length && bytes + 1 + size > RECEIPT_MAX_BYTES) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(id);
    bytes += (batch.length > 1 ? 1 : 0) + size;
  });
  if (batch.length) batches.push(batch);
  return batches;
}

const hasPendingReceipts = () => [...pendingReceipts.values()].some(ids => ids.size);

function scheduleReceiptFlush(delay = RECEIPT_DELAY) {
  if (!receiptTimer) {
    receiptTimer = setTimeout(() => {
      receiptTimer = 0;
      flushReceipts();
    }, delay);
  }
}

function flushReceipts() {
  clearTimeout(receiptTimer);
  receiptTimer = 0;
  if (receiptFlush) return receiptFlush;
  receiptFlush = (async () => {
    for (const [key, ids] of pendingReceipts) {
      const [channel, side] = key.split('|');
      for (const batch of receiptBatches([...ids])) {
        const sent = await post(channel, { message: batch.join(','), tags: ['ta-seen', `ta-${side}`], priority: 1 });
        if (!sent) break;
        batch.forEach(id => ids.delete(id));
        if (pendingReceipts.get(key) === ids) persistPendingReceipts(key, ids);
      }
      if (!ids.size && pendingReceipts.get(key) === ids) pendingReceipts.delete(key);
    }
  })().finally(() => {
    receiptFlush = null;
    if (hasPendingReceipts()) scheduleReceiptFlush(RECEIPT_RETRY_DELAY);
  });
  return receiptFlush;
}

/** Seen by this agent: remembered here, and told to their other devices. */
function markSeen(conv, id) {
  if (isSeen(conv, id)) return;
  const mine = seenSet(conv);
  mine.add(id);
  writeList(`ta-seen-${conv.channel}|${conv.side}`, [...mine].slice(-SEEN_LIMIT));
  receiptSets(conv.channel)[conv.side].add(id);
  if (isTopic(conv.channel)) {
    const key = `${conv.channel}|${conv.side}`;
    const pending = pendingReceiptSet(key);
    pending.add(id);
    persistPendingReceipts(key, pending);
    scheduleReceiptFlush();
  }
  updateBadge();
}

/* ---------- writing ---------- */
/**
 * Send what the player wrote in a conversation. Direct Manager/agent messages share the
 * agent's inbox channel, with a notification copy when the agent writes. In character,
 * messages use the conversation's channel and are copied when the Manager plays the other
 * side or wants every message.
 */
async function send(conv, text, { answering = null, from = '', messageClass = '', egg = '' } = {}) {
  text = text.trim().slice(0, MAX_TEXT);
  if (!text) return false;
  const author = String(from || myName(conv)).trim().slice(0, 80) || myName(conv);
  const className = MESSAGE_CLASSES.includes(messageClass) ? messageClass : '';
  const tags = [`ta-${conv.side}`, ...(className ? [`ta-class-${className}`] : []), ...(egg ? [`${EGG_TAG}${egg}`] : [])];
  const messageId = newMessageId();
  if (conv.kind === 'manager') {
    const sent = await post(conv.channel, { title: author, message: text, tags, sequence_id: messageId });
    if (!sent) return false;
    remember(conv.channel, {
      id: messageId,
      time: sent.time || now(),
      side: conv.side,
      from: author,
      text,
      ...(className ? { class: className } : {}),
      ...(egg ? { egg } : {})
    });
    // Keep the Manager's ntfy subscription useful when they are not signed into the site.
    if (conv.side === 'agent' && access().notify !== conv.channel) {
      const quote = answering ? `\n\n↩ to ${answering.from || 'The Manager'}: “${answering.text.length > 120 ? `${answering.text.slice(0, 117)}…` : answering.text}”` : '';
      publish(`${answering ? 'Reply' : 'Message'} from ${who()}`, text + quote, ['speech_balloon']);
    }
  } else {
    const sent = await post(conv.channel, { title: myName(conv), message: text, tags: [`ta-${conv.side}`], sequence_id: messageId });
    if (!sent) return false;
    remember(conv.channel, { id: messageId, time: sent.time || now(), side: conv.side, from: myName(conv), text });
    if (conv.manager || access().copyChats) {
      const kind = conv.kind === 'anomaly' ? 'anomaly' : 'in character';
      publish(`💬 ${myName(conv)} → ${theirName(conv)}`, `${text}\n\n— ${kind}, written by ${who()}`, ['speech_balloon']);
    }
  }
  refreshPanel(conv.channel);
  return true;
}

/* ---------- transmissions: one message at a time, typed out ---------- */
const queue = [];
let overlay = null;
let showing = false;
let current = null;   // the transmission on screen: { conv, message, finish, close }

const part = name => overlay.querySelector(`.transmission-${name}`);

function buildOverlay() {
  overlay = document.createElement('div');
  overlay.className = 'transmission';
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="transmission-panel">
      <p class="transmission-head"><span class="transmission-dot" aria-hidden="true"></span><span class="transmission-heading"></span></p>
      <p class="transmission-from"></p>
      <div class="transmission-text" aria-live="polite"></div>
      <div class="transmission-reply" hidden>
        <textarea class="transmission-answer" rows="3" maxlength="${MAX_TEXT}" placeholder="Your answer…" aria-label="Your reply"></textarea>
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

async function sendReply() {
  const answer = part('answer');
  if (!answer.value.trim()) {
    answer.focus();
    return;
  }
  const state = part('state');
  const button = part('send');
  button.disabled = answer.readOnly = true;
  state.className = 'transmission-state';
  state.textContent = 'Transmitting…';
  const { conv, message } = current;
  if (await send(conv, answer.value, { answering: message })) {
    state.classList.add('is-ok');
    state.textContent = 'Reply transmitted';
    setTimeout(() => current?.close(), 1200);
  } else {
    state.classList.add('is-error');
    state.textContent = 'Transmission failed · try again';
    button.disabled = answer.readOnly = false;
  }
}

/** Type out one message; it stays until acknowledged or answered, and is then seen. */
function present({ conv, message }) {
  const messageClass = MESSAGE_CLASSES.includes(message.class) ? message.class : conv.kind;
  overlay.className = `transmission tx-${messageClass}`;
  overlay.setAttribute('aria-label', HEADINGS[messageClass]);
  part('heading').textContent = HEADINGS[messageClass];
  part('from').textContent = `From: ${message.from || theirName(conv)} · to ${myName(conv)}`;
  part('text').textContent = '';
  part('reply').hidden = true;
  part('answer').value = '';
  part('answer').readOnly = false;
  part('state').textContent = '';
  // Nowhere for an answer to the Manager to go without the Manager's channel.
  part('answer-button').hidden = !isTopic(conv.channel);
  part('answer-button').textContent = `Reply as ${myName(conv)}`;
  part('send').hidden = true;
  part('send').disabled = false;
  overlay.hidden = false;
  playButton('session', 'badgeRead');
  return new Promise(resolve => {
    const text = message.text;
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
      clearTimeout(timer);
      current = null;
      overlay.hidden = true;
      markSeen(conv, message.id);
      resolve();
    };
    current = { conv, message, finish, close };
    timer = setTimeout(type, 500);
  });
}

/** Queue a message for this agent, unless it has been seen, here or on another device. */
function offer(conv, message) {
  const key = `${conv.channel}|${conv.side}|${message.id}`;
  if (!incoming(conv, message) || !message.text.trim() || isSeen(conv, message.id) || offered.has(key)) return;
  offered.add(key);
  queue.push({ conv, message });
  updateBadge();
  drain();
}

async function drain() {
  if (showing) return;
  showing = true;
  if (!overlay) buildOverlay();
  while (queue.length) {
    const next = queue.shift();
    // Read on another device (or in the panel) while it waited.
    if (isSeen(next.conv, next.message.id)) continue;
    const egg = next.conv.kind === 'manager' && eggById(next.message.egg);
    if (egg) {
      await playEgg(egg);
      markSeen(next.conv, next.message.id);
    } else {
      await present(next);
    }
  }
  showing = false;
}

/* ---------- the Messages panel, grouped by the character this account controls ---------- */
let panel = null;
let button = null;
let openConv = null;   // the conversation on show in the panel
let activePersona = ''; // the controlled character whose conversation list is on show

const unreadIn = conv => history(conv.channel).filter(message => incoming(conv, message) && !isSeen(conv, message.id)).length;

function updateBadge() {
  if (!button) return;
  const unread = conversations.reduce((sum, conv) => sum + unreadIn(conv), 0);
  const badge = button.querySelector('.messages-unread');
  badge.textContent = unread > 99 ? '99+' : String(unread);
  badge.hidden = !unread;
  if (panel && !panel.hidden) renderList();
  decorateMaps();
}

function addButton() {
  const disconnect = document.getElementById('logoutButton');
  if (!disconnect) return;
  button = document.createElement('button');
  button.type = 'button';
  button.id = 'messagesButton';
  button.innerHTML = '<span aria-hidden="true">&#9993;</span> Messages <span class="messages-unread" hidden></span>';
  button.addEventListener('click', () => openPanel());
  disconnect.before(button);
}

function buildPanel() {
  panel = document.createElement('div');
  panel.className = 'messages';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Messages');
  panel.innerHTML = `
    <div class="messages-window">
      <header class="messages-top">
        <p class="messages-title">Messages</p>
        <button type="button" class="messages-close" aria-label="Close">&times;</button>
      </header>
      <div class="messages-personas" role="tablist" aria-label="Controlled character"></div>
      <div class="messages-body">
        <ul class="messages-list" role="list"></ul>
        <section class="messages-thread">
          <header class="messages-thread-top">
            <button type="button" class="messages-back" aria-label="Back to the list">&lsaquo;</button>
            <p class="messages-thread-name"></p>
          </header>
          <ol class="messages-log" aria-live="polite"></ol>
          <div class="messages-compose">
            <textarea rows="2" maxlength="${MAX_TEXT}" aria-label="Your message"></textarea>
            <button type="button" class="messages-send">Transmit</button>
          </div>
          <p class="messages-state" aria-live="polite"></p>
        </section>
      </div>
    </div>`;
  document.body.append(panel);
  panel.addEventListener('click', event => {
    if (event.target.closest('.messages-close')) closePanel();
    else if (event.target.closest('.messages-back')) panel.classList.remove('is-reading');
    else if (event.target.closest('.messages-send')) sendFromPanel();
    const persona = event.target.closest('[data-persona]');
    if (persona) {
      selectPersona(personaGroups()[Number(persona.dataset.persona)]);
      return;
    }
    const item = event.target.closest('[data-conv]');
    if (item) showThread(conversations[Number(item.dataset.conv)]);
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
    if (event.key === 'Enter' && !event.shiftKey && event.target.matches('.messages-compose textarea')) {
      event.preventDefault();
      sendFromPanel();
    }
  });
}

/** The character this account controls on one side of a conversation. */
function controlledPersona(conv) {
  if (conv.kind === 'manager') {
    return conv.side === 'agent'
      ? { key: `agent:${conv.agentId}`, name: conv.agentName || 'Agent' }
      : { key: 'manager', name: 'Manager' };
  }
  if (conv.kind === 'agent') {
    return conv.side === 'a'
      ? { key: `agent:${conv.agentId}`, name: conv.agentName || 'Agent' }
      : { key: `agent:${conv.otherId}`, name: conv.other || 'Agent' };
  }
  if (conv.side === 'agent') return { key: `agent:${conv.agentId}`, name: conv.agentName || 'Agent' };
  const name = conv.other || 'Unnamed character';
  return { key: `npc:${String(name).trim().toLowerCase()}`, name };
}

/** Conversation groups in tab order: initialized chats only, with the account's own
 * agent/Manager first and then its roles. Empty conversations can still be opened from
 * the Relationship Map; after their first message they appear here automatically. */
function personaGroups() {
  const groups = [];
  const byKey = new Map();
  conversations.filter(conv => history(conv.channel).length > 0).forEach(conv => {
    const persona = controlledPersona(conv);
    let group = byKey.get(persona.key);
    if (!group) {
      group = { ...persona, conversations: [] };
      byKey.set(persona.key, group);
      groups.push(group);
    }
    group.conversations.push(conv);
  });
  const identity = getIdentity();
  const preferred = identity?.manager ? 'manager' : identity?.charId ? `agent:${identity.charId}` : '';
  const at = groups.findIndex(group => group.key === preferred);
  if (at > 0) groups.unshift(...groups.splice(at, 1));
  return groups;
}

function renderPersonaTabs(groups) {
  const tabs = panel.querySelector('.messages-personas');
  tabs.replaceChildren(...groups.map((group, index) => {
    const unread = group.conversations.reduce((sum, conv) => sum + unreadIn(conv), 0);
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'messages-persona';
    tab.dataset.persona = String(index);
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(group.key === activePersona));
    const name = document.createElement('span');
    name.textContent = group.name;
    const count = document.createElement('small');
    count.textContent = unread > 99 ? '99+' : String(unread);
    count.hidden = !unread;
    tab.append(name, count);
    return tab;
  }));
  tabs.hidden = !groups.length;
}

function selectPersona(group) {
  if (!group) return;
  activePersona = group.key;
  openConv = group.conversations[0] || null;
  panel.classList.remove('is-reading');
  renderList();
}

function renderList() {
  const list = panel.querySelector('.messages-list');
  const groups = personaGroups();
  if (!groups.some(group => group.key === activePersona)) activePersona = groups[0]?.key || '';
  renderPersonaTabs(groups);
  const visible = groups.find(group => group.key === activePersona)?.conversations || [];
  list.replaceChildren(...visible.map(conv => {
    const { name, note } = label(conv);
    const unread = unreadIn(conv);
    const last = history(conv.channel).at(-1);
    const item = document.createElement('li');
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = `messages-item tx-${conv.kind}${conv === openConv ? ' is-open' : ''}`;
    choose.dataset.conv = String(conversations.indexOf(conv));
    choose.innerHTML = '<span class="messages-dot" aria-hidden="true"></span><span class="messages-who"><strong></strong><small></small></span><span class="messages-count"></span>';
    choose.querySelector('strong').textContent = name;
    choose.querySelector('small').textContent = last ? `${last.side === conv.side ? 'You: ' : ''}${last.text}` : note;
    const count = choose.querySelector('.messages-count');
    count.textContent = unread ? String(unread) : '';
    count.hidden = !unread;
    item.append(choose);
    return item;
  }));
}

const clock = time => {
  const date = new Date(time * 1000);
  const today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString([], today ? { hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function renderThread() {
  const conv = openConv;
  const log = panel.querySelector('.messages-log');
  const { name, note } = label(conv);
  panel.querySelector('.messages-thread').className = `messages-thread tx-${conv.kind}`;
  panel.querySelector('.messages-thread-name').textContent = `${name} · ${note}`;
  const messages = history(conv.channel);
  log.replaceChildren(...messages.map(message => {
    const entry = document.createElement('li');
    const messageClass = MESSAGE_CLASSES.includes(message.class) ? message.class : conv.kind;
    entry.className = `messages-entry tx-${messageClass}${message.side === conv.side ? ' is-mine' : ''}`;
    const meta = document.createElement('small');
    meta.textContent = `${message.side === conv.side ? `You, as ${message.from || myName(conv)}` : message.from || theirName(conv)}${message.time ? ` · ${clock(message.time)}` : ''}`;
    const text = document.createElement('p');
    text.textContent = message.text;
    entry.append(meta, text);
    return entry;
  }));
  if (!messages.length) {
    const empty = document.createElement('li');
    empty.className = 'messages-empty';
    empty.textContent = conv.side === 'npc'
      ? `Nothing yet. Write to Agent ${conv.agentName} as ${conv.other}.`
      : `Nothing yet. Write to ${theirName(conv)}.`;
    log.append(empty);
  }
  log.scrollTop = log.scrollHeight;
  const compose = panel.querySelector('.messages-compose textarea');
  compose.placeholder = `As ${myName(conv)}, to ${theirName(conv)}…`;
  // The Manager is reached through the Manager's channel, if there is one.
  panel.querySelector('.messages-compose').hidden = !isTopic(conv.channel);
  // Reading it here is seeing it.
  messages.filter(message => incoming(conv, message)).forEach(message => markSeen(conv, message.id));
}

function showThread(conv) {
  openConv = conv;
  activePersona = controlledPersona(conv).key;
  panel.classList.add('is-reading');
  panel.querySelector('.messages-state').textContent = '';
  renderThread();
  renderList();
  panel.querySelector('.messages-compose textarea').focus({ preventScroll: true });
}

function refreshPanel(channel) {
  if (!panel || panel.hidden) return;
  renderList();
  if (openConv?.channel === channel) renderThread();
}

/** The Messages window: on a conversation (from the map), or on the list of them all. */
function openPanel(conv = null) {
  if (!panel) buildPanel();
  panel.hidden = false;
  if (conv) {
    showThread(conv);
    return;
  }
  const groups = personaGroups();
  if (!groups.some(group => group.key === activePersona)) activePersona = groups[0]?.key || '';
  const visible = groups.find(group => group.key === activePersona)?.conversations || [];
  openConv = visible.includes(openConv) ? openConv : visible[0] || null;
  panel.classList.remove('is-reading');
  renderList();
}

function closePanel() {
  panel.hidden = true;
}

async function sendFromPanel() {
  const field = panel.querySelector('.messages-compose textarea');
  const state = panel.querySelector('.messages-state');
  const sendButton = panel.querySelector('.messages-send');
  if (!field.value.trim()) return;
  sendButton.disabled = field.readOnly = true;
  state.className = 'messages-state';
  state.textContent = 'Transmitting…';
  const ok = await send(openConv, field.value);
  sendButton.disabled = field.readOnly = false;
  if (ok) {
    field.value = '';
    state.textContent = '';
  } else {
    state.classList.add('is-error');
    state.textContent = 'Transmission failed · try again';
  }
  field.focus({ preventScroll: true });
}

/* ---------- Manager shortcut: agent card -> one-off transmission ---------- */
let localManagerMessaging = false;
let watchingAgentCards = false;
const quickIdentity = { name: 'The Manager', class: 'manager' };

function localDirectLine(agentId) {
  const account = (getConfig().players.accounts || []).find(item =>
    String(item?.charId || '') === String(agentId)
    && String(item?.username || '').trim()
    && item?.password
    && isTopic(String(item?.inbox || '').trim()));
  return account ? { channel: String(account.inbox).trim() } : null;
}

function directLine(agentId) {
  if (getSnapshot()) {
    return getIdentity()?.manager ? managerConversation(agentId, 'npc') : null;
  }
  return localManagerMessaging ? localDirectLine(agentId) : null;
}

function messageClassOptions() {
  return [
    ['manager', 'Manager'],
    ['agent', 'Agent'],
    ['npc', 'Relationship / civilian'],
    ['anomaly', 'Anomaly']
  ].map(([value, label]) => `<option value="${value}"${quickIdentity.class === value ? ' selected' : ''}>${label}</option>`).join('');
}

/** Compose a direct message whose displayed sender and transmission colour are independent. */
function openQuickMessage(card) {
  const line = directLine(card._id);
  if (!line) return;
  const agentName = card.querySelector('[data-stat="name"]')?.value?.trim() || 'Agent';
  const form = document.createElement('form');
  form.className = 'manager-message-form';
  form.innerHTML = `
    <p class="manager-message-target">Direct line to <strong></strong></p>
    <label class="field">
      <span class="field-label">Sender name</span>
      <input name="sender" type="text" maxlength="80" autocomplete="off" value="">
    </label>
    <label class="field">
      <span class="field-label">Transmission class</span>
      <select name="class">${messageClassOptions()}</select>
    </label>
    <label class="field">
      <span class="field-label">Message</span>
      <textarea name="message" rows="5" maxlength="${MAX_TEXT}" autofocus></textarea>
    </label>
    <p class="manager-message-state" aria-live="polite"></p>`;
  form.querySelector('.manager-message-target strong').textContent = agentName;
  const senderField = form.elements.namedItem('sender');
  const classField = form.elements.namedItem('class');
  const messageField = form.elements.namedItem('message');
  senderField.value = quickIdentity.name;
  const state = form.querySelector('.manager-message-state');
  let close = null;

  const transmit = async () => {
    const sender = senderField.value.trim().slice(0, 80);
    const text = messageField.value.trim().slice(0, MAX_TEXT);
    const messageClass = classField.value;
    form.querySelectorAll('.invalid').forEach(field => field.classList.remove('invalid'));
    if (!sender || !text) {
      const field = !sender ? senderField : messageField;
      field.classList.add('invalid');
      field.focus();
      state.textContent = 'Enter a sender name and a message.';
      return;
    }
    quickIdentity.name = sender;
    quickIdentity.class = MESSAGE_CLASSES.includes(messageClass) ? messageClass : 'manager';
    const button = form.closest('.modal-panel')?.querySelector('.modal-btn-primary');
    if (button) button.disabled = true;
    [...form.elements].forEach(field => { field.disabled = true; });
    state.className = 'manager-message-state';
    state.textContent = 'Transmitting…';
    const ok = line.kind
      ? await send(line, text, { from: sender, messageClass: quickIdentity.class })
      : !!(await post(line.channel, {
          title: sender,
          message: text,
          tags: ['ta-npc', `ta-class-${quickIdentity.class}`]
        }));
    if (ok) {
      close?.();
      toast(`Message sent to ${agentName} as ${sender}.`, { kind: 'success' });
      return;
    }
    [...form.elements].forEach(field => { field.disabled = false; });
    if (button) button.disabled = false;
    state.classList.add('is-error');
    state.textContent = 'Transmission failed · try again';
    messageField.focus();
  };

  close = openModal({
    title: `Message ${agentName}`,
    content: form,
    className: `manager-message-modal tx-${quickIdentity.class}`,
    closeLabel: 'Cancel',
    actions: [{ label: 'Transmit', variant: 'primary', submit: true, onClick: () => { transmit(); return false; } }]
  });
  classField.addEventListener('change', () => {
    const modal = form.closest('.manager-message-modal');
    if (!modal) return;
    MESSAGE_CLASSES.forEach(item => modal.classList.remove(`tx-${item}`));
    modal.classList.add(`tx-${classField.value}`);
  });
}

/** The easter eggs the Manager can fire at an agent, each with how it went so far. */
function openEggPicker(card, conv) {
  const agentName = card.querySelector('[data-stat="name"]')?.value?.trim() || 'Agent';
  const list = document.createElement('ul');
  list.className = 'egg-picker';
  let close = null;
  const status = egg => {
    const fired = history(conv.channel).filter(message => message.egg === egg.id);
    if (!fired.length) return 'Mai inviato';
    const played = fired.some(message => receiptSets(conv.channel).agent.has(message.id));
    return played ? 'Già giocato · l’esito è nelle notifiche' : 'Inviato · in attesa dell’agente';
  };
  list.append(...EGGS.map(egg => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = egg.title;
    const summary = document.createElement('p');
    summary.textContent = egg.summary;
    const state = document.createElement('small');
    state.textContent = status(egg);
    const fire = document.createElement('button');
    fire.type = 'button';
    fire.className = 'modal-btn modal-btn-primary';
    fire.textContent = 'Invia';
    fire.addEventListener('click', async () => {
      fire.disabled = true;
      state.textContent = 'Invio…';
      if (await send(conv, egg.title, { from: egg.from, messageClass: 'anomaly', egg: egg.id })) {
        close?.();
        toast(`${egg.title} inviato a ${agentName}. La scelta arriverà come notifica.`, { kind: 'success' });
      } else {
        fire.disabled = false;
        state.textContent = 'Invio non riuscito · riprova';
      }
    });
    item.append(title, summary, state, fire);
    return item;
  }));
  close = openModal({
    title: `Easter egg per ${agentName}`,
    content: list,
    className: 'egg-picker-modal tx-anomaly',
    closeLabel: 'Chiudi'
  });
}

function decorateAgentCards() {
  document.querySelectorAll('#charContainer .char').forEach(card => {
    const line = directLine(card._id);
    let button = card.querySelector(':scope > .agent-message-btn');
    // Easter eggs only on a published copy, where the line is a conversation.
    let eggButton = card.querySelector(':scope > .agent-egg-btn');
    if (!line?.kind) eggButton?.remove();
    if (!line) {
      button?.remove();
      card.classList.remove('has-direct-line');
      return;
    }
    if (line.kind && !eggButton) {
      eggButton = document.createElement('button');
      eggButton.type = 'button';
      eggButton.className = 'agent-egg-btn';
      eggButton.innerHTML = '<span aria-hidden="true">&#10059;</span>';
      eggButton.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const conv = directLine(card._id);
        if (conv?.kind) openEggPicker(card, conv);
      });
      card.append(eggButton);
    }
    card.classList.add('has-direct-line');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'agent-message-btn';
      button.innerHTML = '<span aria-hidden="true">&#9993;</span>';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openQuickMessage(card);
      });
      card.append(button);
    }
    const name = card.querySelector('[data-stat="name"]')?.value?.trim() || 'agent';
    button.title = `Send a message to ${name}`;
    button.setAttribute('aria-label', button.title);
    if (eggButton) {
      eggButton.title = `Fire an easter egg at ${name}`;
      eggButton.setAttribute('aria-label', eggButton.title);
    }
  });
}

function watchAgentCards() {
  decorateAgentCards();
  if (watchingAgentCards) return;
  watchingAgentCards = true;
  const container = document.getElementById('charContainer');
  if (container) new MutationObserver(decorateAgentCards).observe(container, { childList: true });
}

/** Enable the card shortcut on the editable, local Manager tracker. */
export function initManagerMessaging() {
  if (getSnapshot()) return;
  localManagerMessaging = true;
  onConfigChange(decorateAgentCards);
  watchAgentCards();
}

/* ---------- the Network map: who speaks, and to whom ---------- */
const norm = text => String(text || '').trim().toLowerCase();
const SVG_NS = 'http://www.w3.org/2000/svg';
let speaker = null;   // the character the player has picked to write as: { key, type, name, agentIds }

function npcConversation(agentId, npc, side) {
  return conversations.find(conv => conv.kind === 'npc' && conv.side === side && String(conv.agentId) === String(agentId) && norm(conv.other) === norm(npc));
}

/** The agent-to-agent conversation available while speaking as `fromId`. */
function agentConversation(fromId, toId) {
  return conversations.find(conv => {
    if (conv.kind !== 'agent') return false;
    const side = String(conv.agentId) === String(fromId) && String(conv.otherId) === String(toId) ? 'a'
      : String(conv.otherId) === String(fromId) && String(conv.agentId) === String(toId) ? 'b'
        : '';
    return side && conv.side === side;
  }) || null;
}

const localAgentId = conv => conv.side === 'a' ? String(conv.agentId) : conv.side === 'b' ? String(conv.otherId) : '';

function agentPersona(node) {
  const id = String(node.dataset.agentId || '');
  const me = getIdentity();
  const playable = id === String(me.charId || '')
    || conversations.some(conv => conv.kind === 'agent' && localAgentId(conv) === id);
  return playable ? { key: `agent:${id}`, type: 'agent', name: node.dataset.agentName || me.name || 'Agent', agentId: id } : null;
}

function managerConversation(agentId, side) {
  return conversations.find(conv => conv.kind === 'manager' && conv.side === side
    && String(conv.agentId) === String(agentId)) || null;
}

/** Whom this map node lets the player speak as: their own agent, or a relationship they play. */
function personaOf(node) {
  if (node.dataset.manager) return getIdentity()?.manager
    ? { key: 'manager', type: 'manager', name: 'Manager' }
    : null;
  if (node.dataset.agentId) return agentPersona(node);
  if (!node.dataset.npc) return null;
  const agentIds = (node.dataset.agents || '').split(',').filter(id => npcConversation(id, node.dataset.npc, 'npc'));
  return agentIds.length ? { key: `npc:${norm(node.dataset.npc)}`, type: 'npc', name: node.dataset.npc, agentIds } : null;
}

/** The conversation this node opens for the character picked to speak, if it can be written to. */
function conversationTo(node) {
  if (!speaker) return null;
  if (speaker.type === 'manager') {
    return node.dataset.agentId ? managerConversation(node.dataset.agentId, 'npc') : null;
  }
  if (speaker.type === 'agent') {
    if (node.dataset.manager) return managerConversation(speaker.agentId, 'agent');
    if (node.dataset.agentId && node.dataset.agentId !== speaker.agentId) {
      return agentConversation(speaker.agentId, node.dataset.agentId);
    }
    if (!node.dataset.npc || !(node.dataset.agents || '').split(',').includes(speaker.agentId)) return null;
    return npcConversation(speaker.agentId, node.dataset.npc, 'agent') || null;
  }
  if (!node.dataset.agentId || !speaker.agentIds.includes(node.dataset.agentId)) return null;
  return npcConversation(node.dataset.agentId, speaker.name, 'npc') || null;
}

function personaConversations(persona) {
  if (persona.type === 'manager') return conversations.filter(conv => conv.kind === 'manager' && conv.side === 'npc');
  return persona.type === 'agent'
    ? conversations.filter(conv => (conv.kind === 'npc' && conv.side === 'agent' && String(conv.agentId) === persona.agentId)
      || (conv.kind === 'agent' && localAgentId(conv) === persona.agentId))
    : persona.agentIds.map(id => npcConversation(id, persona.name, 'npc')).filter(Boolean);
}

/** A dot on a node with something unread. */
function setDot(node, on) {
  const dot = node.querySelector('.chat-dot');
  if (!on) {
    dot?.remove();
    return;
  }
  if (dot) return;
  const radius = Number(node.dataset.radius) || 20;
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('class', 'chat-dot');
  circle.setAttribute('r', String(Math.max(6, radius * 0.28)));
  circle.setAttribute('cx', (radius * 0.72).toFixed(1));
  circle.setAttribute('cy', (-radius * 0.72).toFixed(1));
  node.append(circle);
}

/** Green on whom the player speaks for, and once one is picked, on whom they can write to. */
function decorateMaps() {
  if (!started) return;
  document.querySelectorAll('.net-map').forEach(map => {
    map.classList.add('chat-map');
    map.classList.toggle('chat-choosing', !!speaker);
    map.querySelectorAll('.net-node').forEach(node => {
      const persona = personaOf(node);
      const conv = conversationTo(node);
      node.classList.toggle('chat-can', !!persona && !speaker);
      node.classList.toggle('chat-speaker', !!persona && persona.key === speaker?.key);
      node.classList.toggle('chat-to', !!conv);
      const unread = conv ? unreadIn(conv) : persona && !speaker ? personaConversations(persona).reduce((sum, item) => sum + unreadIn(item), 0) : 0;
      setDot(node, unread > 0);
    });
    let hint = map.parentElement.querySelector('.net-chat-hint');
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'net-chat-hint';
      map.before(hint);
    }
    hint.textContent = speaker
      ? `Speaking as ${speaker.name}: pick, in green, whom to write to. Anywhere else on the map to stop.`
      : 'In green, the characters you speak for: pick one to write as them.';
  });
}

/** A press on the map: pick who speaks, then whom to; everything else on it works as usual. */
function pressMap(event) {
  if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
  const map = event.target.closest?.('.chat-map');
  if (!map) return;
  const node = event.target.closest('.net-node');
  const conv = node && conversationTo(node);
  const persona = node && personaOf(node);
  if (!conv && !persona && !speaker) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (conv) {
    openPanel(conv);
    return;
  }
  speaker = persona && persona.key !== speaker?.key ? persona : null;
  decorateMaps();
}

function watchMaps() {
  document.addEventListener('click', pressMap, true);
  document.addEventListener('keydown', pressMap, true);
  // The Relationships tab draws its map again on every visit and change.
  new MutationObserver(() => {
    if (document.querySelector('.net-map:not(.chat-map)')) decorateMaps();
  }).observe(document.body, { childList: true, subtree: true });
  decorateMaps();
}

/* ---------- the session ---------- */
/** Signed in with an account: everything waiting for this agent, then whatever arrives. */
export async function startMessages() {
  const identity = getIdentity();
  if (started || !identity || identity.guest) return;
  started = true;
  const manager = identity.manager ? null : {
    channel: isTopic(identity.inbox) ? identity.inbox : `manager:${identity.username}`,   // ':' is never a channel
    kind: 'manager', side: 'agent', agentId: identity.charId, agentName: identity.name, other: 'The Manager', manager: true
  };
  conversations = [...(manager ? [manager] : []), ...identity.conversations.filter(conv => isTopic(conv.channel))];
  for (const conv of conversations) {
    if (!byChannel.has(conv.channel)) byChannel.set(conv.channel, []);
    byChannel.get(conv.channel).push(conv);
    if (isTopic(conv.channel)) pendingReceiptSet(`${conv.channel}|${conv.side}`);
  }
  addButton();
  if (identity.manager) watchAgentCards();
  watchMaps();

  const topics = [...byChannel.keys()].filter(isTopic);
  const since = now();
  await loadPublishedArchive(topics);
  if (topics.length) (await poll(topics)).forEach(ingest);
  if (hasPendingReceipts()) scheduleReceiptFlush();
  // What waited: the message left on the account first, then the rest in the order sent.
  identity.messages.forEach(left => {
    const message = { id: `left-${left.id}`, time: 0, side: 'npc', from: 'The Manager', text: left.text };
    if (manager) {
      remember(manager.channel, message);
      offer(manager, message);
    }
  });
  conversations
    .flatMap(conv => history(conv.channel).map(message => ({ conv, message })))
    .sort((a, b) => a.message.time - b.message.time)
    .forEach(({ conv, message }) => offer(conv, message));
  updateBadge();

  if (!topics.length || typeof EventSource === 'undefined') return;
  source = new EventSource(`${server()}/${topics.join(',')}/sse?since=${since}`);
  source.addEventListener('message', event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    if (data.event !== 'message') return;
    const message = ingest(data);
    if (message) (byChannel.get(data.topic) || []).forEach(conv => offer(conv, message));
  });
}

/** Log Out: the last receipts go out, and nothing more comes in. */
export function stopMessages() {
  flushReceipts();
  source?.close();
  source = null;
}
