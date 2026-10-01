// relationshipsData.js
// The texts at the bottom of the Relationships overview come from the .txt files in texts/,
// so they can be edited without touching the code: one message per line, empty lines and
// lines starting with # are skipped. They are read once per page load.

const TEXT_DIR = './texts/';
const FILES = {
  cold: 'phone-cold.txt',          // bond 0-3
  warm: 'phone-warm.txt',          // bond 4-8
  network: 'phone-network.txt',    // bond 9
  agency: 'phone-agency.txt',      // the Agency cutting in
  strangers: 'phone-strangers.txt',   // "Sender | Message", while there are no relationships
  memos: 'hr-memos.txt'            // the HR ticker
};

export const AGENCY_SENDER = '▲ Triangle Agency';

/** Every list, empty until its file has loaded (or for good, if the file is missing). */
export const TEXTS = Object.fromEntries(Object.keys(FILES).map(key => [key, []]));

function parseLines(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
}

/** Reads every file; resolves once all of them have loaded or failed. */
export const textsReady = Promise.all(Object.entries(FILES).map(async ([key, file]) => {
  try {
    const response = await fetch(TEXT_DIR + file, { cache: 'no-cache' });
    if (response.ok) TEXTS[key] = parseLines(await response.text());
    else console.warn(`Missing ${TEXT_DIR}${file}`);
  } catch (error) {
    console.warn(`Could not read ${TEXT_DIR}${file}`, error);
  }
}));
