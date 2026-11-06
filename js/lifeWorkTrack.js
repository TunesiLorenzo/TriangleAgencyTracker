// lifeWorkTrack.js
// The 30-box tracks of the Agenda Vita-Lavoro (ARC_Dossier page 8), shared by the Anomaly
// and Agency tabs: 15 boxes left to right, then the bottom row back from right to left.
// Some boxes carry the code of a Document to read in Playwall. Marking one track erases the
// last box of the other two, so each track can also lose boxes from its end: those are
// crossed off for good (card._crossedOff).

import { saveSettings } from './storage.js';
import { toast } from './ui.js';

export const TRACK_LENGTH = 30;
const ROW = TRACK_LENGTH / 2;
export const TRACK_KEYS = ['competency', 'reality', 'anomaly'];

/**
 * How many boxes are crossed off the end of each track, as a fresh object. `progress` (per
 * key) keeps a crossed-off box from overlapping a marked one.
 */
export function normalizeCrossedOff(data = {}, progress = {}) {
  return Object.fromEntries(TRACK_KEYS.map(key => {
    const value = Math.max(0, Number.parseInt(data?.[key], 10) || 0);
    return [key, Math.min(value, TRACK_LENGTH - (progress[key] || 0))];
  }));
}

/** The last box of a card's track that can still be marked. */
export function lastObtainable(card, key) {
  return TRACK_LENGTH - (card?._crossedOff?.[key] || 0);
}

/** Read-only overview squares: flags the boxes crossed off the end of the track. */
export function markCrossedOff(square, n, card, key) {
  const lost = n > lastObtainable(card, key);
  square.classList.toggle('track-lost', lost);
  if (lost) square.title = `Casella ${n} — irraggiungibile`;
}

/**
 * The clickable box grid. Clicking box n marks every box up to n; clicking the last marked
 * box unmarks it. With `card` and `trackKey`, right-clicking the last box still obtainable
 * crosses it off for good (an Annulla toast takes it back). `describe(n)` names a box for its
 * tooltip; `onChange(previous, next)` runs after each change has been saved.
 */
export function createLifeWorkTrack({ label, className, squareClass, codes = {}, get, set, describe, onChange, card, trackKey }) {
  const squares = document.createElement('div');
  squares.className = className;
  squares.setAttribute('role', 'group');
  squares.setAttribute('aria-label', label);

  const end = () => (trackKey ? lastObtainable(card, trackKey) : TRACK_LENGTH);
  const texts = [];
  const update = () => [...squares.children].forEach((square, i) => {
    const n = i + 1;
    const lost = n > end();
    square.setAttribute('aria-pressed', String(i < get()));
    square.setAttribute('aria-disabled', String(lost));
    square.classList.toggle('track-lost', lost);
    const text = lost ? `Casella ${n} — irraggiungibile`
      : trackKey && n === end() && n > get() ? `${texts[i]} · clic destro: rendila irraggiungibile`
      : texts[i];
    square.title = text;
    square.setAttribute('aria-label', text);
  });

  // Box 30 sits bottom-left (the bottom row runs back right to left), so a right-click on
  // any other box points at the real end instead of doing nothing.
  const pointAtEnd = () => {
    const square = squares.children[end() - 1];
    if (!square) return;
    square.classList.remove('track-end-hint');
    void square.offsetWidth;
    square.classList.add('track-end-hint');
    setTimeout(() => square.classList.remove('track-end-hint'), 1600);
  };

  const crossOff = n => {
    if (!trackKey) return;
    const last = end();
    if (n > last) {
      toast(`La casella ${n} è già irraggiungibile.`);
      return;
    }
    if (last <= get()) {
      pointAtEnd();
      toast(`La fine del tracciato (casella ${last}) è già segnata: non può diventare irraggiungibile.`, { kind: 'warn' });
      return;
    }
    if (n !== last) {
      pointAtEnd();
      toast(`Per rendere irraggiungibile la fine del tracciato, fai clic destro sulla casella ${last} (evidenziata).`);
      return;
    }
    const previous = card._crossedOff[trackKey];
    card._crossedOff[trackKey] = previous + 1;
    update();
    saveSettings();
    onChange?.(get(), get());
    toast(`${label}: casella ${n} irraggiungibile.`, {
      duration: 6000,
      action: {
        label: 'Annulla',
        onClick: () => {
          if (card._crossedOff[trackKey] !== previous + 1) return;
          card._crossedOff[trackKey] = previous;
          update();
          saveSettings();
          onChange?.(get(), get());
        }
      }
    });
  };

  for (let n = 1; n <= TRACK_LENGTH; n++) {
    const square = document.createElement('button');
    square.type = 'button';
    square.className = squareClass;
    square.textContent = codes[n] || '';
    square.style.gridRow = n <= ROW ? '1' : '2';
    square.style.gridColumn = String(n <= ROW ? n : TRACK_LENGTH + 1 - n);
    texts.push(describe?.(n) || [`Casella ${n}`, codes[n]].filter(Boolean).join(' — '));
    square.addEventListener('click', () => {
      if (n > end()) return;
      const previous = get();
      set(previous === n ? n - 1 : n);
      update();
      saveSettings();
      onChange?.(previous, get());
    });
    square.addEventListener('contextmenu', event => {
      event.preventDefault();
      crossOff(n);
    });
    squares.append(square);
  }

  update();
  return squares;
}

/** Codes of the boxes newly marked by going from `previous` to `next` (none when going back). */
export function reachedCodes(codes, previous, next) {
  return Object.entries(codes)
    .filter(([position]) => Number(position) > previous && Number(position) <= next)
    .map(([, code]) => code);
}
