import { createStore, getMany, setMany } from 'idb-keyval';
import { apiSend } from './api';
import type { Card } from './types';

// Cards never change once generated: keep them forever (memory → IndexedDB → POST /cards/batch).
// v2: cards carry `excerpt`. Bump the name whenever the cached card shape changes.
const store = createStore('wme-cards-v1', 'cards');
const memory = new Map<string, Card>();

function slim(c: Card): Card {
  return {
    id: c.id, atk: c.atk, def: c.def, lang: c.lang, rarity: c.rarity, q_score: c.q_score, category: c.category,
    image_url: c.image_url, pageviews: c.pageviews, sensitive: c.sensitive, wikipedia_url: c.wikipedia_url, title: c.title, excerpt: c.excerpt ?? null,
  };
}

/** Remember cards that arrived embedded in another response (packs, auctions, trades…). */
export async function rememberCards(cards: Card[]) {
  const fresh = cards.filter((c) => c && !memory.has(c.id)).map(slim);
  fresh.forEach((c) => memory.set(c.id, c));
  if (fresh.length) await setMany(fresh.map((c) => [c.id, c]), store);
}

export async function getCards(ids: string[]): Promise<Map<string, Card>> {
  const unique = [...new Set(ids)];
  let missing = unique.filter((id) => !memory.has(id));
  if (missing.length) {
    const stored = await getMany<Card | undefined>(missing, store);
    stored.forEach((c) => c && memory.set(c.id, c));
    missing = missing.filter((id) => !memory.has(id));
  }
  for (let i = 0; i < missing.length; i += 500) {
    await rememberCards(await apiSend<Card[]>('POST', '/cards/batch', { ids: missing.slice(i, i + 500) }));
  }
  return new Map(unique.flatMap((id) => (memory.has(id) ? [[id, memory.get(id)!] as const] : [])));
}
