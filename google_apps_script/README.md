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
   - Optional `GITHUB_BRANCH`: defaults to `gh-pages`
   - Optional `ARCHIVE_PATH`: defaults to `messages.json`
   - Optional `DRIVE_FOLDER_ID`: a private Drive folder for the source backup

4. Select `setupCollector` and press **Run**. Approve Drive, external-request, and trigger
   permissions. The function creates the Drive archive, installs the four-hour trigger,
   performs the first sync, and writes the first GitHub update.
5. Check **Executions** in Apps Script after the first run. `syncNow` is available for a
   manual test at any time.

The created `DRIVE_FILE_ID` Script Property is managed automatically. If that Drive file is
deleted, the next run creates a new empty backup; messages already expired from ntfy cannot
then be recovered.

## Behavior

- Every ntfy sequence is stored once under its stable logical ID.
- Read receipts are permanent and stop rejuvenation for the acknowledged message.
- Old rejuvenated ntfy events are left to expire naturally.
- GitHub receives the compact browser archive; Drive retains delivery and expiry metadata.
- The archive is intentionally not encrypted. The website filters it to the channels in
  the signed-in account, but anyone inspecting the public JSON can read its contents.
