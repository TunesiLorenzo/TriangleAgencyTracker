/* The spectate bar on /spectate (web.py): the published copy as a player sees it, with
 * nothing sent back.
 *
 * web.py puts a guard at the top of the page that refuses every request other than a GET
 * or HEAD, and sets data-spectate, which js/access.js and js/messages.js read: no sign-in
 * notice, no read receipts, no event results, no replies. The popups and the Messages panel
 * work as for the player, but whatever is "seen" here is kept in memory only, so Reload
 * shows the next login again. The bar says which snapshot is on show (GitHub Pages' or the
 * tracker file's), and fills in the credentials of the account picked. */

(function () {
  const local = location.pathname.startsWith('/spectate/local');

  const bar = document.createElement('div');
  bar.id = 'publishBar';
  bar.className = 'is-spectate';
  bar.innerHTML = `
    <span class="publish-tag">SPECTATING · NOTHING IS SENT</span>
    <label class="spectate-pick">
      <span>Sign in as</span>
      <select id="spectateAccount"><option value="">Loading accounts…</option></select>
    </label>
    <span id="publishState">Reading the snapshot…</span>
    <a id="spectateSwitch" href="${local ? '/spectate/' : '/spectate/local/'}">${local ? 'Show published copy' : 'Show local tracker'}</a>
    <button type="button" id="spectateReload" title="Start over: the next login, as if nothing had been seen here">Reload</button>`;
  document.body.append(bar);

  const stateBox = bar.querySelector('#publishState');
  const select = bar.querySelector('#spectateAccount');
  let accounts = [];

  function say(text, kind = '') {
    stateBox.textContent = text;
    stateBox.title = text;
    stateBox.className = kind;
  }

  async function source() {
    try {
      const response = await fetch('./snapshot.json', { cache: 'no-store' });
      const snapshot = await response.json();
      const where = snapshot.spectate || {};
      if (where.fallback) say(`GitHub Pages could not be read (${where.fallback}): showing the local tracker file instead`, 'error');
      else if (where.source === 'published') say('Published copy: what GitHub Pages serves now, so what the player gets on their next login', 'success');
      else say('Local tracker file: as it would be published now (may differ from the live site)', 'pending');
    } catch (error) {
      say(`Could not read the snapshot: ${error.message}`, 'error');
    }
  }

  async function loadAccounts() {
    try {
      const response = await fetch('/api/spectate/accounts', { cache: 'no-store' });
      accounts = (await response.json()).accounts || [];
    } catch {
      accounts = [];
    }
    select.replaceChildren(new Option(accounts.length ? 'Pick an account…' : 'No accounts', ''));
    accounts.forEach((account, index) => {
      select.append(new Option(account.name ? `${account.name} (${account.username})` : account.username, String(index)));
    });
  }

  /** Into the login screen's fields, then Enter, as the player would. */
  function signInAs(account) {
    const inputs = [...document.querySelectorAll('#loginScreen .login-entry')];
    if (inputs.length < 2) {
      say('The login screen does not take credentials yet: click it to power it on, then pick again', 'pending');
      return;
    }
    const [user, pass] = inputs;
    user.value = account.username;
    pass.value = account.password;
    inputs.forEach(input => input.dispatchEvent(new Event('input')));
    pass.focus({ preventScroll: true });
    pass.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    say(`Signing in as ${account.username}. If the screen is still asleep, click it, then press Enter`, 'pending');
  }

  select.addEventListener('change', () => {
    const account = accounts[Number(select.value)];
    if (account) signInAs(account);
    select.value = '';
  });

  bar.querySelector('#spectateReload').addEventListener('click', () => location.reload());

  document.addEventListener('published-copy-closed', () => {
    say('Disconnected. Reload to spectate again (nothing was sent)', 'pending');
  });

  source();
  loadAccounts();
})();
