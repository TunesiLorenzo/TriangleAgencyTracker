/* The publish bar on /publish, the editorial copy of the published viewer.
 *
 * web.py adds this file to index.html on /publish only; /public and the copy on GitHub
 * Pages never load it. The page above it is the published copy exactly as players get it,
 * built live from the tracker file. The bar says what has changed since the last publish
 * (the team, the settings, the cases, or the viewer's own files) and commits and pushes
 * the copy to the gh-pages branch, which is what republishes the site. */

(function () {
  // Disconnect closes the published copy (js/login.js); the preview stays open instead.
  document.documentElement.dataset.publishPreview = '';

  const bar = document.createElement('div');
  bar.id = 'publishBar';
  bar.innerHTML = `
    <span class="publish-tag">EDITORIAL PREVIEW</span>
    <span id="publishState">Checking GitHub…</span>
    <button type="button" id="publishDetailsButton" aria-expanded="false" aria-controls="publishDetails" hidden>Details</button>
    <a id="publishSiteLink" target="_blank" rel="noopener" hidden>Public site ↗</a>
    <button type="button" id="publishReload" title="Load the tracker file again">Reload preview</button>
    <button type="button" id="publishButton" disabled>Commit &amp; push</button>`;
  const details = document.createElement('div');
  details.id = 'publishDetails';
  details.hidden = true;
  document.body.append(bar, details);

  const stateBox = bar.querySelector('#publishState');
  const detailsButton = bar.querySelector('#publishDetailsButton');
  const siteLink = bar.querySelector('#publishSiteLink');
  const publishButton = bar.querySelector('#publishButton');
  let status = null;
  let busy = false;

  async function call(method) {
    const response = await fetch('/api/publish', { method, cache: 'no-store' });
    const result = await response.json().catch(() => ({ ok: false, message: `HTTP ${response.status}` }));
    if (!response.ok || !result.ok) throw new Error(result.message || 'Request failed');
    return result;
  }

  function say(text, kind = '') {
    stateBox.textContent = text;
    stateBox.title = text;
    stateBox.className = kind;
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
  const otherFiles = () => status.changed.filter(path => path !== 'snapshot.json');

  function summary() {
    if (!status.published) return ['Not published yet', 'pending'];
    const date = new Date(status.published.date).toLocaleString();
    if (!status.changed.length) return [`Published ${date}: GitHub Pages shows exactly this`, 'success'];
    const parts = [];
    if (status.data.length) parts.push(status.data.join(', '));
    if (otherFiles().length) parts.push(plural(otherFiles().length, 'file'));
    return [`Changed since ${date}: ${parts.join(' · ')}`, 'pending'];
  }

  function list(heading, items) {
    if (!items.length) return;
    const title = document.createElement('h4');
    title.textContent = heading;
    const ul = document.createElement('ul');
    items.slice(0, 200).forEach(item => { ul.appendChild(document.createElement('li')).textContent = item; });
    if (items.length > 200) ul.appendChild(document.createElement('li')).textContent = `…and ${items.length - 200} more`;
    details.append(title, ul);
  }

  function show(message, kind) {
    const [text, summaryKind] = summary();
    say(message || text, kind || summaryKind);
    publishButton.disabled = busy || !status.changed.length;
    siteLink.hidden = !status.site;
    if (status.site) siteLink.href = status.site;
    detailsButton.hidden = false;

    details.replaceChildren();
    const about = document.createElement('p');
    about.textContent = `${plural(status.files, 'file')}, ${(status.size / 1024 / 1024).toFixed(0)} MB.` +
      (status.published ? ` On GitHub now: ${status.published.message}` : '');
    details.append(about);
    list('Data changed', status.data);
    list('Files changed', otherFiles());
    list('Scans missing here, shown as placeholders', status.missing);
  }

  async function refresh() {
    if (busy) return;
    try {
      status = await call('GET');
      show();
    } catch (error) {
      say(`Could not check GitHub: ${error.message}`, 'error');
    }
  }

  detailsButton.addEventListener('click', () => {
    details.hidden = !details.hidden;
    detailsButton.setAttribute('aria-expanded', String(!details.hidden));
  });

  bar.querySelector('#publishReload').addEventListener('click', () => location.reload());

  publishButton.addEventListener('click', async () => {
    const [text] = summary();
    if (!window.confirm(`Commit and push to GitHub Pages? Anyone with the link sees the new copy.\n\n${text}`)) return;
    busy = true;
    publishButton.disabled = true;
    say('Building and pushing…', 'pending');
    try {
      const result = await call('POST');
      status = result;
      busy = false;
      show(result.message, 'success');
    } catch (error) {
      busy = false;
      publishButton.disabled = false;
      say(error.message, 'error');
    }
  });

  document.addEventListener('published-copy-closed', () => {
    say('Disconnected: on the public site the page closes here. Reload preview to sign in again.', 'pending');
  });

  // Changes made on the tracker in another tab show up as unpublished on coming back.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
})();
