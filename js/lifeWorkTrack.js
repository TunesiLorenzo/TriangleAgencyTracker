// lifeWorkTrack.js
// The 30-box tracks of the Agenda Vita-Lavoro (ARC_Dossier page 8), shared by the Anomaly
// and Agency tabs: 15 boxes left to right, then the bottom row back from right to left.
// Some boxes carry the code of a Document to read in Playwall.

import { saveSettings } from './storage.js';

export const TRACK_LENGTH = 30;
const ROW = TRACK_LENGTH / 2;

/**
 * The clickable box grid. Clicking box n marks every box up to n; clicking the last marked
 * box unmarks it. `describe(n)` names a box for its tooltip; `onChange(previous, next)` runs
 * after each change has been saved.
 */
export function createLifeWorkTrack({ label, className, squareClass, codes = {}, get, set, describe, onChange }) {
  const squares = document.createElement('div');
  squares.className = className;
  squares.setAttribute('role', 'group');
  squares.setAttribute('aria-label', label);

  const update = () => [...squares.children].forEach((square, i) => square.setAttribute('aria-pressed', String(i < get())));

  for (let n = 1; n <= TRACK_LENGTH; n++) {
    const square = document.createElement('button');
    square.type = 'button';
    square.className = squareClass;
    square.textContent = codes[n] || '';
    square.style.gridRow = n <= ROW ? '1' : '2';
    square.style.gridColumn = String(n <= ROW ? n : TRACK_LENGTH + 1 - n);
    const text = describe?.(n) || [`Casella ${n}`, codes[n]].filter(Boolean).join(' — ');
    square.title = text;
    square.setAttribute('aria-label', text);
    square.addEventListener('click', () => {
      const previous = get();
      set(previous === n ? n - 1 : n);
      update();
      saveSettings();
      onChange?.(previous, get());
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
