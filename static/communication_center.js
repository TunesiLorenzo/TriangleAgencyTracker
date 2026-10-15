const ids = [
  'webAppUrl','manualToken','archiveUrl','saveConnection','syncNow','refreshArchive',
  'connectionState','notice','messageCount','topicCount','unreadCount','updatedAt',
  'nextSync','filter','topics','emptyState'
];
const ui = Object.fromEntries(ids.map(function (id) { return [id, document.getElementById(id)]; }));
let archiveData = null;
let registry = [];

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
  ui.saveConnection.disabled = value;
  ui.syncNow.disabled = value;
  ui.refreshArchive.disabled = value;
}
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
function messageRow(item, isRead) {
  const message = item.message;
  const row = element('article', 'message' + (isRead ? '' : ' unread'));
  const head = element('div', 'message-head');
  const date = message.time ? new Date(Number(message.time) * 1000).toLocaleString() : 'Unknown time';
  head.append(
    element('span', '', (message.from || message.side || 'Unknown') + ' - ' + date),
    element('span', 'receipt', isRead ? 'Read and archived' : 'Awaiting opening')
  );
  const conversation = element('div', 'conversation', item.label.title);
  conversation.title = item.label.detail;
  const text = element('p', '', message.text || '');
  const footer = element('div', 'message-actions');
  const clock = element('span', 'clock');
  const estimatedExpiry = Number(message.expires || 0) || (Number(message.time || 0) + 12 * 60 * 60);
  clock.dataset.expires = String(estimatedExpiry);
  const button = element('button', 'danger small', 'Purge message');
  button.type = 'button';
  button.addEventListener('click', function () { purge(item); });
  footer.append(clock, button);
  row.append(head, conversation, text, footer);
  return row;
}
function group(title, description, items, isRead) {
  const section = element('section', 'message-group');
  const heading = element('div', 'group-heading');
  const text = element('div');
  text.append(element('h3', '', title), element('p', 'topic-meta', description));
  heading.append(text, element('strong', 'group-count', String(items.length)));
  const list = element('div', 'messages');
  items.forEach(function (item) { list.append(messageRow(item, isRead)); });
  if (!items.length) list.append(element('p', 'empty', 'No messages in this section.'));
  section.append(heading, list);
  return section;
}
function render() {
  ui.topics.replaceChildren();
  if (!archiveData) return;
  const query = ui.filter.value.trim().toLocaleLowerCase();
  const awaiting = [];
  const archived = [];
  const entries = Object.entries(archiveData.topics || {});
  entries.forEach(function (entry) {
    const channel = entry[0], topic = entry[1];
    const label = labelFor(channel);
    (Array.isArray(topic.messages) ? topic.messages : []).forEach(function (message) {
      const item = { channel: channel, topic: topic, message: message, label: label };
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
  ui.topics.append(
    group('Awaiting opening', 'Unread notifications, ordered by the nearest ntfy expiration.', awaiting, false),
    group('Read and archived', 'Acknowledged messages kept permanently in the Drive and GitHub archive.', archived, true)
  );
  const allMessages = entries.flatMap(function (entry) { return Array.isArray(entry[1].messages) ? entry[1].messages : []; });
  ui.messageCount.textContent = String(allMessages.length);
  ui.topicCount.textContent = String(entries.filter(function (entry) { return (entry[1].messages || []).length; }).length);
  ui.unreadCount.textContent = String(entries.reduce(function (total, entry) {
    return total + (entry[1].messages || []).filter(function (message) { return !acknowledged(entry[1], message); }).length;
  }, 0));
  ui.updatedAt.textContent = archiveData.updatedAt ? new Date(archiveData.updatedAt).toLocaleString() : 'Never';
  ui.emptyState.hidden = awaiting.length + archived.length !== 0;
  updateClocks();
}
async function purge(item) {
  const preview = String(item.message.text || '').slice(0, 100);
  if (!window.confirm('Permanently purge this message from the current Drive/GitHub archive and active ntfy clients?\n\n' + preview + '\n\nThis cannot be undone from the Communication Center.')) return;
  busy(true);
  notice('Purging the message and publishing the updated archive...');
  try {
    const data = await api('/api/communication-center/delete', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ channel: item.channel, id: item.message.id })
    });
    const warning = (data.result || {}).warning;
    notice(warning ? data.message + '. ' + warning : data.message);
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
setInterval(updateClocks, 1000);
Promise.all([loadConfig(), loadArchive(false)]).catch(function (error) { notice(error.message, true); });