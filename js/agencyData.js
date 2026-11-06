// Italian text from Materiale/InventoryBase.pdf and Materiale/Inventory.pdf.

// "Tutte le Squadre Operative sono fornite di 2 utili Acquisizioni": every new branch starts with these.
export const STANDARD_KIT = [
  {
    name: 'La Normale Valigetta',
    icon: '💼',
    description: 'Questa valigetta dall’aspetto del tutto anonimo è in grado di catturare e contenere un’Anomalia per permetterne il trasporto sicuro. Per funzionare, l’Anomalia deve essere esausta, ammansita o consenziente: di solito significa averne identificato e placato il Fulcro, il pensiero o il sentimento che l’ha generata.'
  },
  {
    name: 'La Pistola a Onde',
    icon: '🔫',
    description: 'L’unico dispositivo conosciuto capace di disturbare una Risonanza Anomala. Se l’Anomalia è in vista e vulnerabile, un singolo colpo la neutralizza in via permanente. Ha una sola carica e può essere ricaricata solo dall’Agenzia. Sprecare il colpo per qualsiasi scopo diverso dalla neutralizzazione dell’obiettivo dell’Incarico vale 3 Note di Demerito. Ha una sicura, ma può disgregare anche i Corpi Risonanti: attenzione alla linea di tiro!'
  }
];

// Acquisizioni you can buy with Note di Merito after the first Incarico (Inventory.pdf pages
// 127-129); offered as suggestions when naming an item, and a match fills in the description.
// `options`: each way to get it (rented for 1 Incarico, bought, a size) and its cost in Note di
// Merito, which the purchase requests of the published copy show and check (agency.js).
export const ACQUISITIONS = [
  {
    name: 'Tazza Ufficiale di Triangle Agency',
    icon: '☕',
    description: 'Una stilosa tazza di ceramica, capace di contenere qualsiasi liquido in un intervallo di temperature ragionevole.',
    options: [{ label: '350 ml', cost: 3 }, { label: '500 ml', cost: 18 }]
  },
  {
    name: 'Graffetta a Compressione',
    icon: '📎',
    description: 'Una graffetta di metallo alta 2,5 centimetri che conserva una quantità infinita di documenti o file digitali in maniera discreta: basta unire i fogli al fascicolo, o infilarne l’estremità in una porta per il trasferimento dati per usarla come memoria esterna. La pila di documenti non sembrerà mai più spessa di 5 fogli. Ogni dato conservato è di proprietà dell’Agenzia.',
    options: [{ label: 'Noleggio per 1 Incarico', cost: 1 }, { label: 'Acquisto', cost: 15 }]
  },
  {
    name: 'Armadietto da Taschino',
    icon: '🗄️',
    description: 'Per riporre un oggetto basta nasconderlo dietro la schiena; per recuperarlo, allungare la mano dietro la schiena. Funziona in qualsiasi momento e da qualsiasi luogo. Il tempo all’interno scorre normalmente. Il piccolo ha le dimensioni di uno zaino, il grande è paragonabile a un garage.',
    options: [{ label: 'Noleggio per 1 Incarico, piccolo', cost: 1 }, { label: 'Noleggio per 1 Incarico, grande', cost: 3 }, { label: 'Acquisto, piccolo', cost: 11 }, { label: 'Acquisto, grande', cost: 33 }]
  },
  {
    name: 'Programma Buoni Pasto Triangle Agency',
    icon: '🍽️',
    description: 'Una carta aziendale per mangiare in qualsiasi ristorante, ordinando dalla lista dei cibi convenzionati: Samosa; Crêpe (piegate, non arrotolate); Onigiri; Toast (tagliati a triangolo); Pizza o torta (a fette); Hamantasch; Arancini siciliani (conici); Toblerone. Altre pietanze richiedono l’approvazione del General Manager.',
    options: [{ label: 'Per 1 Incarico', cost: 1 }, { label: 'Illimitato', cost: 15 }]
  },
  {
    name: 'Car Service TreRuote',
    icon: '🚗',
    description: 'Noleggio di un veicolo personale a scelta, con posti a sedere e optional adeguati a trasportare l’intera Squadra Operativa. Tutti i danni riportati al momento della restituzione saranno puniti con Note di Demerito.',
    options: [{ label: 'Per 1 Incarico', cost: 1 }, { label: 'Illimitato', cost: 15 }]
  },
  {
    name: 'Accordo di Non-Riservatezza',
    icon: '📝',
    description: 'Autorizza l’Agenzia a trascrivere i pensieri degli Agenti e a impiantarli nelle menti dei colleghi, per conversare a distanza in maniera non verbale. Tutti i partecipanti devono acquistare l’Accordo e accettare ogni singola comunicazione telepatica.',
    options: [{ label: 'Per 1 Incarico', cost: 1 }, { label: 'Illimitato', cost: 15 }]
  },
  {
    name: 'Giacca Sportiva Ufficiale di Triangle Agency',
    icon: '🧥',
    description: 'Una giacca leggera e traspirante. Sul dorso si può far serigrafare il proprio nome o alias; il lato anteriore destro è riservato alle toppe ricamate assegnate con ogni promozione.',
    options: [{ label: 'Tutte le taglie', cost: 15 }]
  },
  {
    name: 'Buono Regalo Triangle Home',
    icon: '💳',
    description: 'Una tessera da usare al Quartier Generale o in qualsiasi centro commerciale durante un Incarico, per acquistare prodotti per la casa, mobili, oggettistica, forniture per ufficio e qualsiasi altro prodotto quotidiano utile alle indagini. Vietata la rivendita.',
    options: [{ label: 'Da 1000$', cost: 1 }, { label: 'Da 3000000$', cost: 66 }]
  },
  {
    name: 'Elicottero Classe Arconte LMZ Skybreaker',
    icon: '🚁',
    description: 'Sedili in pelle per 9 passeggeri, range medio superiore a 300 miglia nautiche, velocità di crociera di 140 nodi, pilota automatico senziente e 3 porta bicchieri refrigeranti. Brevetto da pilota non incluso. Richiede liberatoria firmata.',
    options: [{ label: 'Modello Base', cost: 333 }, { label: 'Modello Ignifugo', cost: 999 }]
  },
  {
    name: 'Donazione di Beneficenza',
    icon: '🎁',
    description: 'Un orfanotrofio scelto casualmente riceve fondi per un anno.',
    options: [{ label: 'Grazie per il tuo sostegno!', cost: 9 }]
  },
  {
    name: 'Richiesta di Trasferimento',
    icon: '🔄',
    description: 'Ti senti fuori posto nel tuo dipartimento? Richiedi un trasferimento a un altro dipartimento di Competenza non rappresentato nella tua Squadra Operativa. L’Autovalutazione non può essere ripetuta, e dal prossimo Incarico non avrai più accesso alla Dotazione del tuo dipartimento precedente.',
    options: [{ label: 'Prima Richiesta', cost: 15 }, { label: 'Richieste successive', cost: 30 }]
  },
  {
    name: 'Richiesta di Revisione Storica',
    icon: '🕰️',
    description: 'Il programma 3% Flashback dell’Agenzia sovrascrive uno specifico momento non Anomalo del tuo passato: rimangiati quella confessione maldestra e dimentica l’amarezza del rifiuto. Non è possibile sovrascrivere le interazioni passate con esseri Anomali, inclusa la tua Anomalia personale.',
    options: [{ label: 'Tutte le Richieste', cost: 99 }]
  },
  // Onde (Triangle-Agency.pdf page 211, Playwall D4 "Impiegato Senior"): elementary Acquisizioni
  // made from Waves, on sale to an agent once they reach Impiegato Senior.
  {
    name: 'iPond',
    icon: '🎧',
    description: 'Un’Onda che somiglia a un pesce rosso in un sacchetto d’acqua, come un disco vergine pronto a essere inciso. In cambio di un Controllo Qualità di Discrezione o Empatia crea una registrazione multisensoriale completa, lunga al massimo 5 minuti, dei ricordi recenti di qualcuno che sta toccando il sacchetto; l’aspetto dell’Onda cambia per rifletterla. Chiunque indossi le cuffie collegate all’Onda può rivivere il ricordo. Ogni registrazione rimpiazza la precedente.',
    options: [{ label: 'Onda · Impiegato Senior', cost: 9 }]
  },
  {
    name: 'Aggrappole',
    icon: '👟',
    description: 'In cambio di un Controllo Qualità di Grinta o Reattività, questo paio di scarpe appiccicose riorienta la tua gravità personale verso la superficie piatta e stabile più vicina, che puoi trattare come il “suolo” e percorrere con aderenza perfetta: una passeggiata sul soffitto, la discesa di una parete, un passaggio su un veicolo in corsa. Quando non sono attive si mettono sotto le scarpe. Disponibili anche coperte per sedie a rotelle e altri dispositivi di mobilità personale.',
    options: [{ label: 'Onda · Impiegato Senior', cost: 15 }]
  },
  {
    name: 'Bambole parlanti Piccole Ribelli',
    icon: '🪆',
    description: 'Una linea di bambole per bambine, personalizzabili nell’aspetto e negli accessori. In cambio di un Controllo Qualità di qualsiasi tipo la bambola si attiva e risponde a chi le parla con un atteggiamento influenzato dalla Qualità scelta. In cambio di un secondo Controllo Qualità in Professionalità adotta la voce, i modi di fare e i ricordi dell’Agente che l’ha attivata. L’effetto dura fino a 8 ore.',
    options: [{ label: 'Onda · Impiegato Senior', cost: 9 }]
  },
  {
    name: 'Buttaindietro',
    icon: '🦸',
    description: 'Un’action figure insolitamente morbida che si limita a rimbalzare quando viene colpita. In cambio di un Controllo Qualità di Carisma o Perseveranza, posizionala all’ingresso di una stanza per designare lo spazio alle sue spalle come Off Limits: cresce fino a diventare un energumeno in giacca nera e occhiali da sole che blocca il passaggio. È inamovibile, non risponde a nessun tentativo di conversazione e rimanda indietro alla stessa velocità qualsiasi proiettile la colpisca. L’effetto dura fino a 1 ora, ma può essere interrotto in qualsiasi momento.',
    options: [{ label: 'Onda · Impiegato Senior', cost: 6 }]
  },
  {
    name: 'LanternaVisore',
    icon: '🔦',
    description: 'Una creatura simile a un pesce lanterna, con un piccolo proiettore appeso a un tentacolo sulla fronte. In cambio di un Controllo Qualità di Ambiguità o Attenzione proietta fino a 9 immagini ad alta definizione su qualsiasi superficie e a qualsiasi distanza, purché non ci siano ostacoli: ricordi specifici dell’Agente, istruzioni generiche (“qualcosa di orribile”) oppure, in automatico, le prossime 9 frasi pronunciate ad alta voce, come in una presentazione.',
    options: [{ label: 'Onda · Impiegato Senior', cost: 6 }]
  }
];

// Icons an item can be given; an item left on the default shows its catalog icon, or the box.
export const DEFAULT_ICON = '📦';
export const ITEM_ICONS = ['💼', '🔫', '☕', '📎', '🗄️', '🍽️', '🚗', '📝', '🧥', '💳', '🚁', '📦', '🔑', '📱', '🔦', '🧪', '📷', '🎫', '🧯', '📻', '🕶️', '🧸', '🎁', '🔄', '🕰️',
  '☂️', '🎒', '🧳', '🧰', '🔧', '🛡️', '📡', '💊', '📚', '🗝️', '⌚', '💍', '🧤', '🪪', '🎟️', '🔮', '🎧', '👟', '🪆', '🦸'];

// The promotional banner at the top of the Agency tab. Put the pictures in images/promo/
// under these names (any size; posters can be portrait): a slide whose picture is missing
// shows its icon on the Agency's own poster art instead.
export const PROMO_DIR = './images/promo/';
// false: the slides play in the order listed below; true: in a new random order each load.
export const PROMO_SHUFFLE = false;
export const PROMO_SLIDES = [
  { kind: 'Acquisizione del mese', title: 'Tazza Ufficiale di Triangle Agency', tagline: 'Il caffè è Realtà. La tazza è Agenzia.', price: 'da 3 Note di Merito', icon: '☕', image: 'tazza.jpg' },
  { kind: 'Poster motivazionale', title: 'Eccellenza', tagline: 'Un’Anomalia catturata vale più di mille rapporti.', icon: '▲', image: 'poster-eccellenza.jpg', poster: true },
  { kind: 'Novità in catalogo', title: 'Graffetta a Compressione', tagline: 'Infiniti documenti. Cinque fogli di spessore. Nessuna domanda.', price: 'da 1 Nota di Merito', icon: '📎', image: 'graffetta.jpg' },
  { kind: 'Poster motivazionale', title: 'Puntualità', tagline: 'Il Tempo è una risorsa aziendale. Non sprecarlo.', icon: '⏱️', image: 'poster-puntualita.jpg', poster: true },
  { kind: 'Abbigliamento aziendale', title: 'Giacca Sportiva Ufficiale', tagline: 'Ogni promozione merita una toppa.', price: '15 Note di Merito', icon: '🧥', image: 'giacca.jpg' },
  { kind: 'Poster motivazionale', title: 'Lavoro di squadra', tagline: 'Nessun Agente è un’isola. Tranne quando lo richiede il Caos.', icon: '🤝', image: 'poster-squadra.jpg', poster: true },
  { kind: 'Offerta esclusiva', title: 'Armadietto da Taschino', tagline: 'Dietro la schiena c’è posto per tutto.', price: 'da 1 Nota di Merito', icon: '🗄️', image: 'armadietto.jpg' },
  { kind: 'Poster motivazionale', title: 'Discrezione', tagline: 'Ciò che i Testimoni non vedono, l’Agenzia non deve cancellarlo.', icon: '👁️', image: 'poster-discrezione.jpg', poster: true },
  { kind: 'Il sogno di ogni Quadro', title: 'Elicottero LMZ Skybreaker', tagline: 'Lascia i problemi terricoli a terra.', price: '333 Note di Merito', icon: '🚁', image: 'skybreaker.jpg' }
];
