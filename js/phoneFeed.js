// phoneFeed.js
// The real messages on the Relationships phone, beside its made-up ones: the latest that
// passed on the channels whoever is looking may read.
//  - The local tracker: every channel (web.py's registry), from the collector's archive
//    (through web.py) and ntfy.
//  - A published copy, signed in as the Manager: every channel (the account's `watch`).
//  - A published copy, signed in as an agent: only their own conversations, as their agent
//    and as the relationships their player plays, and their direct line to the Manager.
//  - A guest: none.
// Read only: nothing here is acknowledged, so it never takes a message from messages.js.
// phoneScope() also tells the phone whose made-up messages to show: an agent's only.

import { access, getIdentity } from './access.js';
import { getSnapshot, isServerAvailable } from './config.js';

const ARCHIVE_FORMAT = 'triangle-agency-message-archive';
const ARCHIVE_EVERY = 5 * 60000;   // the collector republishes every few minutes at most
const SIDES = ['agent', 'npc', 'a', 'b'];
const KINDS = ['manager', 'agent', 'npc', 'anomaly'];

const isTopic = channel => /^[-_A-Za-z0-9]{1,64}$/.test(channel);
const norm = text => String(text || '').trim().toLowerCase();

let who = null;                 // whose channels are being read; a change starts over
let channels = new Map();       // channel -> { kind, agentId, agentName, otherId, other }
let messages = new Map();       // `${channel}|${id}` -> { channel, id, time, side, from, text }
let server = 'https://ntfy.sh';
let source = null;
let archiveTimer = 0;
let generation = 0;             // a fetch from an earlier `who` is dropped
const listeners = new Set();

/* ---------- whose ---------- */
function viewer() {
  if (!getSnapshot()) return { key: 'local' };
  const identity = getIdentity();
  if (!identity || identity.guest) return null;
  if (identity.manager) {
    return { key: `manager:${identity.accountId}`, entries: identity.watch.length ? identity.watch : identity.conversations };
  }
  const direct = isTopic(identity.inbox)
    ? [{ channel: identity.inbox, kind: 'manager', agentId: identity.charId, agentName: identity.name, other: 'Manager' }]
    : [];
  return { key: `agent:${identity.accountId}`, entries: [...direct, ...identity.conversations] };
}

/**
 * Whose made-up messages belong on this phone: null for anyone's, or, signed in as an agent,
 * { agentId, npcs } — their agent, and the relationships (`${agentId}|${name}`) they play.
 */
export function phoneScope() {
  if (!getSnapshot()) return null;
  const identity = getIdentity();
  if (!identity || identity.guest || identity.manager) return null;
  const npcs = new Set(identity.conversations
    .filter(conv => conv.kind === 'npc' && conv.side === 'npc')
    .map(conv => `${conv.agentId}|${norm(conv.other)}`));
  return { agentId: String(identity.charId || ''), npcs };
}

/* ---------- what passed ---------- */
function keep(channel, message) {
  if (!channels.has(channel) || !message.id || !message.text.trim()) return false;
  const key = `${channel}|${message.id}`;
  const old = messages.get(key);
  if (old) {
    // A rejuvenated message comes back later under the same id: it is still the first.
    if (message.time && (!old.time || message.time < old.time)) old.time = message.time;
    return false;
  }
  messages.set(key, { channel, ...message });
  return true;
}

function fromEvent(event) {
  const tags = event.tags || [];
  if (event.event !== 'message' || tags.includes('ta-seen')) return null;
  const egg = tags.find(tag => tag.startsWith('ta-egg-'));
  return {
    id: String(event.sequence_id || event.id || ''),
    time: Number(event.time) || 0,
    side: SIDES.find(side => tags.includes(`ta-${side}`)) || 'npc',
    from: String(event.title || ''),
    text: String(event.message || ''),
    ...(egg ? { egg: true } : {})
  };
}

function changed() {
  listeners.forEach(listener => listener());
}

async function readArchive(run) {
  let archive = null;
  try {
    if (getSnapshot()) {
      const response = await fetch(`./messages.json?v=${Date.now()}`, { cache: 'no-store' });
      archive = response.ok ? await response.json() : null;
    } else {
      const response = await fetch('/api/communication-center/archive', { cache: 'no-store' });
      archive = response.ok ? (await response.json()).archive : null;
    }
  } catch {
    return;   // no collector yet, or offline: ntfy's last 12 hours still come in
  }
  if (run !== generation || archive?.format !== ARCHIVE_FORMAT || typeof archive.topics !== 'object') return;
  let any = false;
  for (const [channel, saved] of Object.entries(archive.topics || {})) {
    (Array.isArray(saved?.messages) ? saved.messages : []).forEach(item => {
      if (!item?.id || !SIDES.includes(item.side)) return;
      any = keep(channel, {
        id: String(item.id),
        time: Number(item.time) || 0,
        side: item.side,
        from: String(item.from || ''),
        text: String(item.text || ''),
        ...(item.egg ? { egg: true } : {})
      }) || any;
    });
  }
  if (any) changed();
}

async function readNtfy(run, topics) {
  try {
    const response = await fetch(`${server}/${topics.join(',')}/json?poll=1&since=all`, { cache: 'no-store' });
    const lines = (await response.text()).split('\n').filter(Boolean);
    if (run !== generation) return;
    let any = false;
    lines.forEach(line => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      const message = fromEvent(event);
      if (message) any = keep(event.topic, message) || any;
    });
    if (any) changed();
  } catch {
    // ntfy unreachable: the archive is all there is
  }
}

function listen(topics) {
  if (typeof EventSource === 'undefined') return;
  source = new EventSource(`${server}/${topics.join(',')}/sse?since=${Math.floor(Date.now() / 1000)}`);
  source.addEventListener('message', event => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    const message = fromEvent(data);
    if (message && keep(data.topic, message)) changed();
  });
}

function stop() {
  generation++;
  source?.close();
  source = null;
  clearInterval(archiveTimer);
  archiveTimer = 0;
  channels = new Map();
  messages = new Map();
}

async function begin(entries) {
  const run = generation;
  entries.forEach(entry => {
    const channel = String(entry?.channel || '');
    if (isTopic(channel) && KINDS.includes(entry.kind) && !channels.has(channel)) channels.set(channel, entry);
  });
  const topics = [...channels.keys()];
  if (!topics.length) return;
  readArchive(run);
  await readNtfy(run, topics);
  if (run !== generation) return;
  listen(topics);
  archiveTimer = setInterval(() => readArchive(run), ARCHIVE_EVERY);
}

async function beginLocal() {
  const run = generation;
  if (!isServerAvailable()) return;
  try {
    const response = await fetch('/api/communication-center/registry', { cache: 'no-store' });
    const data = response.ok ? await response.json() : null;
    if (run !== generation || !data?.ok) return;
    server = data.server || server;
    await begin(Array.isArray(data.registry) ? data.registry : []);
  } catch {
    // an older server without the registry: the phone keeps its made-up messages
  }
}

/** Follow the channels of whoever is looking now; the phone calls it on every tick. */
export function ensureFeed() {
  const next = viewer();
  if ((next?.key || null) === who) return;
  who = next?.key || null;
  stop();
  changed();
  if (!next) return;
  if (next.key === 'local') {
    beginLocal();
    return;
  }
  server = access().server;
  begin(next.entries);
}

export function onFeed(listener) {
  listeners.add(listener);
}

/* ---------- for the phone ---------- */
/** Who wrote to whom, by the channel and the side it was written from; `fromId`: the agent who wrote. */
function between(entry, message) {
  const { kind, other = '' } = entry;
  const agentId = String(entry.agentId || '');
  const agent = entry.agentName || 'Agente';
  if (kind === 'agent') {
    return message.side === 'a'
      ? { from: agent, to: other, fromId: agentId }
      : { from: other, to: agent, fromId: String(entry.otherId || '') };
  }
  const them = kind === 'manager' ? 'Manager' : other;
  return message.side === 'agent' ? { from: agent, to: them, fromId: agentId } : { from: them, to: agent, fromId: '' };
}

/**
 * The latest `limit` messages, newest first:
 * { key, time, from, to, text, kind, agentId, fromId, npc } (`fromId`: the agent who wrote it,
 * if one did; `npc`: the relationship or anomaly on its line).
 */
export function latestMessages(limit) {
  return [...messages.entries()]
    .sort(([, a], [, b]) => b.time - a.time)
    .slice(0, limit)
    .map(([key, message]) => {
      const entry = channels.get(message.channel);
      const names = between(entry, message);
      return {
        key,
        time: message.time,
        from: message.from || names.from,
        to: names.to,
        text: message.text,
        kind: entry.kind,
        agentId: String(entry.agentId || ''),
        fromId: names.fromId,
        npc: entry.kind === 'npc' || entry.kind === 'anomaly' ? String(entry.other || '') : ''
      };
    });
}
