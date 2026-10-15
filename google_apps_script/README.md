# Google Drive message collector

This standalone Google Apps Script runs every four hours. It polls the tracker’s ntfy
topics, stores the durable source archive in a private Drive JSON file, rejuvenates unread
messages that have less than five hours left, and updates `messages.json` on `gh-pages`.

## Set up

1. Publish the tracker once with this version, so its `snapshot.json` contains the
   `messageSync` topic registry and the site has an initial `messages.json`.
2. Open <https://script.google.com>, create a standalone project, and paste `Code.gs`.
   Enable **Show appsscript.json manifest file** in Project Settings and copy the supplied
   manifest if you want the project timezone set automatically.
3. In **Project Settings → Script Properties**, add:

   - `SNAPSHOT_URL`: the complete Pages URL, such as
     `https://OWNER.github.io/REPOSITORY/snapshot.json`
   - `GITHUB_OWNER`: the repository owner
   - `GITHUB_REPO`: the repository name
   - `GITHUB_TOKEN`: a fine-grained GitHub token restricted to this repository with
     **Contents: Read and write**
   - Optional `DRIVE_FOLDER_ID`: a private Drive folder for the source backup
   - MANUAL_SYNC_TOKEN: a long random value used only by the local Communication Center

   The target is deliberately fixed to `gh-pages/messages.json`, which is the file the
   published browser reads. Omit `GITHUB_BRANCH` and `ARCHIVE_PATH`; the collector rejects
   non-default values so a successful run cannot silently update the wrong file.

4. Select `setupCollector` and press **Run**. Approve Drive, external-request, and trigger
   permissions. The function creates the Drive archive, installs the four-hour trigger,
   performs the first sync, and writes the first GitHub update.
5. Check **Executions** in Apps Script after the first run. `syncNow` is available for a
   manual test at any time.

The created `DRIVE_FILE_ID` Script Property is managed automatically. If that Drive file is
deleted or becomes inaccessible, the collector stops rather than risk replacing the public
history with an empty archive. Restore the file or its access first. Git history can recover
the public messages and seen receipts, but not Drive-only tags, delivery IDs, or expiry
metadata. Remove `DRIVE_FILE_ID` manually only when you deliberately want to start a new
empty archive; doing so loses any state you have not recovered first.

The source archive is one JSON file. Apps Script's `File.setContent` has a 10 MB limit, so this
layout is not suitable for an indefinitely growing high-volume installation. Check the file's
size periodically; a future sharded archive is required before it approaches that limit.

## Behavior

- Every ntfy sequence is stored once under its stable logical ID.
- Read receipts are permanent and stop rejuvenation for the acknowledged message.
- Old rejuvenated ntfy events are left to expire naturally.
- GitHub receives the compact browser archive; Drive retains delivery and expiry metadata.
- The archive is intentionally not encrypted. The website filters it to the channels in
  the signed-in account, but anyone inspecting the public JSON can read its contents.
- The collector trusts events on its configured ntfy topics, and the published snapshot
  exposes those topic names. Unauthenticated topics are therefore public and writable:
  anyone can forge messages or read receipts, grow the archive, consume publish quota, or
  stop rejuvenation. Integrity requires authenticated ntfy or signed messages; neither is
  implemented by this tracker.

## Connect the local Communication Center

1. Copy the updated Code.gs into Apps Script and add MANUAL_SYNC_TOKEN in
   Project Settings -> Script Properties. Use a long random value.
2. Choose Deploy -> New deployment -> Web app. Execute the app as yourself and allow
   anyone with the URL to access it. The token still protects the sync operation.
3. Copy the deployment URL ending in /exec. After future Code.gs edits, update the
   deployment to a new version.
4. Open http://YOUR-IP:5002/communication-center, enter the deployment URL and the same
   token, and select Save connection.
5. Sync with Google now performs the complete job: poll ntfy, update the private Drive
   archive, rejuvenate unread messages, and publish gh-pages/messages.json.

The token is saved only in local data/communication_center.json and is never returned to
the browser. The page displays the compact public messages.json; private Drive delivery
IDs and expiry metadata are intentionally not exposed.
## Communication Center archive controls

The local Communication Center separates messages into Awaiting opening and Read and
archived. Unread messages are ordered by their ntfy expiry time, while acknowledged
history is newest first. Its clocks show the remaining ntfy cache lifetime and the
collector's estimated next automatic execution. Apps Script time-driven triggers can be
slightly delayed, so the next-run clock is an estimate rather than a guaranteed second.

Purging a message asks the collector to delete its ntfy sequence, removes the content from
the current Drive and GitHub archives, and stores a private tombstone. The tombstone keeps
an old ntfy cache event from being imported again. The collector compacts consecutive commits whose messages begin with Update message
archive into one trailing archive commit after the latest normal Published copy commit.
It uses an atomic expected-head update, so a simultaneous normal publish makes the
collector retry instead of overwriting that publish.

Previous Git commits may still contain
the old public archive; purging does not rewrite Git history.

After copying a Code.gs version that changes doPost or the archive format, use Deploy ->
Manage deployments, edit the web app, select New version, and deploy it. The existing
/exec URL normally remains unchanged.