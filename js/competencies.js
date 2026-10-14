// competencies.js
// Prime Directive and Encouraged Behaviors for each Competency, from the
// Triangle Agency (Italian edition) competency pages. Choosing a Competency on an
// agent card fills the back of the card with this text.

export const COMPETENCY_INFO = {
  'PR': {
    department: 'Pubbliche Relazioni',
    prime: { title: 'Agisci sempre allo scoperto.', trigger: 'menti apertamente.' },
    encouraged: ['Crei un diversivo.', 'Trovi un’ottima scusa.', 'Ti assicuri che non si farà più parola di qualcosa.']
  },
  'R&D': {
    department: 'Ricerca & Sviluppo',
    prime: { title: 'Non smette di innovare.', trigger: 'ripeti un’azione.' },
    encouraged: ['Scopri di cosa ha davvero bisogno qualcuno.', 'Reinventi la ruota.', 'Cambi una vita per sempre.']
  },
  'Caffetteria': {
    department: 'Caffetteria',
    prime: { title: 'Non guastare l’atmosfera.', trigger: 'chiami qualcuno per nome.' },
    encouraged: ['Fai sentire a casa qualcuno.', 'Metti in mostra le tue specialità.', 'Fai ribollire il sangue di qualcuno.']
  },
  'CDA': {
    department: 'Consiglio di Amministrazione',
    prime: { title: 'Fai valere la gerarchia.', trigger: 'ti lasci dare ordini da qualcuno.' },
    encouraged: ['Imponi la tua volontà su qualcuno.', 'Ti godi i lussi della vita.', 'Fai un sacrificio necessario.']
  },
  'Stagisti': {
    department: 'Stagisti',
    prime: { title: 'Ogni richiesta è importante.', trigger: 'rifiuti di fare come richiesto.' },
    encouraged: ['Fallisci con assoluta sicumera.', 'Ti metti in imbarazzo e gli altri ne approfittano.', 'Metti a tacere la coscienza.']
  },
  'Smaltimento': {
    department: 'Smaltimento',
    prime: { title: 'Non sporcare le mani altrui.', trigger: 'tocchi qualcuno ancora vivo senza ferirlo.' },
    encouraged: ['Scavi a fondo.', 'Ripulisci un pasticcio.', 'Metti una pietra su un problema.']
  },
  'Reception': {
    department: 'Reception',
    prime: {
      title: 'Resta sempre vigile.',
      trigger: 'ti siedi a riposare oppure lasci perdere una questione senza indagare a fondo (scegline una).'
    },
    encouraged: ['Interroghi qualcuno.', 'Requisisci qualcosa.', 'Chiudi una porta per sempre.']
  },
  'Centralino': {
    department: 'Centralino',
    prime: { title: 'Mai dire “siamo spiacenti”.', trigger: 'dai cattive notizie a qualcuno.' },
    encouraged: ['Aiuti qualcuno a togliersi un peso.', 'Ti prendi la colpa quando sei innocente.', 'Porti qualcuno a una conclusione inaspettata.']
  },
  'Clown': {
    department: 'Clown',
    prime: { title: 'Facci ridere.', trigger: 'parli di sentimenti.' },
    encouraged: ['Dai spettacolo.', 'Metti sotto gli occhi di tutti una verità imbarazzante.', 'Fai sputare un sorriso a qualcuno.']
  }
};

/** Text for the back of an agent card, or '' for an unknown competency. */
export function competencyText(name, kind) {
  const info = COMPETENCY_INFO[name];
  if (!info) return '';
  if (kind === 'primeDirective') {
    return `${info.prime.title}\n+1 Demerito ogni volta che ${info.prime.trigger}`;
  }
  return `+1 Merito ogni volta che:\n${info.encouraged.map(line => `• ${line}`).join('\n')}`;
}

/** True when the text is empty or exactly some competency's generated text (safe to replace). */
export function isGeneratedText(text, kind) {
  const value = String(text || '').trim();
  return !value || Object.keys(COMPETENCY_INFO).some(name => competencyText(name, kind) === value);
}
