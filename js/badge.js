// badge.js
// What an agent's badge says, shared by the login screen (login.js), the printable badges
// (/badges, badgePrint.js) and the Agency tab (agency.js): the Division, which is the
// department of their Competency; the Qualifica in Agenzia their Competenza track has
// unlocked; and the barcode, drawn from the badge number so it is the same every time.

import { COMPETENCY_INFO } from './competencies.js';

// Qualifica in Agenzia along the Competenza track. The box that starts each rank carries the
// code of its Playwall Document; from Vicedirettore on, the ranks run along the bottom row.
export const RANKS = [
  { from: 0, title: 'Praticante' },
  { from: 3, title: 'Impiegato', code: 'A3' },
  { from: 6, title: 'Impiegato Senior', code: 'D4' },
  { from: 9, title: 'Quadro', code: 'G3' },
  { from: 12, title: 'Amministratore', code: 'J3' },
  { from: 15, title: 'Vicedirettore', code: 'N3' },
  { from: 18, title: 'Direttore Associato', code: 'Q3' },
  { from: 21, title: 'Direttore', code: 'T3' },
  { from: 24, title: 'Direttore Generale', code: 'W8' },
  { from: 27, title: 'Poltrona in CdA', code: 'Y2' }
];

/** Index in RANKS of the rank held with `progress` boxes marked, which is also the rank box n belongs to. */
export function rankAt(progress) {
  return RANKS.findLastIndex(rank => rank.from <= progress);
}

/** The Qualifica in Agenzia unlocked with `progress` boxes of the Competenza track marked. */
export function qualificationOf(progress) {
  return RANKS[rankAt(Math.max(0, Number.parseInt(progress, 10) || 0))].title;
}

/** The Division on the badge: the department of the Competency ("PR": Pubbliche Relazioni). */
export function divisionOf(competency) {
  const name = String(competency || '').trim();
  return COMPETENCY_INFO[name]?.department || name;
}

/** The barcode's bars and gaps, alternating, as relative widths; from the digits of `number`. */
export function barcodeWidths(number) {
  const widths = [2, 1, 1];
  for (const digit of String(number ?? '').replace(/\D/g, '')) {
    widths.push(1 + (digit % 3), 1 + ((digit >> 1) % 2), 1 + ((digit * 7) % 3), 1);
  }
  widths.push(1, 1, 2);
  return widths;
}

/** Fills `container` with the barcode of `number` (spans; the odd ones are gaps). */
export function drawBarcode(container, number) {
  container.replaceChildren(...barcodeWidths(number).map((width, index) => {
    const bar = document.createElement('span');
    bar.style.flexGrow = String(width);
    if (index % 2) bar.className = 'gap';
    return bar;
  }));
}
