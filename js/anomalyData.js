// Italian text from Materiale/Anomalia_lista.pdf; source PDF pages are 1-based.
export const ANOMALY_ABILITIES = {
  "Sussurro": [
    {
      "name": "Come, prego?",
      "effects": "In risposta a qualsiasi frase, puoi chiedere «Come, prego?» e spiegare cosa ha detto in realtà il tuo bersaglio. Tira con Carisma.\n\nIn caso di Successo, il tuo interlocutore si rimangia quanto detto e lo riformula proprio come vuoi tu.\n\nCon sei o più 3, potrai parlare al posto suo tutte le volte che vorrai per la prossima ora.\n\nIn caso di Fallimento, le tue parole finiscono per imprimersi nella tua stessa mente. Per le prossime 3 ore puoi esprimerti solo con combinazioni diverse delle parole che formano la frase.",
      "question": "Quando qualcuno osa interrompermi, gli riservo...",
      "answers": [
        {
          "text": "Il beneficio del dubbio.",
          "reference": "T2"
        },
        {
          "text": "Una lunga strigliata.",
          "reference": "P4"
        }
      ],
      "page": 2
    },
    {
      "name": "Sulla punta della lingua",
      "effects": "Apri la mente ai pensieri di qualcuno nei paraggi. Ti saliranno alle labbra ed entrambi saprete che li conosci. Tira con Empatia.\n\nIn caso di Successo, scopri a cosa pensa il bersaglio in questo momento pronunciandolo ad alta voce.\n\nPer ogni tre 3, puoi porre una domanda su un argomento a cui il bersaglio ha pensato di recente. Il GM ti risponderà, ma sarai tu a pronunciare domanda e risposta ad alta voce.\n\nIn caso di Fallimento, invece di scoprire i pensieri altrui metti a nudo i tuoi. Ammetti qualcosa che non vorresti far sapere a nessuno.",
      "question": "Quando ho bisogno di farmi accettare in un gruppo...",
      "answers": [
        {
          "text": "Mi butto e fingo di farne parte.",
          "reference": "A11"
        },
        {
          "text": "Passo le ore a osservarne il comportamento e mi infiltro a poco a poco.",
          "reference": "B9"
        }
      ],
      "page": 2
    },
    {
      "name": "Rumore bianco",
      "effects": "Apri la bocca ed emetti un suono a frequenza variabile per cancellare ogni altro rumore. Tira con Discrezione.\n\nIn caso di Successo, nessuna delle tue azioni emetterà alcun suono, fino al tuo prossimo tiro o finché non chiuderai la bocca.\n\nPer ogni 3 dopo il primo, puoi applicare l’effetto alle azioni di un altro bersaglio oltre a te.\n\nIn caso di Fallimento, sbagli frequenza e finisci per amplificare tutti i suoni emessi da te per la prossima ora.",
      "question": "Quando taccio...",
      "answers": [
        {
          "text": "È per far parlare gli altri.",
          "reference": "S10"
        },
        {
          "text": "È per dare risalto a quello che sto per dire.",
          "reference": "S8"
        }
      ],
      "page": 2
    }
  ],
  "Catalogo": [
    {
      "name": "Cosa c'è lì?",
      "effects": "Chiedi ad alta voce «Che cosa c’è lì?» e indica un punto vicino. Tira con Attenzione.\n\nIn caso di Successo, descrivi l’oggetto che si trova lì. Può trattarsi di qualsiasi oggetto comune che sia ragionevole trovare in quel punto, ma non può fornirti dettagli o informazioni che non conoscevi già. Per ogni 3 dopo il primo, puoi descrivere un oggetto in più nelle vicinanze del primo.\n\nIn caso di Fallimento, il GM descrive l’oggetto che si trova lì. È qualcosa d'intralcio per gli Agenti o del tutto incongruo al contesto.",
      "question": "I miei amici non mi ferirebbero mai, perché...",
      "answers": [
        {
          "text": "Non conoscono i miei punti deboli.",
          "reference": "Y1"
        },
        {
          "text": "Li pago troppo bene.",
          "reference": "I5"
        }
      ],
      "page": 4
    },
    {
      "name": "Potrebbe piacerti anche...",
      "effects": "Afferra un oggetto che puoi tenere in mano. Tira con Grinta.\n\nIn caso di Successo, lo sostituisci con una sua copia simile, ma con una singola variazione. (Una giacca verde diventa blu, un orso di peluche diventa una tigre di peluche, la chiave della stanza 203 apre la stanza 204...).\n\nPer ogni tre 3, puoi collegare una versione alternativa all’oggetto originale per scambiarli ogni volta che tieni in mano uno dei due (per esempio, un bastone da passeggio diventa una spada di ferro quando vuoi). Il legame è eterno.\n\nIn caso di Fallimento, l’oggetto è rimpiazzato da un altro del tutto diverso. Non puoi più recuperare l'originale con questa Abilità.",
      "question": "Il cliente ha sempre...",
      "answers": [
        {
          "text": "Torto.",
          "reference": "L2"
        },
        {
          "text": "Ragione.",
          "reference": "J1"
        }
      ],
      "page": 4
    },
    {
      "name": "Il meglio di me",
      "effects": "Apri un contenitore grande abbastanza da entrarci per intero. Tira con Ambiguità.\n\nIn caso di Successo, ci trovi dentro una versione alternativa di te stesso. Ha una capacità particolare utile alla tua situazione (intagliare, imitare, impastare...). Ritornerà alla propria realtà entro un’ora.\n\nCon sei o più 3, trovi ben due versioni di te utili alla tua situazione!\n\nIn caso di Fallimento, trovi una tua versione malvagia (almeno dal tuo punto di vista). Cercherà di intralciarti finché non te ne sarai sbarazzato e tornerà volontariamente alla propria realtà solo quando sarà soddisfatta dei cambiamenti apportati alla tua.",
      "question": "Il nemico del mio nemico...",
      "answers": [
        {
          "text": "È mio amico.",
          "reference": "Y5"
        },
        {
          "text": "Sono io.",
          "reference": "P5"
        }
      ],
      "page": 4
    }
  ],
  "Sanguisuga": [
    {
      "name": "Ne vuoi ancora?",
      "effects": "Per te, il desiderio altrui è un calice. Rabboccalo chiedendo «Ne vuoi ancora?» e tira con Empatia.\n\nIn caso di Successo, la tua vittima brama ancora l’ultima cosa che le ha dato piacere (per esempio attenzione, affetto, gelato, riposo...). Identificatela insieme. Non ne è dipendente e non è costretta a cercarla subito, ma sarà una leva o una distrazione di efficacia sproporzionata al suo valore.\n\nPer ogni 3 dopo il primo, una vittima in più nelle vicinanze sarà contagiata dallo stesso desiderio.\n\nIn caso di Fallimento, la vittima sviluppa un’avversione per l’ultima cosa che le ha dato piacere. La tua domanda suona come un insulto e d’ora in poi troverà rivoltante il solo pensiero.",
      "question": "Il diavolo fa le pentole...",
      "answers": [
        {
          "text": "Ma chi cucina ancora a casa?",
          "reference": "Y4"
        },
        {
          "text": "Ma l'assaggiatore sono io.",
          "reference": "C1"
        }
      ],
      "page": 6
    },
    {
      "name": "Prestito forzato",
      "effects": "Prendi per te una parte qualunque di una persona normale: la faccia, la voce, l'amore, le impronte digitali... Adesso è tua e lei ne è priva. Tira con Ambiguità.\n\nIn caso di Successo, il prestito dura per un'ora.\n\nPer ogni 3 dopo il primo, scegli un'aggiunta:\n\nAlla vittima resta una versione difettosa di quello che hai preso in prestito Anche un alleato prende quella cosa in prestito Il prestito dura un’ora in più\n\nIn caso di Fallimento, la vittima perde per sempre quella parte di sé e nessuno potrà averla mai più. Nemmeno tu. Ricorderà quello che ha perso.",
      "question": "Il pubblico mi adora perché...",
      "answers": [
        {
          "text": "Se non lo fa, troverò un pubblico migliore.",
          "reference": "R9"
        },
        {
          "text": "Mi sforzo di non avere difetti.",
          "reference": "S15"
        }
      ],
      "page": 6
    },
    {
      "name": "Donatore universale",
      "effects": "Quando vieni ferito o subisci Danni, puoi tirare con Perseveranza.\n\nIn caso di Successo, scegli una creatura normale o Anomala nei paraggi, diversa da quella che ti ha ferito. Sarà lei a soffrire al posto tuo.\n\nPer ogni 3 dopo il primo, puoi indicare una vittima in più. Riceverà gli stessi Danni della prima.\n\nIn caso di Fallimento, il dolore condiviso ti si ritorce contro e subisci il triplo dei Danni. Se sono più del necessario a causare la tua morte, quelli avanzati si scaricano su vittime nei paraggi, a partire dagli altri Agenti, fino a esaurirsi del tutto.",
      "question": "Quando qualcuno mi ferisce...",
      "answers": [
        {
          "text": "Vuol dire che è il momento d'imparare una lezione.",
          "reference": "S19"
        },
        {
          "text": "Non capisco come sia possibile. Chi mai vorrebbe farlo?",
          "reference": "B11"
        }
      ],
      "page": 6
    }
  ],
  "Segnatempo": [
    {
      "name": "Abbiamo tutto il tempo",
      "effects": "Quando c'è da finire un compito urgente (consegnare un progetto, tendere una trappola), controlla l’ora e di’ «Abbiamo tutto il tempo». Tira con Professionalità.\n\nIn caso di Successo, hai ragione. A patto che tu e la Squadra vi concentriate davvero sul compito, lo porterete a termine un istante prima della scadenza. Niente distrazioni!\n\nPer ogni 3 dopo il primo, resta un minuto in più dopo aver concluso il compito e prima che il tempo scada.\n\nIn caso di Fallimento, hai torto in maniera catastrofica e lo saprai solo quando sarà troppo tardi. La scadenza è già passata l’inseguitore vi coglie di sorpresa… Dov’è volato il tempo?",
      "question": "Conosco...",
      "answers": [
        {
          "text": "L'autore.",
          "reference": "W3"
        },
        {
          "text": "Il kung-fu.",
          "reference": "C10"
        }
      ],
      "page": 8
    },
    {
      "name": "Riavvolgere le lancette",
      "effects": "Dopo aver visto il risultato di un tiro per un’Abilità Anomala, tuo o di un alleato, riporta indietro l’orologio e tira con Reattività.\n\nIn caso di Successo, riavvolgi le lancette senza annullare gli effetti dell'Abilità, per poi far ripartire il tempo in modo che si ripeta una seconda volta. Il numero di 3 resta lo stesso, ma il bersaglio può cambiare. La ripetizione non genera Caos, né Triscendenza.\n\nPer ogni 3 dopo il primo, aggiungi un 3 al risultato del secondo uso (anche oltre il normale limite di sei).\n\nIn caso di Fallimento, il tiro originale diventa un Fallimento e anche la ripetizione fallisce. Il secondo Fallimento può colpire la stessa vittima o un'altra, a seconda di quale sia l’ipotesi peggiore, ma non genera Caos aggiuntivo.",
      "question": "Dormirò quando sarò...",
      "answers": [
        {
          "text": "Stanco.",
          "reference": "P13"
        },
        {
          "text": "Morto.",
          "reference": "O7"
        }
      ],
      "page": 8
    },
    {
      "name": "Momento Amarcord",
      "effects": "Canta un motivetto che riempie qualcuno di nostalgia per i bei tempi andati. Tira con Empatia.\n\nIn caso di Successo, il passato sembra remoto, anche se si parla di pochi minuti fa. La vittima sarà ansiosa di raccontarti quello che vuoi su quel momento perduto... Anche sulle parti top secret.\n\nPer ogni tre 3, puoi concentrarti su un ricordo e chiedere al GM di tratteggiare la scena come se avvenisse davanti a te, compresi i dettagli che il tempo avrebbe dovuto cancellare. Puoi riesumare persino ricordi cancellati o repressi con metodi Anomali.\n\nIn caso di Fallimento, la vittima si perde nei ricordi. Soverchiata dalle emozioni, non saprà dire niente di utile. Avrà bisogno di tempo e di cure per tornare al presente. La sua condizione genererà almeno un Testimone.",
      "question": "È più facile che io mi chieda...",
      "answers": [
        {
          "text": "Che fine ha fatto quel tipo?",
          "reference": "O6"
        },
        {
          "text": "Che fine farà quel tipo?",
          "reference": "F3"
        }
      ],
      "page": 8
    }
  ],
  "Escrescenza": [
    {
      "name": "Ti copro io!",
      "effects": "Quando un alleato vicino rischia di subire Danni, grida «Ti copro io!» e fletti i muscoli. Tira con Perseveranza.\n\nIn caso di Successo, la tua carne lo avvolge e assorbe l’impatto. Subisci ferite, Danni e morte al posto suo.\n\nPer ogni tre 3, produci uno strato di pelle protettiva in più che riduce i Danni ricevuti di 1. Se i nuovi strati resistono all’impatto immediato, ti resteranno addosso in maniera evidente finché altri Danni non li avranno distrutti.\n\nIn caso di Fallimento, sia tu, sia l’alleato subite i Danni. Il tuo corpo cresce senza controllo e resterà mutato finché non riuscirai a riposare per almeno un’ora. Fino a quel momento, il tuo aspetto rischierà di generare Testimoni.",
      "question": "Proteggo gli altri...",
      "answers": [
        {
          "text": "Per mettere in chiaro che sono più forte di loro.",
          "reference": "F5"
        },
        {
          "text": "Perché non sono in grado di difendersi da soli.",
          "reference": "L6"
        }
      ],
      "page": 10
    },
    {
      "name": "Serve una mano?",
      "effects": "Datti una mano o due. I nuovi arti sono simili a quelli che hai già. Tira con Grinta.\n\nIn caso di Successo, prendi il controllo della situazione. Tieni impegnato un avversario normale o un’Anomalia minore.\n\nPer ogni 3 dopo il primo, scegli una mossa:\n\nSottrai le armi a un avversario. Tieni impegnato un avversario in più. Metti fuori gioco un avversario già impegnato. Uccidi un avversario già fuori gioco.\n\nIn caso di Fallimento, diventi tutto braccia e gambe. Il resto di te viene inghiottito, lasciando solo un ammasso senziente degli arti che speravi di generare. Sei molto imbarazzato, oltre che indifeso e vulnerabile ai Danni per un’ora.",
      "question": "Se incontro un ostacolo...",
      "answers": [
        {
          "text": "Me lo mangio.",
          "reference": "S13"
        },
        {
          "text": "Lo supero con un balzo.",
          "reference": "G9"
        }
      ],
      "page": 10
    },
    {
      "name": "Un occhio di riguardo",
      "effects": "Apri tutti gli occhi che puoi. Tira con Attenzione.\n\nIn caso di Successo, il tuo corpo si ricopre di occhi dalle capacità più disparate.\n\nSpendi i 3 per acquisire nuovi tipi di visione per un'ora:\n\n1: Termica, telescopica o notturna 2: Rivelatore di impronte o raggi X 3: Vera vista (supera le illusioni) 4: Sensore di Anomalie 5: Traduttore lingua dei segni vegetale\n\n6: Individuazione punti deboli\n\n7: Visione profetica del futuro\n\nIn caso di Fallimento, hai una Visione della Fine. Carpisci un sapere proibito circa la fine dell’universo, troppo vasto per l’umana comprensione. Hai un Burnout aggiuntivo fino a fine Incarico.",
      "question": "A questa domanda rispondi solo tu. Ho avuto la Visione della Fine?",
      "answers": [
        {
          "text": "No. E mi piacciono le piante!",
          "reference": "G6"
        },
        {
          "text": "Sì.",
          "reference": "R7"
        }
      ],
      "page": 10
    }
  ],
  "Pistola": [
    {
      "name": "Eliminazione",
      "effects": "Fissa un oggetto o individuo non Anomalo e rimuovilo dall’equazione. Per sempre. Prima esisteva, ora non più. Tira con Grinta.\n\nIn caso di Successo, scompare senza lasciare traccia.\n\nCon sei o più 3, scegli tutti i bersagli in vista che vuoi. Scompaiono senza lasciare traccia.\n\nIn caso di Fallimento, l'hai ucciso. Un oggetto è distrutto, una creatura vivente muore. Il risultato è visibile a tutti, evidente e spesso traumatico.",
      "question": "A questa domanda rispondi solo tu. Ricorderò le mie vittime?",
      "answers": [
        {
          "text": "No.",
          "reference": "S6"
        },
        {
          "text": "Sì.",
          "reference": "T5"
        }
      ],
      "page": 12
    },
    {
      "name": "Estrazione rapida",
      "effects": "Quando qualcosa cerca di farti del male, punta la Pistola e tira con Reattività.\n\nIn caso di Successo, sei tu a sparare per primo. L’aggressore subisce 1 Danno prima di poterti ferire e il suo attacco fallisce.\n\nPer ogni 3 dopo il primo, puoi infliggere 1 Danno a un secondo bersaglio o procedere all’Eliminazione di un bersaglio che ha già subito Danno da Estrazione rapida. In caso di Fallimento, sbagli mira. Qualcuno o qualcosa di importante per te viene colpito dalla Pistola e l’aggressore ti ferisce come previsto.",
      "question": "Sparo sempre...",
      "answers": [
        {
          "text": "Dopo aver tolto la sicura.",
          "reference": "G4"
        },
        {
          "text": "A bruciapelo.",
          "reference": "A12"
        }
      ],
      "page": 12
    },
    {
      "name": "Mano armata",
      "effects": "L’aura della tua Pistola è talmente minacciosa che anche i normali esseri umani sono in grado di percepirla. Metti in chiaro come stanno le cose e tira con Carisma.\n\nIn caso di Successo, un bersaglio avrà abbastanza paura da fare quello che vuoi. Il GM sceglie una Conseguenza:\n\nRicorderà la tua faccia Cederà al panico\n\nContatterà le autorità Cercherà di vendicarsi\n\nPer ogni 3 dopo il primo, scegli se aggiungere un bersaglio o escludere una possibile conseguenza dalla lista. Per esempio, con sei 3 puoi intimidire 2 bersagli senza subire Conseguenze o fino a 6 bersagli accettando tutte le Conseguenze.\n\nIn caso di Fallimento, il bersaglio non ti teme. Diventa immune a tutte le Abilità della tua Pistola e avrà una reazione immediata e aggressiva.",
      "question": "I miei amici sono...",
      "answers": [
        {
          "text": "Ovunque, basta saperli cercare.",
          "reference": "D6"
        },
        {
          "text": "Nemici che non mi sono ancora fatto.",
          "reference": "W11"
        }
      ],
      "page": 12
    }
  ],
  "Sogno": [
    {
      "name": "Sogno e son desto",
      "effects": "Avvolgiti nelle tenebre come in una coperta e scegli una mente a cui mostrarti. Tira con Carisma.\n\nIn caso di Successo, scegli una forma illusoria terribile, sublime o del tutto normale. Il bersaglio ti vedrà così e crederà che sia il tuo vero aspetto.\n\nPer ogni tre 3, prima di scegliere quale forma assumere fai una domanda sul bersaglio e ricevi una risposta sincera:\n\nQual è la sua paura più terribile? Qual è sua ambizione più folle? Qual è il suo desiderio più recondito?\n\nIn caso di Fallimento, la tua vera forma è impressa a fuoco nella sua mente: di notte sarai nei suoi sogni, di giorno nei suoi pensieri. Ma forse per oggi non accadrà nulla.",
      "question": "Tendo a immaginarmi...",
      "answers": [
        {
          "text": "Lo scenario più roseo.",
          "reference": "D1"
        },
        {
          "text": "Il peggior risultato possibile.",
          "reference": "R13"
        }
      ],
      "page": 14
    },
    {
      "name": "È ora di dormire",
      "effects": "Soffia un po’ di sabbia magica negli occhi di qualcuno e tira con Discrezione.\n\nIn caso di Successo, il bersaglio cade subito addormentato. Farà un bel sogno e al suo risveglio dopo pochi minuti crederà di essersi solo appisolato.\n\nPer ogni 3 dopo il primo, scegli un'opzione:\n\nAddormenti un bersaglio in più Il sonnellino durerà per 1 ora in più\n\nIn caso di Fallimento, ad appisolarsi sarà qualcun altro: un alleato, o magari tu stesso. Le sabbie capricciose volteggiano in aria sotto gli occhi di tutti e il bersaglio originale le vedrà di sicuro.",
      "question": "I miei sogni preferiti...",
      "answers": [
        {
          "text": "Sono ossessioni ricorrenti.",
          "reference": "D8"
        },
        {
          "text": "Sono del tutto inaspettati.",
          "reference": "S1"
        }
      ],
      "page": 14
    },
    {
      "name": "Nel regno della fantasia",
      "effects": "Chi ha detto che le immagini non sono la realtà? Entra in una fotografia, un dipinto, un romanzo o un video e tira con Attenzione.\n\nIn caso di Successo, tu e gli alleati che porti con te visitate quel mondo. Potete manipolarne gli oggetti, conversare con i personaggi e vedere anche parti non rappresentate nell’opera originale.\n\nPer ogni tre 3, scegli un vantaggio:\n\nIl vostro aspetto muta per adattarsi all’opera\n\nIl vostro passaggio non lascia tracce permanenti\n\nIn caso di Fallimento, dimentichi di richiudere la soglia. Chiunque può seguirti a piacimento, dalla realtà verso l’opera (o le opere vicine) e viceversa.",
      "question": "Quando finisco una storia, vorrei tanto...",
      "answers": [
        {
          "text": "Passare più tempo con i personaggi.",
          "reference": "P8"
        },
        {
          "text": "Condividere la morale con chi ne ha bisogno.",
          "reference": "M4"
        }
      ],
      "page": 14
    }
  ],
  "Labirinto": [
    {
      "name": "Conosco una scorciatoia!",
      "effects": "Esclama «Conosco una scorciatoia!» e spiega da dove intendi passare per arrivare nel luogo desiderato il più in fretta possibile. Tira con Reattività.\n\nIn caso di Successo, le indicazioni portano a destinazione solo te, risultando troppo assurde per chiunque altro. La scorciatoia sparisce dopo l’uso.\n\nPer ogni 3 dopo il primo, una persona in più potrà usare la scorciatoia prima che sparisca.\n\nIn caso di Fallimento, la scorciatoia è permanente. Peccato che porti in un luogo molto scomodo invece della meta desiderata e che sia accessibile a chiunque in entrambe le direzioni.",
      "question": "Il mondo è...",
      "answers": [
        {
          "text": "Come lo vedo io.",
          "reference": "F9"
        },
        {
          "text": "Come voglio che sia.",
          "reference": "S16"
        }
      ],
      "page": 16
    },
    {
      "name": "Prosegui dritto...",
      "effects": "Dai indicazioni sbagliate, fuggi da un inseguitore o scopri dove intende arrivare qualcuno. Avvolgi lo spazio su se stesso e tira con Perseveranza.\n\nIn caso di Successo, la tua vittima è intrappolata in un dedalo o in un corridoio senza fine. Ne uscirà al tuo prossimo tiro.\n\nPer ogni 3 dopo il primo, puoi tenere in trappola una vittima in più o far durare la trappola per un tiro aggiuntivo.\n\nIn caso di Fallimento, hai aperto la strada alla tua vittima: arriverà subito a destinazione o riuscirà a raggiungerti in un istante.",
      "question": "Passo più tempo insieme alle persone...",
      "answers": [
        {
          "text": "Che voglio capire meglio.",
          "reference": "A5"
        },
        {
          "text": "Che mi somigliano già.",
          "reference": "M9"
        }
      ],
      "page": 16
    },
    {
      "name": "Gira che ti rigira",
      "effects": "Ritrova l’equilibrio. Tira con Professionalità.\n\nIn caso di Successo, l’asse di gravità ruota fino a 90 gradi nella direzione che preferisci. L’effetto è esteso per tutta la stanza o per 30 metri se sei all’aperto. Dura fino al tuo prossimo tiro.\n\nPer ogni 3 dopo il primo, scegli un'aggiunta:\n\nUn oggetto (tu, per esempio) resta ancorato al suolo Un oggetto subisce l’effetto a qualsiasi distanza La gravità di un oggetto ruota oltre i 90 gradi\n\nIn caso di Fallimento, perdi il contatto con la gravità. Per almeno 1 ora resterai sospeso in aria. Chiunque se ne accorga diventerà un Testimone.",
      "question": "Nei momenti di crisi, voglio...",
      "answers": [
        {
          "text": "Scappare.",
          "reference": "P6"
        },
        {
          "text": "Lottare.",
          "reference": "S18"
        }
      ],
      "page": 16
    }
  ],
  "Assenza": [
    {
      "name": "Mancato!",
      "effects": "Nessuno sa mai dove sei davvero. Quando qualcosa rischia di toccarti o ferirti, puoi esclamare «Mancato!». Tira con Discrezione.\n\nIn caso di Successo, sei sempre stato da un’altra parte nei paraggi, magari proprio alle spalle del tuo assalitore.\n\nPer ogni 3 dopo il primo, anche un’altra persona o cosa è sempre stata lì insieme a te. Sempre che sia d’accordo.\n\nIn caso di Fallimento, è il tuo assalitore a essere sempre stato altrove: pronto a ferire qualcun altro, a un’angolazione che farà più Danni o in un altro posto altrettanto scomodo per te.",
      "question": "Nei litigi, esco vincitore...",
      "answers": [
        {
          "text": "Trovando le falle nella logica altrui.",
          "reference": "I2"
        },
        {
          "text": "Per logoramento.",
          "reference": "M10"
        }
      ],
      "page": 18
    },
    {
      "name": "Spazio negativo",
      "effects": "Dai un’occhiata al posto dove una volta c’era qualcosa. Tira con Attenzione.\n\nIn caso di Successo, vedi la storia perduta del luogo che ispezioni. Se qualcuno ha portato via un biglietto, sai cosa diceva; se qualcosa è stato rubato, sai cosa e come.\n\nPer ogni tre 3, puoi dire una frase su quello che è andato perduto. È la pura verità.\n\nIn caso di Fallimento, la perdita è troppo grande. Vieni sopraffatto dalla storia del luogo, tanto da subire 1 Danno... Oltre a causare Testimoni con la tua reazione evidente e addolorata.",
      "question": "Per riempire il vuoto, tendo...",
      "answers": [
        {
          "text": "A fare conversazione.",
          "reference": "W5"
        },
        {
          "text": "A occupare più spazio.",
          "reference": "C6"
        }
      ],
      "page": 18
    },
    {
      "name": "Senza catene",
      "effects": "Se qualcosa ti intralcia o prova a trattenerti, rilassa i muscoli e tira con Discrezione.\n\nIn caso di Successo, lo attraversi senza toccarlo. Diventi intangibile e puoi attraversare muri, catene o altri ostacoli per un'ora.\n\nPer ogni tre 3, scegli un effetto in più:\n\nDiventi invisibile Non emetti alcun suono Svanisci dai ricordi di un osservatore Puoi portare una persona con te ogni volta che attraversi un ostacolo\n\nIn caso di Fallimento, la tua forma fisica diventa instabile. Per il resto dell'Incarico o fino alla tua morte non sei più in grado di interagire con gli oggetti fisici, ma puoi comunque subire Danni.",
      "question": "Preferisco essere...",
      "answers": [
        {
          "text": "Il diversivo.",
          "reference": "U3"
        },
        {
          "text": "L'infiltrato.",
          "reference": "O3"
        }
      ],
      "page": 18
    }
  ]
};

export const ANOMALIES = Object.keys(ANOMALY_ABILITIES);
