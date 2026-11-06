/**
 * Triangle Agency message collector.
 *
 * This is a standalone Google Apps Script. It polls the topics listed in the published
 * snapshot, keeps the durable source copy in a private Google Drive JSON file, refreshes
 * unread ntfy messages before they expire, and commits the public UI archive to GitHub.
 */

const ARCHIVE_FORMAT = 'triangle-agency-message-archive';
const STATE_FORMAT = 'triangle-agency-message-collector';
const SIDES = ['agent', 'npc', 'a', 'b'];
const CLASSES = ['manager', 'agent', 'npc', 'anomaly'];
const EVENT_RESULT_TAG = 'ta-event-result';
const EVENT_RESULT_DELETE_TAG = 'ta-event-result-delete';
const LEGACY_EGG_RESULT_TAG = 'ta-egg-result';
const OPPOSITE = { agent: 'npc', npc: 'agent', a: 'b', b: 'a' };
const REFRESH_BEFORE_SECONDS = 5 * 60 * 60;
const DEFAULT_CACHE_SECONDS = 12 * 60 * 60;
const MAX_POLL_URL = 1800;
const PUBLISH_BRANCH = 'gh-pages';
const PUBLISH_PATH = 'messages.json';
const AUTO_SYNC_HOURS = 4;
const NEXT_AUTOMATIC_SYNC_PROPERTY = 'NEXT_AUTOMATIC_SYNC_AT';
const MAX_PURGE = 500;

/** Run once after filling the Script Properties described in README.md. */
function setupCollector() {
  requiredConfig_();
  archiveFile_();
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncMessages')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncMessages').timeBased().everyHours(AUTO_SYNC_HOURS).create();
  PropertiesService.getScriptProperties().setProperty(
    NEXT_AUTOMATIC_SYNC_PROPERTY,
    new Date(Date.now() + AUTO_SYNC_HOURS * 60 * 60 * 1000).toISOString()
  );
  syncMessages();
}

/** Manual Run button entry point. */
function syncNow() {
  return syncMessages();
}

/**
 * Authenticated entry point used by the local Communication Center.
 * Deploy this project as a web app that executes as you, then configure the
 * local tracker with its /exec URL and the same MANUAL_SYNC_TOKEN property.
 */
function doPost(event) {
  try {
    const expected = String(PropertiesService.getScriptProperties().getProperty('MANUAL_SYNC_TOKEN') || '');
    let supplied = String((event && event.parameter && event.parameter.token) || '');
    if (!supplied && event && event.postData && event.postData.contents) {
      try {
        supplied = String((JSON.parse(event.postData.contents) || {}).token || '');
      } catch (error) { /* Form data is the normal request format. */ }
    }
    if (!expected) throw new Error('MANUAL_SYNC_TOKEN is not configured in Script Properties.');
    if (!supplied || supplied !== expected) throw new Error('Manual sync authorization failed.');
    const action = String((event && event.parameter && event.parameter.action) || 'sync');
    if (action === 'sync') return jsonOutput_({ ok: true, ...syncMessages() });
    if (action === 'delete') return jsonOutput_({ ok: true, ...deleteMessages_(deleteItems_(event.parameter)) });
    throw new Error('Unknown Communication Center action.');
  } catch (error) {
    return jsonOutput_({ ok: false, message: String(error && error.message || error) });
  }
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** The four-hour job. Safe against two trigger executions overlapping. */
function syncMessages(event) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another message sync is still running.');
  try {
    const nextAutomaticSyncAt = nextAutomaticSyncAt_(event);
    const config = requiredConfig_();
    const registry = fetchRegistry_(config.snapshotUrl);
    const state = loadState_();
    let changed = normalizeState_(state);

    pollEvents_(registry.server, registry.topics).forEach(event => {
      if (ingest_(state, event)) changed = true;
    });
    const refresh = refreshUnread_(state, registry.server, registry.topics);
    if (refresh.changed) changed = true;

    if (changed) {
      state.updatedAt = new Date().toISOString();
      saveState_(state);
    }
    pushArchive_(config, publicArchive_(state, nextAutomaticSyncAt));
    if (refresh.errors.length) {
      const shown = refresh.errors.slice(0, 5);
      const more = refresh.errors.length > shown.length ? `; ${refresh.errors.length - shown.length} more` : '';
      throw new Error(`Some unread messages could not be rejuvenated: ${shown.join('; ')}${more}`);
    }
    const topics = Object.values(state.topics);
    return {
      updatedAt: state.updatedAt || '',
      topics: topics.length,
      messages: topics.reduce((total, topic) => total + Object.keys((topic || {}).messages || {}).length, 0),
      nextAutomaticSyncAt
    };
  } finally {
    lock.releaseLock();
  }
}

function nextAutomaticSyncAt_(event) {
  const properties = PropertiesService.getScriptProperties();
  let value = String(properties.getProperty(NEXT_AUTOMATIC_SYNC_PROPERTY) || '');
  if ((event && event.triggerUid) || !value || !Number.isFinite(Date.parse(value))) {
    value = new Date(Date.now() + AUTO_SYNC_HOURS * 60 * 60 * 1000).toISOString();
    properties.setProperty(NEXT_AUTOMATIC_SYNC_PROPERTY, value);
  }
  return value;
}
function requiredConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const branch = String(properties.getProperty('GITHUB_BRANCH') || PUBLISH_BRANCH).trim();
  const path = String(properties.getProperty('ARCHIVE_PATH') || PUBLISH_PATH).trim();
  if (branch !== PUBLISH_BRANCH) {
    throw new Error(`GITHUB_BRANCH must be omitted or exactly "${PUBLISH_BRANCH}"; the published browser does not read other branches.`);
  }
  if (path !== PUBLISH_PATH) {
    throw new Error(`ARCHIVE_PATH must be omitted or exactly "${PUBLISH_PATH}"; the published browser does not read other paths.`);
  }
  const config = {
    snapshotUrl: String(properties.getProperty('SNAPSHOT_URL') || '').trim(),
    owner: String(properties.getProperty('GITHUB_OWNER') || '').trim(),
    repo: String(properties.getProperty('GITHUB_REPO') || '').trim(),
    token: String(properties.getProperty('GITHUB_TOKEN') || '').trim(),
    branch,
    path
  };
  const propertyNames = { snapshotUrl: 'SNAPSHOT_URL', owner: 'GITHUB_OWNER', repo: 'GITHUB_REPO', token: 'GITHUB_TOKEN' };
  const missing = Object.keys(propertyNames).filter(key => !config[key]).map(key => propertyNames[key]);
  if (missing.length) throw new Error(`Missing Script Properties: ${missing.join(', ')}`);
  return config;
}

function fetchRegistry_(snapshotUrl) {
  const join = snapshotUrl.includes('?') ? '&' : '?';
  const response = UrlFetchApp.fetch(`${snapshotUrl}${join}collector=${Date.now()}`, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error(`Could not read snapshot (${response.getResponseCode()}).`);
  const snapshot = JSON.parse(response.getContentText());
  const registry = snapshot && snapshot.messageSync;
  if (!registry || !Array.isArray(registry.topics)) throw new Error('The published snapshot has no messageSync registry. Publish the tracker again.');
  const server = String(registry.server || 'https://ntfy.sh').replace(/\/+$/, '');
  const topics = [...new Set(registry.topics
    .filter(topic => typeof topic === 'string')
    .filter(topic => /^[-_A-Za-z0-9]{1,64}$/.test(topic)))];
  return { server, topics };
}

function emptyState_() {
  return { format: STATE_FORMAT, version: 1, updatedAt: '', topics: {} };
}

function archiveFile_() {
  const properties = PropertiesService.getScriptProperties();
  const fileId = properties.getProperty('DRIVE_FILE_ID');
  if (fileId) {
    try {
      return DriveApp.getFileById(fileId);
    } catch (error) {
      throw new Error(`The configured Drive archive (${fileId}) is inaccessible. Restore it or explicitly remove the DRIVE_FILE_ID Script Property before starting a new archive: ${error.message}`);
    }
  }
  const folderId = String(properties.getProperty('DRIVE_FOLDER_ID') || '').trim();
  const blob = Utilities.newBlob(JSON.stringify(emptyState_()), 'application/json', 'triangle-agency-message-backup.json');
  const file = folderId ? DriveApp.getFolderById(folderId).createFile(blob) : DriveApp.createFile(blob);
  properties.setProperty('DRIVE_FILE_ID', file.getId());
  return file;
}

function loadState_() {
  const text = archiveFile_().getBlob().getDataAsString('UTF-8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The Drive message archive is not valid JSON: ${error.message}`);
  }
  if (!data || data.format !== STATE_FORMAT || data.version !== 1
      || !data.topics || typeof data.topics !== 'object' || Array.isArray(data.topics)) {
    throw new Error('The Drive message archive has an unsupported or invalid format. It was not reset.');
  }
  return data;
}

function saveState_(state) {
  // DriveApp.File.setContent rejects content above 10 MB; keep the durable source compact.
  archiveFile_().setContent(JSON.stringify(state));
}

function topicState_(state, topic) {
  const ownsTopic = Object.prototype.hasOwnProperty.call(state.topics, topic);
  const existing = ownsTopic ? state.topics[topic] : null;
  if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
    Object.defineProperty(state.topics, topic, {
      value: {
        messages: {},
        eventResults: {},
        eventResultDeleted: {},
        seen: Object.fromEntries(SIDES.map(side => [side, []]))
      },
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  const saved = state.topics[topic];
  if (!saved.messages || typeof saved.messages !== 'object' || Array.isArray(saved.messages)) saved.messages = {};
  if (!saved.eventResults || typeof saved.eventResults !== 'object' || Array.isArray(saved.eventResults)) saved.eventResults = {};
  if (!saved.eventResultDeleted || typeof saved.eventResultDeleted !== 'object' || Array.isArray(saved.eventResultDeleted)) saved.eventResultDeleted = {};
  // One-time, non-destructive migration from the first phishing-only result schema.
  if (saved.eggResults && typeof saved.eggResults === 'object' && !Array.isArray(saved.eggResults)) {
    Object.values(saved.eggResults).forEach(value => {
      const result = eventResultValue_(value);
      if (result && !saved.eventResultDeleted[result.sourceId] && !saved.eventResults[result.sourceId]) {
        saved.eventResults[result.sourceId] = result;
      }
    });
    delete saved.eggResults;
  }
  if (!saved.seen || typeof saved.seen !== 'object' || Array.isArray(saved.seen)) saved.seen = {};
  if (!saved.deleted || typeof saved.deleted !== 'object' || Array.isArray(saved.deleted)) saved.deleted = {};
  SIDES.forEach(side => { if (!Array.isArray(saved.seen[side])) saved.seen[side] = []; });
  return saved;
}

function normalizeState_(state) {
  let changed = false;
  Object.keys(state.topics).forEach(topic => {
    const saved = state.topics[topic];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)
        || !saved.eventResults || typeof saved.eventResults !== 'object' || Array.isArray(saved.eventResults)
        || !saved.eventResultDeleted || typeof saved.eventResultDeleted !== 'object' || Array.isArray(saved.eventResultDeleted)
        || Object.prototype.hasOwnProperty.call(saved, 'eggResults')) changed = true;
    topicState_(state, topic);
  });
  return changed;
}

function topicBatches_(server, topics) {
  const batches = [];
  let current = [];
  topics.forEach(topic => {
    const candidate = [...current, topic];
    const length = `${server}/${candidate.join(',')}/json?poll=1&since=all`.length;
    if (current.length && length > MAX_POLL_URL) {
      batches.push(current);
      current = [topic];
    } else {
      current = candidate;
    }
  });
  if (current.length) batches.push(current);
  return batches;
}

function pollEvents_(server, topics) {
  const events = [];
  topicBatches_(server, topics).forEach(batch => {
    const url = `${server}/${batch.join(',')}/json?poll=1&since=all`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error(`ntfy poll failed (${response.getResponseCode()}).`);
    response.getContentText().split('\n').filter(Boolean).forEach(line => {
      try {
        const event = JSON.parse(line);
        if (event && event.event === 'message' && batch.includes(event.topic)) events.push(event);
      } catch (error) { /* Ignore one malformed stream line without losing the rest. */ }
    });
  });
  return events.sort((a, b) => Number(a.time || 0) - Number(b.time || 0));
}

function tagged_(tags, prefix, choices) {
  return choices.find(value => tags.includes(`${prefix}${value}`)) || '';
}

function eventResultValue_(value, fallbackTime) {
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
    time: Number(value.time) || Number(fallbackTime) || 0
  };
}

function eventResult_(event) {
  let value;
  try {
    value = JSON.parse(String(event.message || ''));
  } catch (error) {
    return null;
  }
  return eventResultValue_(value, event.time);
}

function eventResultDelete_(event) {
  try {
    const value = JSON.parse(String(event.message || ''));
    const sourceId = String((value || {}).sourceId || '').slice(0, 160);
    return sourceId || null;
  } catch (error) {
    return null;
  }
}

function ingest_(state, event) {
  const tags = Array.isArray(event.tags) ? event.tags.map(String) : [];
  // Settings and the ntfy app can send untagged Manager messages. The browser has always
  // treated untagged events as the NPC/Manager side, so the durable collector must match it.
  const side = tagged_(tags, 'ta-', SIDES) || 'npc';
  const topic = topicState_(state, String(event.topic));
  if (tags.includes(EVENT_RESULT_DELETE_TAG)) {
    const sourceId = eventResultDelete_(event);
    if (!sourceId) return false;
    const changed = Object.prototype.hasOwnProperty.call(topic.eventResults, sourceId)
      || !Object.prototype.hasOwnProperty.call(topic.eventResultDeleted, sourceId);
    delete topic.eventResults[sourceId];
    topic.eventResultDeleted[sourceId] = new Date((Number(event.time) || Math.floor(Date.now() / 1000)) * 1000).toISOString();
    return changed;
  }
  if (tags.includes(EVENT_RESULT_TAG) || tags.includes(LEGACY_EGG_RESULT_TAG)) {
    const result = eventResult_(event);
    if (!result) return false;
    if (topic.eventResultDeleted[result.sourceId]) return false;
    const previous = topic.eventResults[result.sourceId];
    const next = JSON.stringify(result);
    if (previous && JSON.stringify(previous) === next) return false;
    topic.eventResults[result.sourceId] = result;
    return true;
  }
  if (tags.includes('ta-seen')) {
    let changed = false;
    const seen = new Set(topic.seen[side]);
    String(event.message || '').split(',').filter(Boolean).forEach(id => {
      if (topic.deleted[id]) return;
      if (!seen.has(id)) { seen.add(id); changed = true; }
    });
    topic.seen[side] = [...seen];
    return changed;
  }

  const id = String(event.sequence_id || event.id || '');
  if (!id || topic.deleted[id]) return false;
  const ownsMessage = Object.prototype.hasOwnProperty.call(topic.messages, id);
  const existing = ownsMessage && topic.messages[id] && typeof topic.messages[id] === 'object'
    ? topic.messages[id]
    : null;
  const expires = Number(event.expires || 0);
  if (existing) {
    let changed = false;
    if (expires > Number(existing.expires || 0)) { existing.expires = expires; changed = true; }
    if (Number(event.time || 0) >= Number(existing.lastEventTime || 0)) {
      if (existing.ntfyId !== event.id) changed = true;
      existing.ntfyId = String(event.id || existing.ntfyId || '');
      existing.lastEventTime = Number(event.time || existing.lastEventTime || 0);
    }
    return changed;
  }

  const messageClass = tagged_(tags, 'ta-class-', CLASSES);
  Object.defineProperty(topic.messages, id, {
    value: {
      id,
      time: Number(event.time || 0),
      side,
      from: String(event.title || ''),
      text: String(event.message || ''),
      ...(messageClass ? { class: messageClass } : {}),
      tags,
      ntfyId: String(event.id || ''),
      lastEventTime: Number(event.time || 0),
      expires: expires || Number(event.time || 0) + DEFAULT_CACHE_SECONDS
    },
    enumerable: true,
    configurable: true,
    writable: true
  });
  return true;
}

function acknowledged_(seen, message) {
  const recipient = OPPOSITE[message.side];
  return recipient ? seen[recipient].has(message.id) : true;
}

function refreshUnread_(state, server, activeTopics) {
  const threshold = Math.floor(Date.now() / 1000) + REFRESH_BEFORE_SECONDS;
  let changed = false;
  const errors = [];
  for (const channel of activeTopics) {
    if (!Object.prototype.hasOwnProperty.call(state.topics, channel)) continue;
    const topic = topicState_(state, channel);
    const seen = Object.fromEntries(SIDES.map(side => [side, new Set(topic.seen[side])]));
    for (const message of Object.values(topic.messages)) {
      if (acknowledged_(seen, message) || Number(message.expires || 0) > threshold) continue;
      const tags = Array.isArray(message.tags) ? message.tags : [
        `ta-${message.side}`,
        ...(CLASSES.includes(message.class) ? [`ta-class-${message.class}`] : [])
      ];
      let response;
      try {
        response = UrlFetchApp.fetch(`${server}/`, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify({
            topic: channel,
            title: message.from,
            message: message.text,
            tags,
            sequence_id: message.id
          }),
          muteHttpExceptions: true
        });
      } catch (error) {
        errors.push(`${message.id}: ${error.message}`);
        return { changed, errors };
      }
      const code = response.getResponseCode();
      if (code < 200 || code >= 300) {
        errors.push(`${message.id}: ntfy returned ${code}`);
        // Rate limits and server outages apply to the remaining requests too. Stop here
        // so a partial outage is not amplified, but retain successful refreshes above.
        if (code === 429 || code >= 500) return { changed, errors };
        continue;
      }
      let sent;
      try {
        sent = JSON.parse(response.getContentText() || '{}');
      } catch (error) {
        errors.push(`${message.id}: ntfy returned invalid JSON (${error.message})`);
        return { changed, errors };
      }
      message.ntfyId = String(sent.id || message.ntfyId || '');
      message.lastEventTime = Number(sent.time || Math.floor(Date.now() / 1000));
      message.expires = Number(sent.expires || message.lastEventTime + DEFAULT_CACHE_SECONDS);
      changed = true;
    }
  }
  return { changed, errors };
}

// An easter egg (js/easterEggs.js) is a Manager message tagged ta-egg-<id>.
function eggOf_(tags) {
  const tag = (Array.isArray(tags) ? tags : []).map(String).find(item => item.startsWith('ta-egg-'));
  return tag ? { egg: tag.slice('ta-egg-'.length) } : {};
}

// A Manager-authored test keeps its definition in the message body so it can be recreated on
// an agent's next visit. Only tagged test messages expose that structured body in the archive.
function customTestOf_(message) {
  const tags = Array.isArray(message.tags) ? message.tags.map(String) : [];
  if (!tags.includes('ta-custom-test')) return {};
  try {
    const test = JSON.parse(String(message.text || '')).customTest;
    return test && typeof test === 'object' && !Array.isArray(test) ? { test } : {};
  } catch (error) {
    return {};
  }
}

function publicArchive_(state, nextAutomaticSyncAt) {
  const topics = Object.create(null);
  Object.keys(state.topics).sort().forEach(channel => {
    const topic = topicState_(state, channel);
    topics[channel] = {
      messages: Object.values(topic.messages)
        .sort((a, b) => Number(a.time || 0) - Number(b.time || 0))
        .map(message => ({
          id: message.id,
          time: message.time,
          side: message.side,
          from: message.from,
          text: message.text,
          expires: Number(message.expires || 0),
          ...(message.class ? { class: message.class } : {}),
          ...eggOf_(message.tags),
          ...customTestOf_(message)
        })),
      eventResults: Object.values(topic.eventResults)
        .sort((a, b) => Number(a.time || 0) - Number(b.time || 0)),
      eventResultDeleted: Object.keys(topic.eventResultDeleted),
      // Kept for one release so an older published browser can still read egg outcomes.
      eggResults: Object.values(topic.eventResults)
        .filter(result => result.category === 'easter-egg')
        .sort((a, b) => Number(a.time || 0) - Number(b.time || 0))
        .map(result => ({
          sourceId: result.sourceId,
          egg: result.eventId,
          title: result.title,
          verdict: result.status,
          choice: result.choice,
          outcome: result.outcome,
          boon: result.reward,
          time: result.time
        })),
      seen: Object.fromEntries(SIDES.map(side => [side, topic.seen[side]])),
      deleted: Object.keys(topic.deleted)
    };
  });
  return {
    format: ARCHIVE_FORMAT,
    version: 1,
    updatedAt: state.updatedAt || '',
    collector: { nextAutomaticSyncAt: nextAutomaticSyncAt || nextAutomaticSyncAt_() },
    topics
  };
}

/**
 * The messages a delete request names: `items`, a JSON list of {channel, id}, or the
 * single `channel` and `id` an older Communication Center sends.
 */
function deleteItems_(parameter) {
  if (!parameter.items) return [{ channel: String(parameter.channel || ''), id: String(parameter.id || '') }];
  let items;
  try {
    items = JSON.parse(String(parameter.items));
  } catch (error) {
    throw new Error('The purge list is not valid JSON.');
  }
  if (!Array.isArray(items)) throw new Error('The purge list must be an array.');
  return items.map(item => ({ channel: String((item || {}).channel || ''), id: String((item || {}).id || '') }));
}

/**
 * Purges a batch of messages under one lock: one Drive save and one GitHub commit however
 * many there are. A message that cannot be purged is reported in `failed` and the rest
 * still go; only a batch where nothing could be purged is an error.
 */
function deleteMessages_(items) {
  const targets = [];
  const seen = new Set();
  items.forEach(item => {
    if (!/^[-_A-Za-z0-9]{1,64}$/.test(item.channel) || !item.id || item.id.length > 256) {
      throw new Error('A valid channel and message ID are required.');
    }
    const key = item.channel + '\n' + item.id;
    if (!seen.has(key)) { seen.add(key); targets.push(item); }
  });
  if (!targets.length) throw new Error('Select at least one message to purge.');
  if (targets.length > MAX_PURGE) throw new Error(`Purge at most ${MAX_PURGE} messages at a time.`);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another message operation is still running.');
  try {
    const config = requiredConfig_();
    const registry = fetchRegistry_(config.snapshotUrl);
    const state = loadState_();
    const purge = [];
    const removed = [];
    const failed = [];
    let alreadyDeleted = 0;
    targets.forEach(item => {
      if (!registry.topics.includes(item.channel)) {
        failed.push({ ...item, reason: 'its channel is not in the published registry' });
      } else if (!Object.prototype.hasOwnProperty.call(state.topics, item.channel)) {
        failed.push({ ...item, reason: 'its channel has no stored history' });
      } else if (Object.prototype.hasOwnProperty.call(topicState_(state, item.channel).messages, item.id)) {
        purge.push(item);
      } else if (state.topics[item.channel].deleted[item.id]) {
        alreadyDeleted++;
        removed.push(item);
      } else {
        failed.push({ ...item, reason: 'it is no longer in the archive' });
      }
    });
    if (!purge.length) {
      if (removed.length) return { deleted: true, batch: true, purged: 0, alreadyDeleted, removed, failed, warning: '' };
      throw new Error(failed.length === 1
        ? `That message could not be purged: ${failed[0].reason}.`
        : `None of the ${failed.length} messages could be purged; the first: ${failed[0].reason}.`);
    }

    // Every ntfy deletion at once. The archive is purged whatever ntfy answers: the
    // tombstones keep a message ntfy still caches from being imported again.
    let warning = '';
    try {
      const codes = UrlFetchApp.fetchAll(purge.map(item => ({
        url: registry.server + '/' + encodeURIComponent(item.channel) + '/' + encodeURIComponent(item.id),
        method: 'delete',
        muteHttpExceptions: true
      }))).map(response => response.getResponseCode());
      const refused = codes.filter(code => code < 200 || code >= 300);
      if (refused.length) {
        warning = `ntfy refused ${refused.length} of ${purge.length} deletions (${[...new Set(refused)].join(', ')})`;
      }
    } catch (error) {
      warning = `ntfy deletion failed (${error.message})`;
    }
    if (warning) warning += '; the permanent archive was still purged.';

    const now = new Date().toISOString();
    purge.forEach(item => {
      const topic = topicState_(state, item.channel);
      delete topic.messages[item.id];
      SIDES.forEach(side => {
        topic.seen[side] = topic.seen[side].filter(seenId => seenId !== item.id);
      });
      topic.deleted[item.id] = now;
      removed.push(item);
    });
    state.updatedAt = now;
    saveState_(state);
    const nextAutomaticSyncAt = nextAutomaticSyncAt_();
    pushArchive_(config, publicArchive_(state, nextAutomaticSyncAt));
    return {
      deleted: true,
      batch: true,
      purged: purge.length,
      alreadyDeleted,
      removed,
      failed,
      ntfyDeleted: !warning,
      warning,
      updatedAt: now,
      nextAutomaticSyncAt
    };
  } finally {
    lock.releaseLock();
  }
}
function githubHeaders_(token, accept = 'application/vnd.github+json') {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

/** GitHub identifies file content by SHA-1(`blob <UTF-8 byte length>\\0<bytes>`). */
function gitBlobSha_(text) {
  const bytes = Utilities.newBlob(text, 'application/json').getBytes();
  const header = Utilities.newBlob(`blob ${bytes.length}\0`).getBytes();
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, header.concat(bytes))
    .map(byte => ((Number(byte) + 256) % 256).toString(16).padStart(2, '0'))
    .join('');
}

function githubRequest_(url, token, method = 'get', payload = null, allowedCodes = [200]) {
  const options = {
    headers: githubHeaders_(token),
    muteHttpExceptions: true
  };
  if (method !== 'get') options.method = method;
  if (payload !== null) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();
  if (!allowedCodes.includes(code)) {
    throw new Error('GitHub request failed (' + code + '): ' + text);
  }
  let data = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('GitHub returned invalid JSON (' + code + '): ' + error.message);
    }
  }
  return { code, data };
}

function archiveCommitChain_(api, headSha, token) {
  let cursor = headSha;
  let count = 0;
  let headCommit = null;
  const limit = 50;
  while (count < limit) {
    const commit = githubRequest_(api + '/git/commits/' + encodeURIComponent(cursor), token).data;
    if (!headCommit) headCommit = commit;
    if (!String(commit.message || '').startsWith('Update message archive ')) break;
    if (!Array.isArray(commit.parents) || commit.parents.length !== 1) {
      throw new Error('Archive commit compaction stopped at a merge commit.');
    }
    count++;
    cursor = String(commit.parents[0].sha || '');
    if (!cursor) throw new Error('Archive commit has no parent.');
  }
  if (count === limit) {
    throw new Error('More than ' + limit + ' consecutive archive commits need compaction; compact them manually once.');
  }
  return { baseSha: cursor, count, headCommit };
}

function updateRefAtomically_(api, config, beforeSha, afterSha) {
  const repository = githubRequest_(api, config.token).data;
  const query = 'mutation($input:UpdateRefsInput!){updateRefs(input:$input){clientMutationId}}';
  const variables = {
    input: {
      repositoryId: repository.node_id,
      refUpdates: [{
        name: 'refs/heads/' + config.branch,
        beforeOid: beforeSha,
        afterOid: afterSha,
        force: true
      }]
    }
  };
  const response = githubRequest_(
    'https://api.github.com/graphql',
    config.token,
    'post',
    { query, variables }
  ).data;
  if (Array.isArray(response.errors) && response.errors.length) {
    throw new Error('GitHub branch changed while compacting: ' + response.errors.map(error => error.message).join('; '));
  }
}

function pushArchive_(config, archive) {
  const api = 'https://api.github.com/repos/' + encodeURIComponent(config.owner) + '/' + encodeURIComponent(config.repo);
  const refPath = '/git/ref/heads/' + encodeURIComponent(config.branch);
  const contentPath = '/contents/' + config.path.split('/').map(encodeURIComponent).join('/');
  const text = JSON.stringify(archive);
  const blobSha = gitBlobSha_(text);

  for (let attempt = 0; attempt < 2; attempt++) {
    const head = githubRequest_(api + refPath, config.token).data;
    const headSha = String(((head || {}).object || {}).sha || '');
    if (!headSha) throw new Error('GitHub branch head is missing.');

    const chain = archiveCommitChain_(api, headSha, config.token);
    const current = githubRequest_(
      api + contentPath + '?ref=' + encodeURIComponent(headSha),
      config.token,
      'get',
      null,
      [200, 404]
    );
    const currentBlobSha = current.code === 200 ? String(current.data.sha || '') : '';
    if (currentBlobSha === blobSha && chain.count <= 1) return;

    const blob = githubRequest_(
      api + '/git/blobs',
      config.token,
      'post',
      { content: text, encoding: 'utf-8' },
      [201]
    ).data;
    const tree = githubRequest_(
      api + '/git/trees',
      config.token,
      'post',
      {
        base_tree: chain.headCommit.tree.sha,
        tree: [{ path: config.path, mode: '100644', type: 'blob', sha: blob.sha }]
      },
      [201]
    ).data;
    const commit = githubRequest_(
      api + '/git/commits',
      config.token,
      'post',
      {
        message: 'Update message archive ' + new Date().toISOString(),
        tree: tree.sha,
        parents: [chain.baseSha]
      },
      [201]
    ).data;

    try {
      updateRefAtomically_(api, config, headSha, commit.sha);
      return;
    } catch (error) {
      if (attempt) throw error;
    }
  }
}
