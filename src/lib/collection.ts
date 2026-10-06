import { useEffect, useState } from 'react';
import { apiGet, apiSend } from './api';
import { setBalance } from './account';
import { getCards } from './cardCache';
import type { Card, Rarity, Tag } from './types';

export type Owned = {
  id: string;
  card_id: string;
  is_shiny: boolean;
  count: number;
  starred: boolean;
  locked: boolean;
  obtained_at: string;
  rarity: Rarity;
  tag_ids: string[];
};
export type Item = Owned & { card: Card };
export type Collection = { items: Item[]; tags: Tag[] };

/** The whole collection: slim rows from the API, card data from the local cache. */
export async function loadCollection(force = true): Promise<Collection> {
  const res = await apiGet<{ items: Owned[]; tags: Tag[] }>('/collection', { force, ttl: 30_000 });
  const cards = await getCards(res.items.map((r) => r.card_id));
  return { items: res.items.flatMap((r) => (cards.has(r.card_id) ? [{ ...r, card: cards.get(r.card_id)! }] : [])), tags: res.tags };
}

export const setFlags = (userCardIds: string[], flags: { starred?: boolean; locked?: boolean }) =>
  apiSend('PATCH', '/collection/flags', { userCardIds, ...flags }, { invalidates: ['/collection'] });

/** Discards one copy of each row; returns WB gained. */
export async function discard(userCardIds: string[]): Promise<number> {
  let gained = 0;
  for (let i = 0; i < userCardIds.length; i += 500) {
    const r = await apiSend<{ gained: number; balance: number }>('POST', '/collection/discard', { items: userCardIds.slice(i, i + 500).map((userCardId) => ({ userCardId, quantity: 1 })) }, { invalidates: ['/collection'] });
    gained += r.gained;
    setBalance(r.balance);
  }
  return gained;
}

/** Collection score (same rule as the leaderboard: points per unique card, ×2 shiny). */
const POINTS: Record<Rarity, number> = { C: 1, PC: 3, R: 10, SR: 30, UR: 100, L: 500 };
export const scoreOf = (items: Owned[]) => items.reduce((s, i) => s + POINTS[i.rarity] * (i.is_shiny ? 2 : 1), 0);

/** Copies I own of each card (card id → count), for « déjà possédée » marks elsewhere. */
export function useOwnedCounts(): Map<string, number> | null {
  const [m, setM] = useState<Map<string, number> | null>(null);
  useEffect(() => {
    let off = false;
    loadCollection(false).then(
      (c) => {
        if (off) return;
        const out = new Map<string, number>();
        c.items.forEach((i) => out.set(i.card_id, (out.get(i.card_id) ?? 0) + i.count));
        setM(out);
      },
      () => !off && setM(new Map()),
    );
    return () => {
      off = true;
    };
  }, []);
  return m;
}
