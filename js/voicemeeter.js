// Local VoiceMeeter client.
//
// The viewer may come from the desktop tracker server, but this endpoint is
// always loopback: 127.0.0.1 means the computer displaying the page.
const DEFAULT_PORT = 5003;

function endpoint(path, settings = {}) {
  const configured = Number(settings.bridgePort);
  const port = Number.isInteger(configured) && configured >= 1024 && configured <= 65535
    ? configured
    : DEFAULT_PORT;
  return 'http://127.0.0.1:' + port + path;
}

async function bridgeRequest(path, settings, options = {}) {
  const response = await fetch(endpoint(path, settings), {
    cache: 'no-store',
    ...options,
    // Modern Chromium uses this to classify the loopback request before DNS.
    targetAddressSpace: 'local'
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('The local VoiceMeeter bridge returned an invalid response.');
  }
  if (!response.ok || !data.ok) {
    throw new Error(data.message || 'The local VoiceMeeter command failed.');
  }
  return data;
}

export function getVoiceMeeterStatus(settings) {
  return bridgeRequest('/api/status', settings);
}

export function setVoiceMeeterLevel(action, settings) {
  if (action !== 'drop' && action !== 'restore') {
    return Promise.reject(new Error('VoiceMeeter action must be drop or restore.'));
  }
  return bridgeRequest('/api/voicemeeter', settings, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...settings, action })
  });
}
