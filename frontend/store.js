/* ==========================================================================
   CONTENTIX — Central State Store
   Single source of truth for allCards
   ========================================================================== */

let allCards = [];
const listeners = [];

function getAllCards() {
  return allCards;
}

function setAllCards(cards) {
  allCards = cards;
  listeners.forEach(fn => fn(cards));
}

async function loadAllCards() {
  try {
    const res = await fetch('/api/videos');
    if (!res.ok) throw new Error('API nicht erreichbar');
    const cards = await res.json();
    setAllCards(cards);
    return cards;
  } catch (err) {
    console.error('loadAllCards failed:', err);
    return allCards; // return stale data rather than nothing
  }
}

function onAllCardsChange(fn) {
  listeners.push(fn);
}
