// easterEggs.js
// Tests the Agency springs on its agents, on a published copy only. A signed-in Manager fires
// one from an agent card (the button beside the direct line, messages.js): it travels on the
// agent's direct line as a Manager message tagged ta-egg-<id>, and pops up on the agent's
// screen, whatever tab they are on, in place of the usual transmission. What the agent
// chooses is told to the Manager in an ntfy notification and recorded on the agent's direct
// line as structured audit data. A published copy still changes no character-sheet data, so
// the Manager applies the merit, demerit or item at the table.
//
// An egg: { id, title (what the Manager picks, and the line kept in the history), summary
// (for the Manager), from, heading, warning: { title, text }, choices }.
// A choice: { label, verdict: 'fail' | 'pass', heading, text, note, outcome (for the
// Manager), boons (one is drawn at random and granted) }.

import { publish, who } from './access.js';
import { getConfig } from './config.js';
import { isMuted, playButton, playSlot } from './soundEffects.js';

const CIPHER_GLYPHS = '▓▒░█▚▞◢◣◤◥⟁∆ΣΞΨ#%&@0123456789ABCDEF';
const CIPHER_LINES = 6;
const CIPHER_WIDTH = 30;
const CIPHER_MS = 90;

export const EGGS = [
  {
    id: 'phishing',
    title: 'Messaggio cifrato',
    summary: 'Test di phishing e lealtà: un messaggio anomalo da fonte ignota. Apri = test fallito, Quarantena = test superato e un beneficio aziendale.',
    from: 'Mittente sconosciuto',
    heading: 'Segnale anomalo · Messaggio cifrato',
    warning: {
      title: 'Avviso di sicurezza dell’Agenzia',
      text: 'Fonte ignota, certificato di sicurezza non riconosciuto, procedere con cautela'
    },
    choices: [
      {
        label: 'Apri',
        verdict: 'fail',
        heading: 'Test di phishing fallito',
        text: 'Il messaggio era una simulazione del Reparto Sicurezza Informatica. Aprendo un contenuto di provenienza ignota hai fallito il test di phishing e la verifica di lealtà. L’esito verrà annotato nel tuo fascicolo personale.',
        note: 'Non è richiesta alcuna azione da parte tua. L’Agenzia ha già provveduto.',
        outcome: 'Ha aperto il messaggio: test di phishing e di lealtà FALLITO, annotato nel fascicolo. Suggerita: 1 Nota di Demerito.'
      },
      {
        label: 'Quarantena',
        verdict: 'pass',
        heading: 'Test superato',
        text: 'Il messaggio era un’esercitazione del Reparto Sicurezza Informatica. Mettendolo in quarantena hai dimostrato prudenza e lealtà esemplari. L’Agenzia si congratula con te e ti riconosce il seguente beneficio:',
        note: 'Il beneficio non è convertibile in Note di Merito, né cedibile a terzi.',
        outcome: 'Ha messo il messaggio in quarantena: test SUPERATO.',
        boons: [
          'Ricariche gratuite per la penna aziendale per un mese intero (solo inchiostro blu).',
          'Un posto auto riservato nel parcheggio del Quartier Generale, il martedì dalle 6:00 alle 6:15.',
          'Una graffetta in più. Non a compressione.',
          'Precedenza alla fotocopiatrice del terzo piano, nei giorni in cui funziona.',
          'Una seconda bustina di zucchero alla macchinetta del caffè, previa compilazione del modulo Z-12 in triplice copia.',
          'Una pausa bagno aggiuntiva di 90 secondi, non cumulabile.',
          'Una menzione nella newsletter interna, in corpo 6.',
          'L’esonero dalla riunione del lunedì sulla riduzione delle riunioni.',
          'Il diritto di scegliere il colore della prossima cartellina (tra grigio e grigio chiaro).'
        ]
      }
    ]
  }
];

export const eggById = id => EGGS.find(egg => egg.id === id) || null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const pick = list => list[Math.floor(Math.random() * list.length)];
const cipherLine = () => Array.from({ length: CIPHER_WIDTH }, () => pick(CIPHER_GLYPHS)).join('');
const cipherText = () => Array.from({ length: CIPHER_LINES }, cipherLine).join('\n');
const reducedMotion = () => document.documentElement.dataset.motion === 'reduced';

function playEvent(name) {
  if (!isMuted()) playSlot(getConfig().sounds.events[name]);
}

/** The red Agency verdict, in place of the message, until it is acknowledged. */
function showVerdict(overlay, choice, boon) {
  const verdict = el('div', `egg-verdict is-${choice.verdict}`);
  verdict.setAttribute('role', 'alertdialog');
  verdict.append(
    el('p', 'egg-banner-title', 'Triangle Agency · Reparto Sicurezza Informatica'),
    el('p', 'egg-verdict-heading', choice.heading),
    el('p', 'egg-verdict-text', choice.text)
  );
  if (boon) verdict.append(el('p', 'egg-verdict-boon', boon));
  verdict.append(
    el('p', 'egg-verdict-stamp', choice.verdict === 'pass' ? 'Esito: conforme' : 'Esito: non conforme'),
    el('p', 'egg-verdict-note', `${choice.note} · Pratica n° ${1000 + Math.floor(Math.random() * 9000)}`)
  );
  const done = el('button', 'egg-button', 'Preso atto');
  done.type = 'button';
  verdict.append(el('div', 'egg-choices'));
  verdict.lastChild.append(done);
  overlay.querySelector('.egg-stage').replaceChildren(verdict);
  done.focus();
  return done;
}

/**
 * Play an egg on this agent's screen. Resolves once the agent has chosen and acknowledged
 * the verdict; until then nothing closes it, so a page closed halfway shows it again.
 */
export function playEgg(egg, onResult = null) {
  return new Promise(resolve => {
    const overlay = el('div', 'egg tx-anomaly');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', egg.heading);
    overlay.innerHTML = `
      <div class="egg-stage">
        <div class="egg-message">
          <p class="transmission-head"><span class="transmission-dot" aria-hidden="true"></span><span></span></p>
          <p class="transmission-from"></p>
          <pre class="egg-cipher" aria-label="Contenuto cifrato, illeggibile"></pre>
        </div>
        <div class="egg-banner" role="alert">
          <p class="egg-banner-title"></p>
          <p class="egg-banner-text"></p>
          <div class="egg-choices"></div>
        </div>
      </div>`;
    overlay.querySelector('.transmission-head span:last-child').textContent = egg.heading;
    overlay.querySelector('.transmission-from').textContent = `Da: ${egg.from}`;
    overlay.querySelector('.egg-banner-title').textContent = `⚠ ${egg.warning.title}`;
    overlay.querySelector('.egg-banner-text').textContent = egg.warning.text;

    const cipher = overlay.querySelector('.egg-cipher');
    cipher.textContent = cipherText();
    const scramble = reducedMotion() ? 0 : setInterval(() => { cipher.textContent = cipherText(); }, CIPHER_MS);

    const choose = choice => {
      clearInterval(scramble);
      const boon = choice.boons?.length ? pick(choice.boons) : '';
      playEvent(choice.verdict === 'pass' ? 'merit' : 'demerit');
      try {
        onResult?.({
          egg: egg.id,
          title: egg.title,
          verdict: choice.verdict,
          choice: choice.label,
          outcome: choice.outcome,
          boon,
          time: Math.floor(Date.now() / 1000)
        });
      } catch {
        // The direct notification below still reaches the Manager; the message layer keeps
        // failed ledger writes locally and retries them independently.
      }
      publish(
        `Easter egg · ${egg.title}`,
        `${who()} ha scelto «${choice.label}».\n${choice.outcome}${boon ? `\nBeneficio concesso: ${boon}` : ''}`,
        [choice.verdict === 'pass' ? 'white_check_mark' : 'fishing_pole_and_fish']
      );
      showVerdict(overlay, choice, boon).addEventListener('click', () => {
        overlay.remove();
        resolve();
      });
    };
    overlay.querySelector('.egg-choices').append(...egg.choices.map(choice => {
      // Alike, so the buttons give nothing away.
      const button = el('button', 'egg-button', choice.label);
      button.type = 'button';
      button.addEventListener('click', () => choose(choice), { once: true });
      return button;
    }));
    // A click anywhere else stays on the page under it.
    overlay.addEventListener('click', event => event.stopPropagation());

    document.body.append(overlay);
    playButton('session', 'badgeRead');
  });
}
