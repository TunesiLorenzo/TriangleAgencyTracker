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

const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
// A bound on what a transmission may carry; in practice the size of one ntfy message
// (messages.js MAX_TEST_BYTES) limits a test long before this.
const MAX_CHOICES = 50;
export const OPEN_ANSWER_MAX = 500;   // characters an agent may write in an open answer

/**
 * Convert an untrusted transmission into the small, display-only test shape. A test either
 * offers coloured choices, or (mode 'open') asks the agent to write their own answer.
 * Choice tests keep the original shape, without a mode, so older copies still play them.
 */
export function normalizeCustomTest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = String(value.id || '').slice(0, 80);
  const title = String(value.title || '').trim().slice(0, 160);
  const description = String(value.description || '').trim().slice(0, 1000);
  const colour = String(value.colour || '').trim();
  if (!/^[-_A-Za-z0-9]{1,80}$/.test(id) || !title || !description || !HEX_COLOUR.test(colour)) return null;
  if (value.mode === 'open') return { id, title, description, colour, mode: 'open', choices: [] };
  const choices = Array.isArray(value.choices) ? value.choices.slice(0, MAX_CHOICES).map(choice => ({
    label: String(choice?.label || '').trim().slice(0, 80),
    colour: String(choice?.colour || '').trim()
  })).filter(choice => choice.label && HEX_COLOUR.test(choice.colour)) : [];
  if (choices.length < 1) return null;
  return { id, title, description, colour, choices };
}

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
          eventId: egg.id,
          category: 'easter-egg',
          title: egg.title,
          status: choice.verdict,
          choice: choice.label,
          outcome: choice.outcome,
          reward: boon,
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

/** A Manager-authored test. Its response is recorded by messages.js just like phishing. */
export function playCustomTest(test, onResult = null) {
  const safe = normalizeCustomTest(test);
  if (!safe) return Promise.resolve();
  return new Promise(resolve => {
    const overlay = el('div', 'custom-test');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', safe.title);
    const box = el('section', 'custom-test-box');
    box.style.setProperty('--test-colour', safe.colour);
    box.append(el('p', 'custom-test-kicker', 'Triangle Agency · Response requested'), el('h2', '', safe.title), el('p', 'custom-test-description', safe.description));
    const finish = () => {
      box.append(el('p', 'custom-test-confirm', 'Response recorded.'));
      setTimeout(() => { overlay.remove(); resolve(); }, 850);
    };

    if (safe.mode === 'open') {
      // The agent writes their own answer.
      const form = el('form', 'custom-test-open');
      const answer = el('textarea', 'custom-test-answer');
      answer.rows = 4;
      answer.maxLength = OPEN_ANSWER_MAX;
      answer.placeholder = 'Your answer…';
      answer.setAttribute('aria-label', 'Your answer');
      const count = el('span', 'custom-test-count', `0 / ${OPEN_ANSWER_MAX}`);
      const submit = el('button', 'custom-test-choice', 'Send answer');
      submit.type = 'submit';
      submit.disabled = true;
      submit.style.setProperty('--choice-colour', safe.colour);
      const footer = el('div', 'custom-test-open-footer');
      footer.append(count, submit);
      form.append(answer, footer);
      answer.addEventListener('input', () => {
        count.textContent = `${answer.value.length} / ${OPEN_ANSWER_MAX}`;
        submit.disabled = !answer.value.trim();
      });
      // Ctrl/Cmd+Enter sends; Enter alone is a new line.
      answer.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) form.requestSubmit();
      });
      form.addEventListener('submit', event => {
        event.preventDefault();
        const text = answer.value.trim().slice(0, OPEN_ANSWER_MAX);
        if (!text || answer.readOnly) return;
        answer.readOnly = true;
        submit.disabled = true;
        try {
          onResult?.({ eventId: safe.id, category: 'custom-test', title: safe.title, status: 'answered', choice: '', outcome: `Answer: ${text}`, time: Math.floor(Date.now() / 1000) });
        } catch { /* messages.js retains and retries result delivery independently. */ }
        publish(`Custom test · ${safe.title}`, `${who()} answered:\n“${text}”`, ['memo']);
        finish();
      });
      box.append(form);
      overlay.append(box);
      document.body.append(overlay);
      playButton('session', 'badgeRead');
      requestAnimationFrame(() => answer.focus());
      return;
    }

    const choices = el('div', 'custom-test-choices');
    safe.choices.forEach(choice => {
      const button = el('button', 'custom-test-choice', choice.label);
      button.type = 'button';
      button.style.setProperty('--choice-colour', choice.colour);
      button.addEventListener('click', () => {
        choices.querySelectorAll('button').forEach(item => { item.disabled = true; });
        try {
          onResult?.({ eventId: safe.id, category: 'custom-test', title: safe.title, status: 'answered', choice: choice.label, outcome: `Selected: ${choice.label}`, time: Math.floor(Date.now() / 1000) });
        } catch { /* messages.js retains and retries result delivery independently. */ }
        publish(`Custom test · ${safe.title}`, `${who()} selected “${choice.label}”.`, ['ballot_box_with_check']);
        finish();
      }, { once: true });
      choices.append(button);
    });
    box.append(choices);
    overlay.append(box);
    document.body.append(overlay);
    playButton('session', 'badgeRead');
  });
}
