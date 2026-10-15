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
const OPPOSITE = { agent: 'npc', npc: 'agent', a: 'b', b: 'a' };
const REFRESH_BEFORE_SECONDS = 5 * 60 * 60;
const DEFAULT_CACHE_SECONDS = 12 * 60 * 60;
const MAX_POLL_URL = 1800;

/** Run once after filling the Script Properties described in README.md. */
function setupCollector() {
  requiredConfig_();
  archiveFile_();
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncMessages')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncMessages').timeBased().everyHours(4).create();
  syncMessages();
}

/** Manual Run button entry point. */
function syncNow() {
  syncMessages();
}

/** The four-hour job. Safe against two trigger executions overlapping. */
function syncMessages() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another message sync is still running.');
  try {
    const config = requiredConfig_();
    const registry = fetchRegistry_(config.snapshotUrl);
    const state = loadState_();
    let changed = false;

    pollEvents_(registry.server, registry.topics).forEach(event => {
      if (ingest_(state, event)) changed = true;
    });
    if (refreshUnread_(state, registry.server, registry.topics)) changed = true;

    if (changed) {
      state.updatedAt = new Date().toISOString();
      saveState_(state);
    }
    pushArchive_(config, publicArchive_(state));
  } finally {
    lock.releaseLock();
  }
}

function requiredConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const config = {
    snapshotUrl: String(properties.getProperty('SNAPSHOT_URL') || '').trim(),
    owner: String(properties.getProperty('GITHUB_OWNER') || '').trim(),
    repo: String(properties.getProperty('GITHUB_REPO') || '').trim(),
    token: String(properties.getProperty('GITHUB_TOKEN') || '').trim(),
    branch: String(properties.getProperty('GITHUB_BRANCH') || 'gh-pages').trim(),
    path: String(properties.getProperty('ARCHIVE_PATH') || 'messages.json').trim()
  };
  const missing = Object.keys(config).filter(key => !config[key]);
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
  const topics = [...new Set(registry.topics.map(String).filter(topic => /^[-_A-Za-z0-9]{1,64}$/.test(topic)))];
  return { server, topics };
}

function emptyState_() {
  return { format: STATE_FORMAT, version: 1, updatedAt: '', topics: {} };
}

function archiveFile_() {
  const properties = PropertiesService.getScriptProperties();
  const fileId = properties.getProperty('DRIVE_FILE_ID');
  if (fileId) {
    try { return DriveApp.getFileById(fileId); } catch (error) { /* Recreate a deleted file. */ }
  }
  const folderId = String(properties.getProperty('DRIVE_FOLDER_ID') || '').trim();
  const blob = Utilities.newBlob(JSON.stringify(emptyState_(), null, 2), 'application/json', 'triangle-agency-message-backup.json');
  const file = folderId ? DriveApp.getFolderById(folderId).createFile(blob) : DriveApp.createFile(blob);
  properties.setProperty('DRIVE_FILE_ID', file.getId());
  return file;
}

function loadState_() {
  try {
    const data = JSON.parse(archiveFile_().getBlob().getDataAsString('UTF-8'));
    return data && data.format === STATE_FORMAT && data.topics ? data : emptyState_();
  } catch (error) {
    throw new Error(`The Drive message archive is not valid JSON: ${error.message}`);
  }
}

function saveState_(state) {
  archiveFile_().setContent(JSON.stringify(state, null, 2));
}

function topicState_(state, topic) {
  if (!state.topics[topic]) {
    state.topics[topic] = {
      messages: {},
      seen: Object.fromEntries(SIDES.map(side => [side, []]))
    };
  }
  const saved = state.topics[topic];
  if (!saved.messages || typeof saved.messages !== 'object') saved.messages = {};
  if (!saved.seen || typeof saved.seen !== 'object') saved.seen = {};
  SIDES.forEach(side => { if (!Array.isArray(saved.seen[side])) saved.seen[side] = []; });
  return saved;
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

function ingest_(state, event) {
  const tags = Array.isArray(event.tags) ? event.tags.map(String) : [];
  const side = tagged_(tags, 'ta-', SIDES);
  if (!side) return false;
  const topic = topicState_(state, String(event.topic));
  if (tags.includes('ta-seen')) {
    let changed = false;
    const seen = new Set(topic.seen[side]);
    String(event.message || '').split(',').filter(Boolean).forEach(id => {
      if (!seen.has(id)) { seen.add(id); changed = true; }
    });
    topic.seen[side] = [...seen];
    return changed;
  }

  const id = String(event.sequence_id || event.id || '');
  if (!id) return false;
  const existing = topic.messages[id];
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
  topic.messages[id] = {
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
  };
  return true;
}

function acknowledged_(topic, message) {
  const recipient = OPPOSITE[message.side];
  return recipient ? topic.seen[recipient].includes(message.id) : true;
}

function refreshUnread_(state, server, activeTopics) {
  const threshold = Math.floor(Date.now() / 1000) + REFRESH_BEFORE_SECONDS;
  let changed = false;
  activeTopics.forEach(channel => {
    if (!state.topics[channel]) return;
    const topic = topicState_(state, channel);
    Object.values(topic.messages).forEach(message => {
      if (acknowledged_(topic, message) || Number(message.expires || 0) > threshold) return;
      const response = UrlFetchApp.fetch(`${server}/`, {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          topic: channel,
          title: message.from,
          message: message.text,
          tags: message.tags,
          sequence_id: message.id
        }),
        muteHttpExceptions: true
      });
      if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
        throw new Error(`Could not rejuvenate ${message.id} (${response.getResponseCode()}).`);
      }
      const sent = JSON.parse(response.getContentText() || '{}');
      message.ntfyId = String(sent.id || message.ntfyId || '');
      message.lastEventTime = Number(sent.time || Math.floor(Date.now() / 1000));
      message.expires = Number(sent.expires || message.lastEventTime + DEFAULT_CACHE_SECONDS);
      changed = true;
    });
  });
  return changed;
}

function publicArchive_(state) {
  const topics = {};
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
          ...(message.class ? { class: message.class } : {})
        })),
      seen: Object.fromEntries(SIDES.map(side => [side, topic.seen[side]]))
    };
  });
  return { format: ARCHIVE_FORMAT, version: 1, updatedAt: state.updatedAt || '', topics };
}

function githubHeaders_(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

function pushArchive_(config, archive) {
  const api = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${config.path.split('/').map(encodeURIComponent).join('/')}`;
  const text = JSON.stringify(archive);
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = UrlFetchApp.fetch(`${api}?ref=${encodeURIComponent(config.branch)}`, {
      headers: githubHeaders_(config.token),
      muteHttpExceptions: true
    });
    const code = current.getResponseCode();
    const details = code === 200 ? JSON.parse(current.getContentText()) : null;
    if (code !== 200 && code !== 404) throw new Error(`GitHub read failed (${code}): ${current.getContentText()}`);
    if (details && details.content) {
      const existing = Utilities.newBlob(Utilities.base64Decode(String(details.content).replace(/\s/g, ''))).getDataAsString('UTF-8');
      if (existing === text) return;
    }
    const response = UrlFetchApp.fetch(api, {
      method: 'put',
      contentType: 'application/json',
      headers: githubHeaders_(config.token),
      payload: JSON.stringify({
        message: `Update message archive ${new Date().toISOString()}`,
        content: Utilities.base64Encode(Utilities.newBlob(text, 'application/json').getBytes()),
        branch: config.branch,
        ...(details && details.sha ? { sha: details.sha } : {})
      }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) return;
    if (response.getResponseCode() !== 409 || attempt) {
      throw new Error(`GitHub update failed (${response.getResponseCode()}): ${response.getContentText()}`);
    }
  }
}
