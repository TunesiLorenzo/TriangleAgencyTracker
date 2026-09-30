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

// Acquisizioni you can buy with Note di Merito after the first Incarico; offered as suggestions
// when naming an item, and a match fills in the description.
export const ACQUISITIONS = [
  {
    name: 'Tazza Ufficiale di Triangle Agency',
    icon: '☕',
    description: 'Una stilosa tazza di ceramica, capace di contenere qualsiasi liquido in un intervallo di temperature ragionevole.'
  },
  {
    name: 'Graffetta a Compressione',
    icon: '📎',
    description: 'Una graffetta di metallo alta 2,5 centimetri che conserva una quantità infinita di documenti o file digitali in maniera discreta: basta unire i fogli al fascicolo, o infilarne l’estremità in una porta per il trasferimento dati per usarla come memoria esterna. La pila di documenti non sembrerà mai più spessa di 5 fogli. Ogni dato conservato è di proprietà dell’Agenzia.'
  },
  {
    name: 'Armadietto da Taschino',
    icon: '🗄️',
    description: 'Per riporre un oggetto basta nasconderlo dietro la schiena; per recuperarlo, allungare la mano dietro la schiena. Funziona in qualsiasi momento e da qualsiasi luogo. Il tempo all’interno scorre normalmente. Il piccolo ha le dimensioni di uno zaino, il grande è paragonabile a un garage.'
  },
  {
    name: 'Programma Buoni Pasto Triangle Agency',
    icon: '🍽️',
    description: 'Una carta aziendale per mangiare in qualsiasi ristorante, ordinando dalla lista dei cibi convenzionati: Samosa; Crêpe (piegate, non arrotolate); Onigiri; Toast (tagliati a triangolo); Pizza o torta (a fette); Hamantasch; Arancini siciliani (conici); Toblerone. Altre pietanze richiedono l’approvazione del General Manager.'
  },
  {
    name: 'Car Service TreRuote',
    icon: '🚗',
    description: 'Noleggio di un veicolo personale a scelta, con posti a sedere e optional adeguati a trasportare l’intera Squadra Operativa. Tutti i danni riportati al momento della restituzione saranno puniti con Note di Demerito.'
  },
  {
    name: 'Accordo di Non-Riservatezza',
    icon: '📝',
    description: 'Autorizza l’Agenzia a trascrivere i pensieri degli Agenti e a impiantarli nelle menti dei colleghi, per conversare a distanza in maniera non verbale. Tutti i partecipanti devono acquistare l’Accordo e accettare ogni singola comunicazione telepatica.'
  },
  {
    name: 'Giacca Sportiva Ufficiale di Triangle Agency',
    icon: '🧥',
    description: 'Una giacca leggera e traspirante. Sul dorso si può far serigrafare il proprio nome o alias; il lato anteriore destro è riservato alle toppe ricamate assegnate con ogni promozione.'
  },
  {
    name: 'Buono Regalo Triangle Home',
    icon: '💳',
    description: 'Una tessera da usare al Quartier Generale o in qualsiasi centro commerciale durante un Incarico, per acquistare prodotti per la casa, mobili, oggettistica, forniture per ufficio e qualsiasi altro prodotto quotidiano utile alle indagini. Vietata la rivendita.'
  },
  {
    name: 'Elicottero Classe Arconte LMZ Skybreaker',
    icon: '🚁',
    description: 'Sedili in pelle per 9 passeggeri, range medio superiore a 300 miglia nautiche, velocità di crociera di 140 nodi, pilota automatico senziente e 3 porta bicchieri refrigeranti. Brevetto da pilota non incluso. Richiede liberatoria firmata.'
  }
];

// Icons an item can be given; an item left on the default shows its catalog icon, or the box.
export const DEFAULT_ICON = '📦';
export const ITEM_ICONS = ['💼', '🔫', '☕', '📎', '🗄️', '🍽️', '🚗', '📝', '🧥', '💳', '🚁', '📦', '🔑', '📱', '🔦', '🧪', '📷', '🎫', '🧯', '📻', '🕶️', '🧸'];

// The promotional banner at the bottom of the Agency tab. Put the pictures in images/promo/
// under these names (any size; posters can be portrait): a slide whose picture is missing
// shows its icon on the Agency's own poster art instead.
export const PROMO_DIR = './images/promo/';
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
