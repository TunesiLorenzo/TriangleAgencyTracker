const ids = [
  'webAppUrl','manualToken','archiveUrl','saveConnection','syncNow','refreshArchive',
  'connectionState','notice','messageCount','topicCount','unreadCount','updatedAt',
  'nextSync','filter','topics','emptyState','selectionCount','selectShown','clearSelection','purgeSelected'
];
const ui = Object.fromEntries(ids.map(function (id) { return [id, document.getElementById(id)]; }));
let archiveData = null;
let registry = [];
let working = false;
// Messages ticked for purging, by key: they stay ticked while the filter hides them.
const selected = new Map();
// Messages purged from this page. GitHub Pages serves the archive from a cache for up to
// ten minutes, so they stay hidden here until the published archive has dropped them too.
const purged = new Set();
// What the current render shows: every message, and each group's select-all box.
let shownItems = [];
let groupBoxes = [];

async function api(url, options) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); }
  catch (error) { data = { ok: false, message: 'HTTP ' + response.status }; }
  if (!response.ok || !data.ok) throw new Error(data.message || ('HTTP ' + response.status));
  return data;
}
function notice(message, error) {
  ui.notice.textContent = message || '';
  ui.notice.classList.toggle('error', Boolean(error));
}
function busy(value) {
  working = value;
  ui.saveConnection.disabled = value;
  ui.syncNow.disabled = value;
  ui.refreshArchive.disabled = value;
  ui.topics.querySelectorAll('button, input').forEach(function (control) { control.disabled = value; });
  updateSelection();
}
function keyOf(channel, id) { return channel + '\n' + id; }
function labelFor(channel) {
  const item = registry.find(function (entry) { return entry.channel === channel; });
  if (!item) return { title: channel, detail: 'Archived channel' };
  const kind = item.kind === 'manager' ? 'Direct Manager line'
    : item.kind === 'agent' ? 'Agent conversation'
    : item.kind === 'anomaly' ? 'Anomaly conversation'
    : 'Relationship conversation';
  return {
    title: (item.agentName || 'Agent') + ' <-> ' + (item.other || 'Unknown'),
    detail: kind + ' - ' + channel
  };
}
function acknowledged(topic, message) {
  const opposite = { agent: 'npc', npc: 'agent', a: 'b', b: 'a' }[message.side];
  return !opposite || ((topic.seen || {})[opposite] || []).includes(message.id);
}
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function checkbox(label) {
  const box = element('input');
  box.type = 'checkbox';
  box.disabled = working;
  box.setAttribute('aria-label', label);
  return box;
}
function duration(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds <= 0) return 'due now';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (days) return days + 'd ' + hours + 'h';
  if (hours) return hours + 'h ' + minutes + 'm';
  return minutes + 'm ' + secs + 's';
}
function updateClocks() {
  const now = Date.now() / 1000;
  document.querySelectorAll('[data-expires]').forEach(function (node) {
    const expires = Number(node.dataset.expires);
    node.textContent = expires ? (expires > now ? 'ntfy expires in ' + duration(expires - now) : 'ntfy cache expired') : 'ntfy expiry unknown';
  });
  const next = Date.parse(((archiveData || {}).collector || {}).nextAutomaticSyncAt || '') / 1000;
  ui.nextSync.textContent = Number.isFinite(next) ? '~ ' + duration(next - now) : 'Update deployment';
  ui.nextSync.title = Number.isFinite(next) ? 'Estimated; Google time-driven triggers may run slightly later.' : 'Deploy the latest Code.gs version, then run one sync.';
}
function searchable(item) {
  return [item.label.title, item.label.detail, item.message.from, item.message.text].join(' ').toLocaleLowerCase();
}
function select(item, on) {
  if (on) selected.set(item.key, { channel: item.channel, id: item.message.id, text: item.message.text || '' });
  else selected.delete(item.key);
}
/** The count, the bar's buttons, each row's highlight and each group's box, from `selected`. */
function updateSelection() {
  const hidden = Array.from(selected.keys()).filter(function (key) {
    return !shownItems.some(function (item) { return item.key === key; });
  }).length;
  ui.selectionCount.textContent = !selected.size ? 'No messages selected'
    : selected.size + ' message' + (selected.size === 1 ? '' : 's') + ' selected' + (hidden ? ' (' + hidden + ' hidden by the filter)' : '');
  ui.selectionCount.parentElement.classList.toggle('has-selection', selected.size > 0);
  ui.purgeSelected.disabled = working || !selected.size;
  ui.purgeSelected.textContent = selected.size > 1 ? 'Purge ' + selected.size + ' selected' : 'Purge selected';
  ui.clearSelection.disabled = working || !selected.size;
  ui.selectShown.disabled = working || !shownItems.length || shownItems.every(function (item) { return selected.has(item.key); });
  ui.topics.querySelectorAll('.message[data-key]').forEach(function (row) {
    const on = selected.has(row.dataset.key);
    row.classList.toggle('selected', on);
    row.querySelector('.pick input').checked = on;
  });
  groupBoxes.forEach(function (group) {
    const count = group.items.filter(function (item) { return selected.has(item.key); }).length;
    group.box.checked = Boolean(group.items.length) && count === group.items.length;
    group.box.indeterminate = count > 0 && count < group.items.length;
  });
}
function messageRow(item, isRead) {
  const message = item.message;
  const row = element('article', 'message' + (isRead ? '' : ' unread'));
  row.dataset.key = item.key;
  const head = element('div', 'message-head');
  const date = message.time ? new Date(Number(message.time) * 1000).toLocaleString() : 'Unknown time';
  const pick = element('label', 'pick');
  const box = checkbox('Select this message for purging');
  box.addEventListener('change', function () { select(item, box.checked); updateSelection(); });
  pick.append(box, element('span', '', (message.from || message.side || 'Unknown') + ' - ' + date));
  head.append(pick, element('span', 'receipt', isRead ? 'Read and archived' : 'Awaiting opening'));
  const conversation = element('div', 'conversation', item.label.title);
  conversation.title = item.label.detail;
  const text = element('p', '', message.text || '');
  const footer = element('div', 'message-actions');
  const clock = element('span', 'clock');
  const estimatedExpiry = Number(message.expires || 0) || (Number(message.time || 0) + 12 * 60 * 60);
  clock.dataset.expires = String(estimatedExpiry);
  const button = element('button', 'danger small', 'Purge message');
  button.type = 'button';
  button.disabled = working;
  button.addEventListener('click', function () {
    purge([{ channel: item.channel, id: message.id, text: message.text || '' }]);
  });
  footer.append(clock, button);
  row.append(head, conversation, text, footer);
  return row;
}
function group(title, description, items, isRead) {
  const section = element('section', 'message-group');
  const heading = element('div', 'group-heading');
  const text = element('div');
  text.append(element('h3', '', title), element('p', 'topic-meta', description));
  const tools = element('div', 'group-tools');
  if (items.length) {
    const pick = element('label', 'group-pick');
    const box = checkbox('Select every message in ' + title);
    box.addEventListener('change', function () {
      items.forEach(function (item) { select(item, box.checked); });
      updateSelection();
    });
    pick.append(box, element('span', '', 'Select all'));
    tools.append(pick);
    groupBoxes.push({ box: box, items: items });
  }
  tools.append(element('strong', 'group-count', String(items.length)));
  heading.append(text, tools);
  const list = element('div', 'messages');
  items.forEach(function (item) { list.append(messageRow(item, isRead)); });
  if (!items.length) list.append(element('p', 'empty', 'No messages in this section.'));
  section.append(heading, list);
  return section;
}
/** The archive's messages, less those purged from this page. */
function liveMessages(topic, channel) {
  return (Array.isArray(topic.messages) ? topic.messages : []).filter(function (message) {
    return !purged.has(keyOf(channel, message.id));
  });
}
function render() {
  ui.topics.replaceChildren();
  shownItems = [];
  groupBoxes = [];
  if (!archiveData) { updateSelection(); return; }
  const query = ui.filter.value.trim().toLocaleLowerCase();
  const awaiting = [];
  const archived = [];
  const entries = Object.entries(archiveData.topics || {});
  entries.forEach(function (entry) {
    const channel = entry[0], topic = entry[1];
    const label = labelFor(channel);
    liveMessages(topic, channel).forEach(function (message) {
      const item = { channel: channel, topic: topic, message: message, label: label, key: keyOf(channel, message.id) };
      if (query && !searchable(item).includes(query)) return;
      (acknowledged(topic, message) ? archived : awaiting).push(item);
    });
  });
  awaiting.sort(function (a, b) {
    const ax = Number(a.message.expires || Number.MAX_SAFE_INTEGER);
    const bx = Number(b.message.expires || Number.MAX_SAFE_INTEGER);
    return ax - bx || Number(a.message.time || 0) - Number(b.message.time || 0);
  });
  archived.sort(function (a, b) { return Number(b.message.time || 0) - Number(a.message.time || 0); });
  shownItems = awaiting.concat(archived);
  ui.topics.append(
    group('Awaiting opening', 'Unread notifications, ordered by the nearest ntfy expiration.', awaiting, false),
    group('Read and archived', 'Acknowledged messages kept permanently in the Drive and GitHub archive.', archived, true)
  );
  const counts = entries.map(function (entry) { return liveMessages(entry[1], entry[0]); });
  ui.messageCount.textContent = String(counts.reduce(function (total, messages) { return total + messages.length; }, 0));
  ui.topicCount.textContent = String(counts.filter(function (messages) { return messages.length; }).length);
  ui.unreadCount.textContent = String(entries.reduce(function (total, entry, index) {
    return total + counts[index].filter(function (message) { return !acknowledged(entry[1], message); }).length;
  }, 0));
  ui.updatedAt.textContent = archiveData.updatedAt ? new Date(archiveData.updatedAt).toLocaleString() : 'Never';
  ui.emptyState.hidden = shownItems.length !== 0;
  updateSelection();
  updateClocks();
}
/** Purges `items` ({channel, id, text}) in one request: one Drive save, one GitHub commit. */
async function purge(items) {
  if (!items.length || working) return;
  const previews = items.slice(0, 5).map(function (item) {
    return '- ' + String(item.text || '').replace(/\s+/g, ' ').slice(0, 80);
  }).join('\n');
  const more = items.length > 5 ? '\n...and ' + (items.length - 5) + ' more' : '';
  const what = items.length === 1 ? 'this message' : 'these ' + items.length + ' messages';
  if (!window.confirm('Permanently purge ' + what + ' from the current Drive/GitHub archive and active ntfy clients?\n\n' + previews + more + '\n\nThis cannot be undone from the Communication Center.')) return;
  busy(true);
  notice('Purging ' + (items.length === 1 ? 'the message' : items.length + ' messages') + ' and publishing the updated archive...');
  try {
    const data = await api('/api/communication-center/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ items: items.map(function (item) { return { channel: item.channel, id: item.id }; }) })
    });
    const result = data.result || {};
    (result.removed || []).forEach(function (entry) {
      const key = keyOf(entry.channel, entry.id);
      purged.add(key);
      selected.delete(key);
    });
    const failed = Array.isArray(result.failed) ? result.failed.length : 0;
    notice(data.message + (result.warning ? '. ' + result.warning : ''), failed > 0);
    render();
    await loadArchive(true);
  } catch (error) { notice(error.message, true); }
  finally { busy(false); }
}
async function loadConfig() {
  const data = await api('/api/communication-center/config');
  ui.webAppUrl.value = data.webAppUrl;
  ui.archiveUrl.value = data.archiveUrl;
  const ready = Boolean(data.webAppUrl && data.tokenConfigured);
  ui.connectionState.textContent = ready ? 'Connected' : 'Setup required';
  ui.connectionState.classList.toggle('ready', ready);
}
async function loadArchive(silent) {
  try {
    if (!silent) notice('Loading the published archive...');
    const data = await api('/api/communication-center/archive');
    archiveData = data.archive;
    registry = data.registry || [];
    // Forget what the archive no longer holds: purged messages it has caught up with, and
    // selections of messages that are gone.
    const present = new Set();
    Object.entries(archiveData.topics || {}).forEach(function (entry) {
      (Array.isArray(entry[1].messages) ? entry[1].messages : []).forEach(function (message) {
        present.add(keyOf(entry[0], message.id));
      });
    });
    Array.from(purged).forEach(function (key) { if (!present.has(key)) purged.delete(key); });
    Array.from(selected.keys()).forEach(function (key) { if (!present.has(key) || purged.has(key)) selected.delete(key); });
    render();
    if (!silent) notice('Archive view is current.');
  } catch (error) { notice(error.message, true); }
}
ui.saveConnection.addEventListener('click', async function () {
  busy(true);
  try {
    const data = await api('/api/communication-center/config', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({webAppUrl:ui.webAppUrl.value,archiveUrl:ui.archiveUrl.value,token:ui.manualToken.value})
    });
    ui.manualToken.value = '';
    notice(data.message);
    await loadConfig();
  } catch (error) { notice(error.message, true); }
  finally { busy(false); }
});
ui.syncNow.addEventListener('click', async function () {
  busy(true);
  notice('Google collector is polling ntfy, updating Drive, and publishing GitHub...');
  try {
    const data = await api('/api/communication-center/sync', {method:'POST'});
    const result = data.result || {};
    const messages = result.messages === undefined ? 0 : result.messages;
    const topics = result.topics === undefined ? 0 : result.topics;
    notice(data.message + '. ' + messages + ' messages across ' + topics + ' channels.');
    await loadArchive(true);
  } catch (error) { notice(error.message, true); }
  finally { busy(false); }
});
ui.refreshArchive.addEventListener('click', function () { loadArchive(false); });
ui.filter.addEventListener('input', render);
ui.selectShown.addEventListener('click', function () {
  shownItems.forEach(function (item) { select(item, true); });
  updateSelection();
});
ui.clearSelection.addEventListener('click', function () {
  selected.clear();
  updateSelection();
});
ui.purgeSelected.addEventListener('click', function () {
  purge(Array.from(selected.values()));
});
setInterval(updateClocks, 1000);
Promise.all([loadConfig(), loadArchive(false)]).catch(function (error) { notice(error.message, true); });
