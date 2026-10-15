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
