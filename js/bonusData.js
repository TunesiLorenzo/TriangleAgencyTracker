// bonusData.js
// The Bonus Legame a relationship can grant (Triangle-Agency manual, "Realtà & Bonus Legame",
// page 131), each with a short summary. A Bonus lasts until the end of the next Incarico after
// the Legame goes up, and for good once the relationship joins the Network. When none of these
// fits the person, the agent and the GM write a custom one.

export const RELATIONSHIP_BONUSES = [
  { name: 'Intuitivo', text: 'Chiamala per un avvertimento su un pericolo in agguato o una tragedia che puoi ancora prevenire.' },
  { name: 'Comprensivo', text: 'Non può diventare Testimone. Ti aiuta a far mantenere la calma a un piccolo gruppo di persone.' },
  { name: 'Socievole', text: 'Ti organizza un incontro con chiunque, tranne un recluso totale. Se la metti in imbarazzo: −1 Legame.' },
  { name: 'Iellata', text: 'Le chiedi di interagire educatamente con qualcuno: la iella gli resta attaccata, con fastidi e distrazioni per il resto della giornata.' },
  { name: 'Tecnologica', text: 'Sfoderi un dispositivo di nicchia ma perfetto per l’occasione, prestato da lei. Se si rompe o va perso: −1 Legame.' },
  { name: 'Stimolante', text: 'Le fai visita e condividete un vostro piccolo rituale: ripristini fino a 3 Controlli Qualità già usati.' },
  { name: 'Modaiola', text: 'Ti presta un cambio d’abito, un travestimento o un completo elegante. Se perdi o rovini qualcosa: −1 Legame.' },
  { name: 'Influente', text: 'Diffonde un’idea, una moda o un’opinione in tutta la sua rete sociale: quasi tutti ne sentiranno parlare.' },
  { name: 'Motorizzata', text: 'Ti dà un passaggio o ti presta il suo insolito veicolo. Se non torna in buone condizioni: −1 Legame.' },
  { name: 'Nerboruta', text: 'Se è nei paraggi, protegge altri civili dalla morte o da 1 Danno, fino a 3 volte prima di ritirarsi.' },
  { name: 'Saggia', text: 'Ti consiglia sempre la cosa giusta su un problema interpersonale. Rivelarle troppo può generare Testimoni.' },
  { name: 'Colta', text: 'Chiamala per capire un evento storico o come funziona qualcosa. Rivelarle troppo può generare Testimoni.' }
];

/** The manual's Bonus with this name (any case), if it is one. */
export function findBonus(name) {
  const key = String(name || '').trim().toLowerCase();
  return RELATIONSHIP_BONUSES.find(bonus => bonus.name.toLowerCase() === key) || null;
}
