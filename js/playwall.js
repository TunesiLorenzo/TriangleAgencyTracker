// playwall.js
// The Documents in Playwall on a published copy. playwall.py cut each one out of the manual
// and sealed it with a key of its own; build_static.make_access hands out the keys, sealed in
// each account (access.js): the players, who can all reach the same files, read only theirs.
//
//  - The Manager holds the Playwall key, so every Document (each one's key is worked out from
//    it) and the index. Clicking any Playwall code on screen opens its Document; ‹ › step
//    through them, and the PLAYWALL button at the top opens the index of them all.
//  - A player holds the keys of only the Documents their agent had unlocked when the copy was
//    published: the coded boxes ticked on their tracks, and the Documents of the anomaly answer
//    tracks they filled. Those codes, and only those, open their Document when clicked; there
//    is no index and no stepping to the next one. Any other code stays locked (readOnly.js).
//
// What shows a code: a box of the Realtà, Anomalia or Competenza track, the codes on the
// overview tiles, the rank ladder of the Carriera, an anomaly answer track (readOnly.js passes
// those clicks on). The ones that open are marked data-playwall-open, for css/playwall.css.

import { documentKey, getIdentity, unsealFile } from './access.js';
import { openModal, toast } from './ui.js';

const CODE = /^[A-Z]\d{1,2}$/;
// What shows a Playwall code as its text.
const CODE_HOSTS = [
  '.reality-square', '.anomaly-square', '.competency-square',
  '.rel-summary-square', '.anomaly-summary-square', '.agency-mini-square',
  '.agency-ladder-code', '.answer-reference'
].join(', ');
const ANSWER = '.anomaly-answer-controls';

let indexPromise = null;
const pictures = new Map();   // published path -> Promise of an object URL
let viewer = null;            // the open viewer: { show(code), showIndex(), close() }
let observer = null;          // marks the codes that open, as the tabs draw them

const isManager = () => getIdentity()?.manager === true;
const access = () => getIdentity()?.playwall || null;

/** Whether this code opens for whoever is signed in. */
function canOpen(code) {
  if (isManager()) return Boolean(access());
  return Boolean(access()?.documents?.some(doc => doc.code === code));
}

/** The code shown by `host` (an answer track: the code beside its boxes). */
function codeOf(host) {
  const shown = host.matches(ANSWER) ? host.querySelector('.answer-reference') : host;
  const code = shown?.textContent.trim().toUpperCase() || '';
  return CODE.test(code) ? code : '';
}

/**
 * The Playwall code `target` shows, when clicking it should open the Document: any code for
 * the Manager (without a published Playwall, openPlaywall says so), only an unlocked one for a
 * player; '' otherwise.
 */
export function playwallCodeAt(target) {
  if (!(target instanceof Element) || !getIdentity() || getIdentity().guest) return '';
  const host = target.closest(ANSWER) || target.closest(CODE_HOSTS);
  const code = host ? codeOf(host) : '';
  if (!code) return '';
  return isManager() || canOpen(code) ? code : '';
}

/* ---------- marking what opens ---------- */
function mark(root) {
  if (!(root instanceof Element)) return;
  const hosts = [...(root.matches(CODE_HOSTS) ? [root] : []), ...root.querySelectorAll(CODE_HOSTS)];
  for (const host of hosts) {
    const code = codeOf(host);
    const open = Boolean(code) && canOpen(code);
    // An answer track opens from its boxes as well as from its code.
    const answer = host.matches('.answer-reference') ? host.closest(ANSWER) : null;
    for (const node of [host, ...(answer ? answer.querySelectorAll('.answer-square') : [])]) {
      if (open) node.dataset.playwallOpen = code;
      else delete node.dataset.playwallOpen;
    }
  }
}

function unmarkAll() {
  document.querySelectorAll('[data-playwall-open]').forEach(node => { delete node.dataset.playwallOpen; });
}

/* ---------- the sealed files ---------- */
async function fetchSealed(path, key) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return unsealFile(key, await response.arrayBuffer());
}

/** The Documents this account may read: { list, byCode }. The Manager's, from the sealed index. */
function loadIndex() {
  if (!indexPromise) {
    const playwall = access();
    const load = isManager()
      ? fetchSealed(playwall.index, playwall.key).then(bytes => JSON.parse(new TextDecoder().decode(bytes)).documents)
      : Promise.resolve(playwall.documents);
    indexPromise = load
      .then(documents => ({ list: documents, byCode: new Map(documents.map(doc => [doc.code, doc])) }))
      .catch(error => {
        indexPromise = null;   // try again next time
        throw error;
      });
  }
  return indexPromise;
}

const keyOf = doc => doc.key || documentKey(access().key, doc.code);

function picture(part, doc) {
  if (!pictures.has(part.file)) {
    pictures.set(part.file, fetchSealed(part.file, keyOf(doc))
      .then(bytes => URL.createObjectURL(new Blob([bytes], { type: 'image/webp' })))
      .catch(error => {
        pictures.delete(part.file);
        throw error;
      }));
  }
  return pictures.get(part.file);
}

/* ---------- the viewer ---------- */
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const label = doc => [doc.code, doc.title].filter(Boolean).join(' · ');

/** The viewer; `browse` (the Manager's) adds ‹ ›, the arrow keys and the index. */
function createViewer(index, { browse }) {
  const content = make('div', 'playwall-viewer');
  const bar = make('div', 'playwall-bar');
  const meta = make('p', 'playwall-meta');
  const previous = make('button', 'playwall-nav', '‹');
  const next = make('button', 'playwall-nav', '›');
  const indexButton = make('button', 'playwall-index-button', 'Indice');
  [previous, next, indexButton].forEach(button => { button.type = 'button'; });
  previous.setAttribute('aria-label', 'Documento precedente');
  next.setAttribute('aria-label', 'Documento successivo');
  bar.append(meta, ...(browse ? [previous, next, indexButton] : []));
  const body = make('div', 'playwall-body');
  content.append(bar, body);

  let current = -1;
  let heading = null;
  const setTitle = text => {
    heading ??= content.closest('.modal-panel')?.querySelector('.modal-title');
    if (heading) heading.textContent = text;
  };

  function show(code) {
    const doc = index.byCode.get(code);
    if (!doc) {
      toast(`Nessun Documento ${code} nel Playwall.`, { kind: 'warn' });
      return;
    }
    current = index.list.indexOf(doc);
    content.dataset.mode = 'document';
    setTitle(`Documento in Playwall ${doc.code}`);
    meta.textContent = [doc.title, doc.page && `pag. ${doc.page}`].filter(Boolean).join(' · ');
    previous.disabled = current <= 0;
    next.disabled = current >= index.list.length - 1;
    previous.title = previous.disabled ? '' : label(index.list[current - 1]);
    next.title = next.disabled ? '' : label(index.list[current + 1]);
    body.replaceChildren(...doc.parts.map(part => {
      const image = make('img', 'playwall-page');
      image.alt = `Documento ${doc.code}`;
      image.width = part.width;
      image.height = part.height;
      image.decoding = 'async';
      picture(part, doc)
        .then(url => { image.src = url; })
        .catch(() => { image.replaceWith(make('p', 'playwall-error', 'Impossibile aprire questa pagina del Documento.')); });
      return image;
    }));
    body.scrollTop = 0;
  }

  function showIndex() {
    if (!browse) return;
    content.dataset.mode = 'index';
    setTitle('Documenti in Playwall');
    meta.textContent = `${index.list.length} Documenti`;
    const filter = make('input', 'playwall-filter');
    filter.type = 'search';
    filter.placeholder = 'Cerca un codice o un titolo';
    filter.setAttribute('aria-label', 'Cerca nel Playwall');
    const groups = make('div', 'playwall-index');
    const letters = new Map();
    for (const doc of index.list) {
      const letter = doc.code[0];
      if (!letters.has(letter)) {
        const group = make('section', 'playwall-group');
        group.append(make('h3', 'playwall-letter', letter), make('div', 'playwall-codes'));
        letters.set(letter, group);
        groups.append(group);
      }
      const entry = make('button', 'playwall-entry');
      entry.type = 'button';
      entry.dataset.search = `${doc.code} ${doc.title}`.toLowerCase();
      entry.append(make('strong', '', doc.code), make('span', '', doc.title || '—'));
      entry.addEventListener('click', () => show(doc.code));
      letters.get(letter).lastChild.append(entry);
    }
    filter.addEventListener('input', () => {
      const words = filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      for (const group of letters.values()) {
        let shown = 0;
        for (const entry of group.lastChild.children) {
          entry.hidden = !words.every(word => entry.dataset.search.includes(word));
          if (!entry.hidden) shown++;
        }
        group.hidden = !shown;
      }
    });
    body.replaceChildren(filter, groups);
    body.scrollTop = 0;
    requestAnimationFrame(() => filter.focus());
  }

  previous.addEventListener('click', () => { if (current > 0) show(index.list[current - 1].code); });
  next.addEventListener('click', () => { if (current < index.list.length - 1) show(index.list[current + 1].code); });
  indexButton.addEventListener('click', showIndex);

  const onKey = event => {
    if (!browse || content.dataset.mode !== 'document' || event.target.closest?.('input, textarea')) return;
    if (event.key === 'ArrowLeft') previous.click();
    else if (event.key === 'ArrowRight') next.click();
    else return;
    event.preventDefault();
  };
  document.addEventListener('keydown', onKey);

  const close = openModal({
    title: 'Documenti in Playwall',
    content,
    className: 'playwall-modal',
    closeLabel: 'Chiudi',
    onClose: () => {
      document.removeEventListener('keydown', onKey);
      viewer = null;
    }
  });
  return { show, showIndex, close };
}

async function openViewer() {
  if (!access()) {
    if (isManager()) toast('Il Playwall non è stato pubblicato: esegui playwall.py, poi pubblica di nuovo.', { kind: 'warn', duration: 5000 });
    return null;
  }
  if (viewer) return viewer;
  let index;
  try {
    index = await loadIndex();
  } catch {
    toast('Impossibile aprire il Playwall.', { kind: 'error' });
    return null;
  }
  viewer ??= createViewer(index, { browse: isManager() });
  return viewer;
}

/** The Document with this code, in the viewer, if this account may read it. */
export async function openPlaywall(code) {
  if (!isManager() && !canOpen(code)) return;
  (await openViewer())?.show(code);
}

/** The index of every Document: the Manager's only. */
export async function openPlaywallIndex() {
  if (!isManager()) return;
  (await openViewer())?.showIndex();
}

/* ---------- the session ---------- */
/** Signed in: the codes that open are marked, and the Manager gets the PLAYWALL button. */
export function startPlaywall() {
  const identity = getIdentity();
  if (!identity || identity.guest || (!identity.manager && !access())) return;
  mark(document.body);
  observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(mark)));
  observer.observe(document.body, { childList: true, subtree: true });

  const disconnect = document.getElementById('logoutButton');
  if (!identity.manager || !disconnect || document.getElementById('playwallButton')) return;
  const button = make('button');
  button.type = 'button';
  button.id = 'playwallButton';
  button.innerHTML = '<span aria-hidden="true">&#9650;</span> Playwall';
  button.addEventListener('click', openPlaywallIndex);
  disconnect.before(button);
}

/** Signed out: nothing of the Playwall stays behind for whoever signs in next. */
export function stopPlaywall() {
  observer?.disconnect();
  observer = null;
  unmarkAll();
  document.getElementById('playwallButton')?.remove();
  viewer?.close();
  viewer = null;
  indexPromise = null;
  for (const url of pictures.values()) url.then(value => URL.revokeObjectURL(value), () => {});
  pictures.clear();
}
