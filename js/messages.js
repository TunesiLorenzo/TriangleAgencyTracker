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
import { getConfig, getSnapshot } from './config.js';
import { EGGS, eggById, normalizeCustomTest, playCustomTest, playEgg } from './easterEggs.js';
import { playButton } from './soundEffects.js';
import { confirmDialog, openModal, toast } from './ui.js';

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
const CUSTOM_TEST_TAG = 'ta-custom-test';
// The Manager's custom tests: at least this many choices (or an open answer), and no more than
// fits in one ntfy message (4096 bytes), with room to spare.
const MIN_TEST_CHOICES = 2;
const MAX_TEST_BYTES = 3800;
const TEST_CHOICE_COLOURS = ['#64d2ff', '#ffd60a', '#ff9f0a', '#30d158', '#bf5af2', '#ff453a', '#5e5ce6', '#ff375f'];
const EVENT_RESULT_TAG = 'ta-event-result';
const EVENT_RESULT_DELETE_TAG = 'ta-event-result-delete';
const LEGACY_EGG_RESULT_TAG = 'ta-egg-result';
const EVENT_RESULT_RETRY_DELAY = 30000;

let conversations = [];          // the signed-in player's, the Manager's first
const byChannel = new Map();     // channel -> the conversations on it
const histories = new Map();     // channel -> [{ id, time, side, from, text }], oldest first
const receipts = new Map();      // channel -> one Set of seen message ids per conversation side
const localSeen = new Map();     // `${channel}|${side}` -> Set, what this device showed
const deletedMessages = new Map(); // channel -> IDs purged by the durable collector
const eventResults = new Map();  // channel -> Map(source message id -> structured result)
const eventResultDeleted = new Map(); // channel -> Set(source message ids hidden permanently)
let eventTrackerBody = null;
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
const PENDING_EVENT_RESULTS_KEY = 'ta-pending-event-results';
const LEGACY_PENDING_EGG_RESULTS_KEY = 'ta-pending-egg-results';

const trackedEventCatalog = new Map();
const eventTypeKey = (category, eventId) => `${category}:${eventId}`;

/** Register something that should appear for every user, including before it is sent.
 * Future modules can call this once with { category, eventId, title, summary }. */
export function registerTrackedEvent(definition) {
  const category = String(definition?.category || 'event').slice(0, 80);
  const eventId = String(definition?.eventId || definition?.id || '').slice(0, 80);
  if (!/^[-_A-Za-z0-9]{1,80}$/.test(category) || !/^[-_A-Za-z0-9]{1,80}$/.test(eventId)) return false;
  trackedEventCatalog.set(eventTypeKey(category, eventId), {
    category,
    eventId,
    title: String(definition?.title || eventId).slice(0, 160),
    summary: String(definition?.summary || '').slice(0, 1000)
  });
  renderEventTracker();
  return true;
}

EGGS.forEach(egg => registerTrackedEvent({
  category: 'easter-egg', eventId: egg.id, title: egg.title, summary: egg.summary
}));

/* ---------- conversations ---------- */
const isTopic = channel => /^[-_A-Za-z0-9]{1,64}$/.test(channel);
const now = () => Math.floor(Date.now() / 1000);
const newMessageId = () => {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);
  return `ta-${Date.now().toString(36)}-${[...random].map(byte => byte.toString(36).padStart(2, '0')).join('')}`;
};

/** The colour a conversation is drawn in: a relationship marked as an anomaly is blue, like the agent's own. */
const colourOf = conv => (conv.kind === 'npc' && conv.anomaly ? 'anomaly' : conv.kind);
const conversationClosed = conv => conv?.dead === true;

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
  if (conv.side === 'agent') return { name: conv.other, note: conversationClosed(conv) ? 'Deceased · messages disabled' : conv.anomaly ? 'Anomaly' : 'Relationship' };
  return { name: `${conv.other} → ${conv.agentName}`, note: conversationClosed(conv) ? 'Deceased · messages disabled' : `You play ${conv.other}${conv.anomaly ? ' · anomaly' : ''}` };
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

// Test definitions are transport data, not a chat transcript. Keep the direct-line history
// readable after a Manager-authored test has been delivered.
function displayMessageText(message) {
  return message?.test ? `[Custom test] ${message.test.title}` : String(message?.text || '');
}

function deletedSet(channel) {
  if (!deletedMessages.has(channel)) deletedMessages.set(channel, new Set());
  return deletedMessages.get(channel);
}

function applyDeleted(channel, ids) {
  const purged = deletedSet(channel);
  ids.forEach(id => purged.add(String(id)));
  if (!purged.size) return;
  const kept = history(channel).filter(message => !purged.has(String(message.id)));
  histories.set(channel, kept);
  writeList(`ta-chat-${channel}`, kept.slice(-HISTORY_LIMIT));
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
      // An archive that does not carry an interactive definition yet must not turn it into plain text.
      ...(list[at].egg ? { egg: list[at].egg } : {}),
      ...(list[at].test ? { test: list[at].test } : {}),
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

function normalizeEventResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const sourceId = String(value.sourceId || '').slice(0, 160);
  const eventId = String(value.eventId || value.egg || '').slice(0, 80);
  const category = String(value.category || (value.egg ? 'easter-egg' : 'event')).slice(0, 80);
  const status = String(value.status || value.verdict || '').slice(0, 32);
  if (!sourceId || !/^[-_A-Za-z0-9]{1,80}$/.test(eventId)
      || !/^[-_A-Za-z0-9]{1,80}$/.test(category)
      || !/^[-_A-Za-z0-9]{1,32}$/.test(status)) return null;
  return {
    sourceId,
    eventId,
    category,
    title: String(value.title || '').slice(0, 160),
    status,
    choice: String(value.choice || '').slice(0, 160),
    outcome: String(value.outcome || '').slice(0, 1000),
    reward: String(value.reward || value.boon || '').slice(0, 1000),
    time: Number(value.time) || 0
  };
}

function deletedEventResults(channel) {
  if (!eventResultDeleted.has(channel)) eventResultDeleted.set(channel, new Set());
  return eventResultDeleted.get(channel);
}

function applyDeletedEventResults(channel, sourceIds) {
  const deleted = deletedEventResults(channel);
  const saved = eventResults.get(channel);
  sourceIds.map(String).filter(Boolean).forEach(sourceId => {
    deleted.add(sourceId);
    saved?.delete(sourceId);
  });
  renderEventTracker();
}

function rememberEventResult(channel, value) {
  const result = normalizeEventResult(value);
  if (!result || deletedEventResults(channel).has(result.sourceId)) return false;
  if (!eventResults.has(channel)) eventResults.set(channel, new Map());
  const saved = eventResults.get(channel);
  const previous = saved.get(result.sourceId);
  if (previous && JSON.stringify(previous) === JSON.stringify(result)) return false;
  saved.set(result.sourceId, result);
  renderEventTracker();
  return true;
}

function eventResultFromEvent(event) {
  try { return normalizeEventResult(JSON.parse(String(event.message || ''))); }
  catch { return null; }
}

function customTestFromPayload(payload) {
  try { return normalizeCustomTest((JSON.parse(String(payload || '')) || {}).customTest); }
  catch { return null; }
}

function deletedEventResultFromEvent(event) {
  try { return String((JSON.parse(String(event.message || '')) || {}).sourceId || '').slice(0, 160); }
  catch { return ''; }
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
  if (tags.includes(EVENT_RESULT_DELETE_TAG)) {
    const sourceId = deletedEventResultFromEvent(event);
    if (sourceId) applyDeletedEventResults(event.topic, [sourceId]);
    return null;
  }
  if (tags.includes(EVENT_RESULT_TAG) || tags.includes(LEGACY_EGG_RESULT_TAG)) {
    const result = eventResultFromEvent(event);
    if (result) rememberEventResult(event.topic, result);
    return null;
  }
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
  const id = String(event.sequence_id || event.id || '');
  if (!id || deletedSet(event.topic).has(id)) return null;
  const messageClass = MESSAGE_CLASSES.find(item => tags.includes(`ta-class-${item}`));
  const egg = tags.find(tag => tag.startsWith(EGG_TAG))?.slice(EGG_TAG.length);
  const test = tags.includes(CUSTOM_TEST_TAG) ? customTestFromPayload(event.message) : null;
  const message = {
    // A rejuvenated ntfy event has a new event id but keeps the original sequence id.
    // Treat the entire sequence as one logical message in history and in read receipts.
    id,
    time: event.time || now(),
    side,
    from: event.title || '',
    text: String(event.message || ''),
    ...(messageClass ? { class: messageClass } : {}),
    ...(egg ? { egg } : {}),
    ...(test ? { test } : {})
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
    applyDeleted(channel, Array.isArray(saved.deleted) ? saved.deleted : []);
    applyDeletedEventResults(channel, Array.isArray(saved.eventResultDeleted) ? saved.eventResultDeleted : []);
    const sets = receiptSets(channel);
    SIDES.forEach(side => {
      const ids = (Array.isArray(saved.seen?.[side]) ? saved.seen[side] : []).map(String);
      ids.forEach(id => sets[side].add(id));
      confirmPendingReceipts(channel, side, ids);
    });
    (Array.isArray(saved.messages) ? saved.messages : []).forEach(item => {
      if (!item || !item.id || !SIDES.includes(item.side) || deletedSet(channel).has(String(item.id))) return;
      const test = normalizeCustomTest(item.test)
        || (Array.isArray(item.tags) && item.tags.includes(CUSTOM_TEST_TAG) ? customTestFromPayload(item.text) : null);
      remember(channel, {
        id: String(item.id),
        time: Number(item.time) || 0,
        side: item.side,
        from: String(item.from || ''),
        text: String(item.text || ''),
        ...(MESSAGE_CLASSES.includes(item.class) ? { class: item.class } : {}),
        ...(typeof item.egg === 'string' && item.egg ? { egg: item.egg } : {}),
        ...(test ? { test } : {})
      }, { canonical: true });
    });
    const archivedResults = Array.isArray(saved.eventResults) ? saved.eventResults
      : Array.isArray(saved.eggResults) ? saved.eggResults
        : [];
    archivedResults.forEach(result => {
      rememberEventResult(channel, result);
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

/* ---------- durable tracked-event results ---------- */
let eventResultFlush = null;
let eventResultTimer = 0;
let eventResultQueue = null;

function pendingEventResults() {
  if (eventResultQueue === null) {
    const current = readList(PENDING_EVENT_RESULTS_KEY);
    const saved = current.length ? current : readList(LEGACY_PENDING_EGG_RESULTS_KEY);
    eventResultQueue = (Array.isArray(saved) ? saved : []).filter(item =>
      item && isTopic(String(item.channel || '')) && SIDES.includes(item.side)
        && normalizeEventResult(item.result));
  }
  return eventResultQueue;
}

function savePendingEventResults(items) {
  eventResultQueue = items;
  if (items.length) writeList(PENDING_EVENT_RESULTS_KEY, items);
  else storage(store => store.removeItem(PENDING_EVENT_RESULTS_KEY));
  storage(store => store.removeItem(LEGACY_PENDING_EGG_RESULTS_KEY));
}

function scheduleEventResultFlush(delay = 0) {
  if (eventResultTimer || eventResultFlush) return;
  eventResultTimer = setTimeout(() => {
    eventResultTimer = 0;
    flushEventResults();
  }, delay);
}

function flushEventResults() {
  clearTimeout(eventResultTimer);
  eventResultTimer = 0;
  if (eventResultFlush) return eventResultFlush;
  eventResultFlush = (async () => {
    const pending = pendingEventResults();
    const left = [];
    for (const item of pending) {
      const result = normalizeEventResult(item.result);
      const sent = await post(item.channel, {
        title: 'Tracked event result',
        message: JSON.stringify(result),
        tags: [EVENT_RESULT_TAG, `ta-${item.side}`],
        sequence_id: newMessageId()
      });
      if (!sent) left.push(item);
    }
    savePendingEventResults(left);
    return left.length;
  })().finally(() => {
    eventResultFlush = null;
    if (pendingEventResults().length) scheduleEventResultFlush(EVENT_RESULT_RETRY_DELAY);
  });
  return eventResultFlush;
}

function queueEventResult(conv, sourceId, value) {
  const result = normalizeEventResult({ ...value, sourceId });
  if (!result || !isTopic(conv.channel)) return;
  const pending = pendingEventResults();
  const key = `${conv.channel}|${result.sourceId}`;
  const item = { channel: conv.channel, side: conv.side, result };
  const at = pending.findIndex(entry => `${entry.channel}|${entry.result?.sourceId}` === key);
  if (at === -1) pending.push(item);
  else pending[at] = item;
  savePendingEventResults(pending);
  scheduleEventResultFlush();
}

/** Record a future interactive event for the signed-in agent on their Manager line.
 * Returns the stable source ID, or an empty string when that account has no direct line. */
export function recordTrackedEventResult(value) {
  const conv = conversations.find(item => item.kind === 'manager' && item.side === 'agent' && isTopic(item.channel));
  if (!conv) return '';
  const sourceId = String(value?.sourceId || newMessageId()).slice(0, 160);
  queueEventResult(conv, sourceId, value);
  return sourceId;
}

/* ---------- writing ---------- */
/**
 * Send what the player wrote in a conversation. Direct Manager/agent messages share the
 * agent's inbox channel, with a notification copy when the agent writes. In character,
 * messages use the conversation's channel and are copied when the Manager plays the other
 * side or wants every message.
 */
async function send(conv, text, { answering = null, from = '', messageClass = '', egg = '', customTest = null, notify = null } = {}) {
  if (conversationClosed(conv)) return false;
  const test = normalizeCustomTest(customTest);
  text = test ? JSON.stringify({ customTest: test }) : text.trim().slice(0, MAX_TEXT);
  if (!text) return false;
  const author = String(from || myName(conv)).trim().slice(0, 80) || myName(conv);
  const className = MESSAGE_CLASSES.includes(messageClass) ? messageClass : '';
  const tags = [`ta-${conv.side}`, ...(className ? [`ta-class-${className}`] : []), ...(egg ? [`${EGG_TAG}${egg}`] : []), ...(test ? [CUSTOM_TEST_TAG] : [])];
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
      ...(egg ? { egg } : {}),
      ...(test ? { test } : {})
    });
    // Keep the Manager's ntfy subscription useful when they are not signed into the site.
    if (conv.side === 'agent' && access().notify !== conv.channel && notify) {
      publish(notify.title, notify.text, notify.tags);
    } else if (conv.side === 'agent' && access().notify !== conv.channel) {
      const answerText = displayMessageText(answering);
      const quote = answering ? `\n\n↩ to ${answering.from || 'The Manager'}: “${answerText.length > 120 ? `${answerText.slice(0, 117)}…` : answerText}”` : '';
      publish(`${answering ? 'Reply' : 'Message'} from ${who()}`, text + quote, ['speech_balloon']);
    }
  } else {
    const sent = await post(conv.channel, { title: myName(conv), message: text, tags: [`ta-${conv.side}`], sequence_id: messageId });
    if (!sent) return false;
    remember(conv.channel, { id: messageId, time: sent.time || now(), side: conv.side, from: myName(conv), text });
    if (conv.manager || access().copyChats) {
      const kind = colourOf(conv) === 'anomaly' ? 'anomaly' : 'in character';
      publish(`💬 ${myName(conv)} → ${theirName(conv)}`, `${text}\n\n— ${kind}, written by ${who()}`, ['speech_balloon']);
    }
  }
  refreshPanel(conv.channel);
  return true;
}

/* ---------- purchase requests ---------- */
/** The signed-in agent's direct line to the Manager, which carries their purchase requests:
 * none for the Manager, a guest, or an account without a channel of its own. */
function purchaseLine() {
  const identity = getIdentity();
  if (!started || !identity || identity.guest || identity.manager) return null;
  return conversations.find(conv => conv.kind === 'manager' && conv.side === 'agent' && isTopic(conv.channel)) || null;
}

/** The agent (card id) whose player can ask the Manager for an Acquisizione here, or ''. */
export function purchasingAgentId() {
  return purchaseLine() ? String(getIdentity().charId || '') : '';
}

/**
 * Ask the Manager for an Acquisizione: a message on the agent's direct line (so it stays in
 * their Messages history, the Communication Center and the Manager's view of the line) and a
 * 🛒 notification on the Manager's channel. The Manager gives the item, takes the Note di
 * Merito and publishes; nothing here changes the team. `option`: which way to get it (a size,
 * rented or bought); `cost`: its price in Note di Merito, null when the Manager sets it ("Altro…");
 * `available`: the agent's banked Note di Merito. Resolves to whether it was sent.
 */
export async function requestPurchase({ item, option = '', cost = null, available = null, note = '' } = {}) {
  const conv = purchaseLine();
  item = String(item || '').trim().slice(0, 120);
  option = String(option || '').trim().slice(0, 80);
  note = String(note || '').trim().slice(0, 300);
  if (!conv || !item) return false;
  const what = option ? `${item} (${option})` : item;
  const price = Number.isInteger(cost) ? cost : null;
  const balance = Number.isInteger(available) ? available : null;
  const costLine = price === null ? 'Costo: da concordare' : `Costo: ★ ${price} Note di Merito`;
  const balanceLine = balance === null ? '' : ` · disponibili ★ ${balance}`;
  const managerCost = price === null
    ? 'Cost: not in the catalog, set it yourself'
    : `Cost: ${price} Note di Merito${balance === null ? '' : ` (they have ${balance}, ${balance - price} left after)`}`;
  return send(conv, `🛒 Richiesta di acquisto: ${what}\n${costLine}${balanceLine}${note ? `\nNota: ${note}` : ''}`, {
    notify: {
      title: `🛒 Purchase request from ${who()}`,
      text: `${what}\n${managerCost}${note ? `\n\n“${note}”` : ''}\n\nGive it on the Agency tab, take the Note di Merito, then publish.`,
      tags: ['shopping_cart']
    }
  });
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
  const messageClass = MESSAGE_CLASSES.includes(message.class) ? message.class : colourOf(conv);
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
  part('answer-button').hidden = !isTopic(conv.channel) || conversationClosed(conv);
  part('answer-button').textContent = `Reply as ${myName(conv)}`;
  part('send').hidden = true;
  part('send').disabled = false;
  overlay.hidden = false;
  playButton('session', 'badgeRead');
  return new Promise(resolve => {
  const text = displayMessageText(message);
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
  // Old clients may still post after the relationship was marked dead. Acknowledge the
  // blocked message so the collector does not rejuvenate it, but never present it.
  if (conversationClosed(conv)) {
    markSeen(conv, message.id);
    return;
  }
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
    const test = next.conv.kind === 'manager' && next.message.test;
    if (egg) {
      await playEgg(egg, result => queueEventResult(next.conv, next.message.id, result));
      markSeen(next.conv, next.message.id);
    } else if (test) {
      await playCustomTest(test, result => queueEventResult(next.conv, next.message.id, result));
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

const unreadIn = conv => conversationClosed(conv) ? 0
  : history(conv.channel).filter(message => incoming(conv, message) && !isSeen(conv, message.id)).length;

function updateBadge() {
  renderEventTracker();
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
  if (getIdentity()?.manager) {
    const tracker = document.createElement('button');
    tracker.type = 'button';
    tracker.id = 'eventTrackerButton';
    tracker.innerHTML = '<span aria-hidden="true">&#10003;</span> Event log';
    tracker.addEventListener('click', openEventTracker);
    disconnect.before(tracker);
  }
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
  // An account on no agent (a test account) has no map node to start a chat from:
  // its line to the Manager is listed from the start.
  const identity = getIdentity();
  const listedEmpty = conv => conv.kind === 'manager' && conv.side === 'agent' && isTopic(conv.channel)
    && !identity?.manager && !identity?.charId;
  conversations.filter(conv => history(conv.channel).length > 0 || listedEmpty(conv)).forEach(conv => {
    const persona = controlledPersona(conv);
    let group = byKey.get(persona.key);
    if (!group) {
      group = { ...persona, conversations: [] };
      byKey.set(persona.key, group);
      groups.push(group);
    }
    group.conversations.push(conv);
  });
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
    choose.className = `messages-item tx-${colourOf(conv)}${conv === openConv ? ' is-open' : ''}${conversationClosed(conv) ? ' is-dead' : ''}`;
    choose.dataset.conv = String(conversations.indexOf(conv));
    choose.innerHTML = '<span class="messages-dot" aria-hidden="true"></span><span class="messages-who"><strong></strong><small></small></span><span class="messages-count"></span>';
    choose.querySelector('strong').textContent = name;
    choose.querySelector('small').textContent = last ? `${last.side === conv.side ? 'You: ' : ''}${displayMessageText(last)}` : note;
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

function managerDirectLines() {
  const unique = new Map();
  conversations
    .filter(conv => conv.kind === 'manager' && conv.side === 'npc')
    .forEach(conv => { if (!unique.has(conv.channel)) unique.set(conv.channel, conv); });
  return [...unique.values()].sort((a, b) => String(a.agentName || '').localeCompare(String(b.agentName || '')));
}

function trackedAttempts(conv) {
  const deleted = deletedEventResults(conv.channel);
  return history(conv.channel)
    .filter(message => (message.egg || message.test) && !deleted.has(message.id))
    .map(message => message.test
      ? { id: message.id, time: message.time, category: 'custom-test', eventId: message.test.id, test: message.test }
      : { id: message.id, time: message.time, category: 'easter-egg', eventId: message.egg });
}

function trackedEventTypesFor(conv) {
  const types = new Map([...trackedEventCatalog].map(([key, value]) => [key, { ...value }]));
  trackedAttempts(conv).forEach(attempt => {
    const key = eventTypeKey(attempt.category, attempt.eventId);
    if (!types.has(key)) types.set(key, {
      category: attempt.category,
      eventId: attempt.eventId,
      title: attempt.test?.title || eggById(attempt.eventId)?.title || attempt.eventId,
      summary: attempt.test?.description || eggById(attempt.eventId)?.summary || ''
    });
  });
  (eventResults.get(conv.channel) || new Map()).forEach(result => {
    const key = eventTypeKey(result.category, result.eventId);
    if (!types.has(key)) types.set(key, {
      category: result.category,
      eventId: result.eventId,
      title: result.title || result.eventId,
      summary: ''
    });
  });
  return [...types.values()];
}

function attemptStatus(conv, attempt, result) {
  if (result) return {
    label: ['pass', 'passed'].includes(result.status) ? 'Passed'
      : ['fail', 'failed'].includes(result.status) ? 'Failed'
        : result.status.replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase()),
    className: ['pass', 'passed'].includes(result.status) ? 'is-pass'
      : ['fail', 'failed'].includes(result.status) ? 'is-fail'
        : 'is-recorded',
    detail: [result.choice ? `Choice: ${result.choice}` : '', result.outcome, result.reward ? `Reward: ${result.reward}` : ''].filter(Boolean)
  };
  if (receiptSets(conv.channel).agent.has(attempt.id)) return {
    label: 'Discovered · result unavailable',
    className: 'is-legacy',
    detail: ['This attempt was acknowledged before structured result tracking was available.']
  };
  return { label: 'Awaiting agent', className: 'is-pending', detail: [] };
}

async function removeTrackedEventRecord(conv, attempt, type) {
  const confirmed = await confirmDialog({
    title: 'Remove event record?',
    message: `${type.title} for ${conv.agentName || 'this agent'} will disappear from the Event log and cannot be restored by an old ntfy event.`,
    confirmLabel: 'Remove record',
    danger: true
  });
  if (!confirmed) return;
  const sent = await post(conv.channel, {
    title: 'Tracked event record removed',
    message: JSON.stringify({ sourceId: attempt.id, eventId: type.eventId, category: type.category, time: now() }),
    tags: [EVENT_RESULT_DELETE_TAG, `ta-${conv.side}`],
    sequence_id: newMessageId()
  });
  if (!sent) {
    toast('The event record could not be removed. Check the connection and try again.', { kind: 'error' });
    return;
  }
  applyDeletedEventResults(conv.channel, [attempt.id]);
  toast(`${type.title} removed from the Event log.`, { kind: 'success' });
}

function renderEventTracker() {
  if (!eventTrackerBody) return;
  const lines = managerDirectLines();
  if (!lines.length) {
    const empty = document.createElement('p');
    empty.className = 'egg-ledger-empty';
    empty.textContent = 'No agent account has a direct message channel, so there is nothing to track yet.';
    eventTrackerBody.replaceChildren(empty);
    return;
  }

  eventTrackerBody.replaceChildren(...lines.map(conv => {
    const card = document.createElement('article');
    card.className = 'egg-ledger-agent';
    const heading = document.createElement('header');
    const name = document.createElement('h3');
    name.textContent = `${conv.agentName || 'Unnamed agent'}${conv.username ? ` · ${conv.username}` : ''}`;
    const results = eventResults.get(conv.channel) || new Map();
    const attempts = trackedAttempts(conv);
    const totals = [...results.values()].reduce((count, result) => {
      if (['pass', 'passed'].includes(result.status)) count.pass++;
      else if (['fail', 'failed'].includes(result.status)) count.fail++;
      else count.other++;
      return count;
    }, { pass: 0, fail: 0, other: 0 });
    const summary = document.createElement('p');
    const unresolved = attempts.filter(message => !results.has(message.id));
    const legacy = unresolved.filter(message => receiptSets(conv.channel).agent.has(message.id)).length;
    const waiting = unresolved.length - legacy;
    summary.textContent = `${totals.pass} passed · ${totals.fail} failed${totals.other ? ` · ${totals.other} recorded` : ''}${waiting ? ` · ${waiting} awaiting` : ''}${legacy ? ` · ${legacy} legacy` : ''}`;
    heading.append(name, summary);

    const tests = document.createElement('div');
    tests.className = 'egg-ledger-tests';
    trackedEventTypesFor(conv).forEach(type => {
      const section = document.createElement('section');
      section.className = 'egg-ledger-test';
      const title = document.createElement('h4');
      title.textContent = type.title;
      section.append(title);
      if (type.summary) {
        const description = document.createElement('p');
        description.className = 'egg-ledger-description';
        description.textContent = type.summary;
        section.append(description);
      }
      const recorded = [...results.values()].filter(result => result.category === type.category && result.eventId === type.eventId);
      const fired = attempts.filter(attempt => attempt.category === type.category && attempt.eventId === type.eventId);
      const knownIds = new Set(fired.map(message => message.id));
      const all = [
        ...fired,
        ...recorded.filter(result => !knownIds.has(result.sourceId)).map(result => ({
          id: result.sourceId, time: result.time, category: result.category, eventId: result.eventId
        }))
      ].sort((a, b) => Number(b.time || 0) - Number(a.time || 0));
      if (!all.length) {
        const none = document.createElement('p');
        none.className = 'egg-ledger-none';
        none.textContent = 'Not sent';
        section.append(none);
      } else {
        const list = document.createElement('ol');
        list.className = 'egg-ledger-attempts';
        all.forEach((attempt, index) => {
          const result = results.get(attempt.id);
          const status = attemptStatus(conv, attempt, result);
          const item = document.createElement('li');
          item.className = status.className;
          const line = document.createElement('p');
          const label = document.createElement('strong');
          label.textContent = status.label;
          const date = document.createElement('time');
          date.textContent = attempt.time ? clock(attempt.time) : `Attempt ${all.length - index}`;
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'egg-ledger-remove';
          remove.textContent = 'Remove';
          remove.setAttribute('aria-label', `Remove ${type.title} record for ${conv.agentName || 'agent'}`);
          remove.addEventListener('click', () => removeTrackedEventRecord(conv, attempt, type));
          line.append(label, date, remove);
          item.append(line);
          status.detail.forEach(text => {
            const detail = document.createElement('small');
            detail.textContent = text;
            item.append(detail);
          });
          list.append(item);
        });
        section.append(list);
      }
      tests.append(section);
    });
    card.append(heading, tests);
    return card;
  }));
}

function openEventTracker() {
  const content = document.createElement('div');
  content.className = 'egg-ledger';
  eventTrackerBody = content;
  renderEventTracker();
  openModal({
    title: 'Agency event log',
    content,
    className: 'egg-ledger-modal',
    closeLabel: 'Close event log',
    onClose: () => { if (eventTrackerBody === content) eventTrackerBody = null; }
  });
}

function renderThread() {
  const conv = openConv;
  const log = panel.querySelector('.messages-log');
  const { name, note } = label(conv);
  panel.querySelector('.messages-thread').className = `messages-thread tx-${colourOf(conv)}${conversationClosed(conv) ? ' is-dead' : ''}`;
  panel.querySelector('.messages-thread-name').textContent = `${name} · ${note}`;
  const messages = history(conv.channel);
  log.replaceChildren(...messages.map(message => {
    const entry = document.createElement('li');
    const messageClass = MESSAGE_CLASSES.includes(message.class) ? message.class : colourOf(conv);
    entry.className = `messages-entry tx-${messageClass}${message.side === conv.side ? ' is-mine' : ''}`;
    const meta = document.createElement('small');
    meta.textContent = `${message.side === conv.side ? `You, as ${message.from || myName(conv)}` : message.from || theirName(conv)}${message.time ? ` · ${clock(message.time)}` : ''}`;
    const text = document.createElement('p');
    text.textContent = displayMessageText(message);
    entry.append(meta, text);
    return entry;
  }));
  if (!messages.length) {
    const empty = document.createElement('li');
    empty.className = 'messages-empty';
    empty.textContent = conversationClosed(conv) ? 'This character is dead. No messages can be sent to or from them.'
      : conv.side === 'npc'
      ? `Nothing yet. Write to Agent ${conv.agentName} as ${conv.other}.`
      : `Nothing yet. Write to ${theirName(conv)}.`;
    log.append(empty);
  }
  log.scrollTop = log.scrollHeight;
  const compose = panel.querySelector('.messages-compose textarea');
  compose.placeholder = conversationClosed(conv) ? 'Messaging disabled: this character is dead' : `As ${myName(conv)}, to ${theirName(conv)}…`;
  compose.readOnly = conversationClosed(conv);
  panel.querySelector('.messages-send').disabled = conversationClosed(conv);
  // The Manager is reached through the Manager's channel, if there is one.
  panel.querySelector('.messages-compose').hidden = !isTopic(conv.channel);
  if (conversationClosed(conv)) {
    const state = panel.querySelector('.messages-state');
    state.className = 'messages-state is-closed';
    state.textContent = 'This character is deceased. The conversation is read-only.';
  }
  // Reading it here is seeing it.
  messages.filter(message => incoming(conv, message)).forEach(message => markSeen(conv, message.id));
}

function showThread(conv) {
  openConv = conv;
  activePersona = controlledPersona(conv).key;
  panel.classList.add('is-reading');
  const state = panel.querySelector('.messages-state');
  state.className = 'messages-state';
  state.textContent = '';
  if (conversationClosed(conv)) panel.querySelector('.messages-compose textarea').value = '';
  renderThread();
  renderList();
  if (!conversationClosed(conv)) panel.querySelector('.messages-compose textarea').focus({ preventScroll: true });
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
  if (conversationClosed(openConv)) {
    state.className = 'messages-state is-closed';
    state.textContent = 'This character is deceased. Messages cannot be sent to or from them.';
    return;
  }
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
// Only on a published copy, signed in as the Manager: the local tracker has no card buttons.
let watchingAgentCards = false;
const quickIdentity = { name: 'The Manager', class: 'manager' };

function directLine(agentId) {
  return getSnapshot() && getIdentity()?.manager ? managerConversation(agentId, 'npc') : null;
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

/** The Manager's per-agent test designer. The definition travels with the message, so an
 * agent only ever receives the test selected for their own direct line. */
function openCustomTestDesigner(card, conv) {
  const agentName = card.querySelector('[data-stat="name"]')?.value?.trim() || 'Agent';
  const form = document.createElement('form');
  form.className = 'custom-test-form';
  form.noValidate = true;
  form.innerHTML = `
    <label>Title<input name="title" maxlength="160" required autofocus placeholder="e.g. Field protocol check"></label>
    <label>Box colour<input name="colour" type="color" value="#64d2ff"></label>
    <label>Description<textarea name="description" rows="4" maxlength="1000" required placeholder="What should the agent consider?"></textarea></label>
    <fieldset class="custom-test-mode">
      <legend>Answer</legend>
      <label><input type="radio" name="mode" value="choice" checked> Choices</label>
      <label><input type="radio" name="mode" value="open"> Open answer <small>· the agent writes their own</small></label>
    </fieldset>
    <div class="custom-test-choice-fields">
      <strong>Choices <small>(two or more)</small></strong>
      <div class="custom-test-choice-list"></div>
      <button type="button" class="custom-test-add">+ Add choice</button>
    </div>
    <p class="manager-message-state" aria-live="polite"></p>`;
  const state = form.querySelector('.manager-message-state');
  const choiceFields = form.querySelector('.custom-test-choice-fields');
  const list = form.querySelector('.custom-test-choice-list');
  const mode = () => form.elements.mode.value;
  const rows = () => [...list.children];

  /** Number the rows, and keep at least MIN_TEST_CHOICES of them. */
  const renumber = () => rows().forEach((row, index) => {
    const [label, colour, remove] = row.children;
    label.placeholder = `Choice ${index + 1}`;
    colour.setAttribute('aria-label', `Choice ${index + 1} colour`);
    remove.setAttribute('aria-label', `Remove choice ${index + 1}`);
    remove.disabled = rows().length <= MIN_TEST_CHOICES;
  });
  const addChoice = () => {
    const row = document.createElement('div');
    const label = document.createElement('input');
    label.maxLength = 80;
    const colour = document.createElement('input');
    colour.type = 'color';
    colour.value = TEST_CHOICE_COLOURS[rows().length % TEST_CHOICE_COLOURS.length];
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'custom-test-remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      if (rows().length <= MIN_TEST_CHOICES) return;
      row.remove();
      renumber();
    });
    row.append(label, colour, remove);
    list.append(row);
    renumber();
    return label;
  };
  for (let i = 0; i < MIN_TEST_CHOICES; i++) addChoice();
  form.querySelector('.custom-test-add').addEventListener('click', () => addChoice().focus());
  const showMode = () => { choiceFields.hidden = mode() === 'open'; };
  form.querySelectorAll('input[name="mode"]').forEach(radio => radio.addEventListener('change', showMode));

  let close = null;
  const fail = (field, message) => {
    if (field) {
      field.classList.add('invalid');
      field.focus();
    }
    state.className = 'manager-message-state is-error';
    state.textContent = message;
    return false;
  };
  const transmit = async () => {
    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim();
    const open = mode() === 'open';
    const choices = open ? [] : rows()
      .map(row => ({ label: row.children[0].value.trim(), colour: row.children[1].value }))
      .filter(choice => choice.label);
    form.querySelectorAll('.invalid').forEach(field => field.classList.remove('invalid'));
    if (!title) return fail(form.elements.title, 'Add a title.');
    if (!description) return fail(form.elements.description, 'Add a description.');
    if (!open && choices.length < MIN_TEST_CHOICES) {
      const empty = rows().map(row => row.children[0]).find(field => !field.value.trim());
      return fail(empty, `Add at least ${MIN_TEST_CHOICES} choices, or make it an open answer.`);
    }
    const test = normalizeCustomTest({
      id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      title, description, colour: form.elements.colour.value, choices, ...(open ? { mode: 'open' } : {})
    });
    if (!test || (!open && test.choices.length !== choices.length)) {
      return fail(null, 'One of the test colours or choices is invalid.');
    }
    // The test travels as one ntfy message: past its size it would not arrive as one.
    const size = new TextEncoder().encode(JSON.stringify({ customTest: test })).length;
    if (size > MAX_TEST_BYTES) {
      return fail(null, `Too long to send as one transmission (${size} of ${MAX_TEST_BYTES} bytes): shorten the description or the choices.`);
    }
    const button = form.closest('.modal-panel')?.querySelector('.modal-btn-primary');
    if (button) button.disabled = true;
    [...form.elements].forEach(field => { field.disabled = true; });
    state.className = 'manager-message-state';
    state.textContent = 'Transmitting…';
    if (await send(conv, test.title, { from: 'Triangle Agency', messageClass: 'anomaly', customTest: test })) {
      close?.();
      toast(`${test.title} sent to ${agentName}. Their ${open ? 'answer' : 'choice'} will appear in the Event log.`, { kind: 'success' });
      return true;
    }
    [...form.elements].forEach(field => { field.disabled = false; });
    renumber();
    if (button) button.disabled = false;
    state.classList.add('is-error');
    state.textContent = 'Transmission failed · try again';
    return false;
  };
  close = openModal({
    title: `Custom test for ${agentName}`,
    content: form,
    className: 'egg-picker-modal tx-anomaly',
    closeLabel: 'Cancel',
    // openModal also runs this if the form is ever submitted: one handler, so one send.
    actions: [{ label: 'Send test', variant: 'primary', submit: true, onClick: () => { transmit(); return false; } }]
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
  const custom = document.createElement('li');
  const title = document.createElement('strong');
  title.textContent = 'Custom test';
  const summary = document.createElement('p');
  summary.textContent = 'Create a title, description and box colour for this agent only, with two or more coloured choices or an open answer.';
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'modal-btn modal-btn-primary';
  create.textContent = 'Create';
  create.addEventListener('click', () => { close?.(); openCustomTestDesigner(card, conv); });
  custom.append(title, summary, create);
  list.append(custom);
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

/* ---------- the Network map: who speaks, and to whom ---------- */
const norm = text => String(text || '').trim().toLowerCase();
const SVG_NS = 'http://www.w3.org/2000/svg';
let speaker = null;   // the character the player has picked to write as: { key, type, name, agentIds }

function npcConversation(agentId, npc, side) {
  return conversations.find(conv => conv.kind === 'npc' && conv.side === side && String(conv.agentId) === String(agentId) && norm(conv.other) === norm(npc));
}

const writableConversation = conv => conv && !conversationClosed(conv) ? conv : null;
const deadRelationshipNode = node => node?.classList.contains('net-rel') && node.classList.contains('dead');

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
  if (deadRelationshipNode(node)) return null;
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
  if (deadRelationshipNode(node)) return null;
  if (speaker.type === 'manager') {
    return writableConversation(node.dataset.agentId ? managerConversation(node.dataset.agentId, 'npc') : null);
  }
  if (speaker.type === 'agent') {
    if (node.dataset.manager) return writableConversation(managerConversation(speaker.agentId, 'agent'));
    if (node.dataset.agentId && node.dataset.agentId !== speaker.agentId) {
      return writableConversation(agentConversation(speaker.agentId, node.dataset.agentId));
    }
    if (!node.dataset.npc || !(node.dataset.agents || '').split(',').includes(speaker.agentId)) return null;
    return writableConversation(npcConversation(speaker.agentId, node.dataset.npc, 'agent'));
  }
  if (!node.dataset.agentId || !speaker.agentIds.includes(node.dataset.agentId)) return null;
  return writableConversation(npcConversation(node.dataset.agentId, speaker.name, 'npc'));
}

function personaConversations(persona) {
  if (persona.type === 'manager') return conversations.filter(conv => !conversationClosed(conv) && conv.kind === 'manager' && conv.side === 'npc');
  return persona.type === 'agent'
    ? conversations.filter(conv => !conversationClosed(conv) && ((conv.kind === 'npc' && conv.side === 'agent' && String(conv.agentId) === persona.agentId)
      || (conv.kind === 'agent' && localAgentId(conv) === persona.agentId)))
    : persona.agentIds.map(id => writableConversation(npcConversation(id, persona.name, 'npc'))).filter(Boolean);
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
    kind: 'manager', side: 'agent', agentId: identity.charId, agentName: identity.name || identity.username, other: 'The Manager', manager: true
  };
  conversations = [...(manager ? [manager] : []), ...identity.conversations.filter(conv => isTopic(conv.channel))];
  for (const conv of conversations) {
    if (!byChannel.has(conv.channel)) byChannel.set(conv.channel, []);
    byChannel.get(conv.channel).push(conv);
    if (isTopic(conv.channel)) pendingReceiptSet(`${conv.channel}|${conv.side}`);
  }
  if (pendingEventResults().length) scheduleEventResultFlush();
  addButton();
  // The Agency tab offers purchase requests once it knows there is a line to send them on.
  document.dispatchEvent(new Event('messages-ready'));
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
  flushEventResults();
  source?.close();
  source = null;
}
