import { apiGet, apiSend } from './api';
import { rememberCards } from './cardCache';
import type { Card, Rarity } from './types';

// The auction house: wiki-masters' marketplace, mapped to these shapes by the adapter (src/ext/wm.ts).

export type Lot = {
  id: string;
  card: Card;
  is_shiny: boolean;
  seller: { id?: string; username: string };
  current_bidder: { id?: string; username: string } | null;
  base_amount: number;
  current_bid: number | null;
  min_next_bid: number;
  bid_count: number;
  end_at: string;
  status: string;
  created_at?: string;
  listing_base_amount?: number | null;
  base_repriced_at?: string | null;
  final_price?: number | null;
  mine?: boolean;
  leading?: boolean;
};
export type LotDetail = Lot & { bids: { amount: number; created_at: string; username: string }[]; server_time?: string };
export type MarketSort = 'ending' | 'recent' | 'price_asc' | 'price_desc';
export type MineTab = 'selling' | 'bidding' | 'won' | 'history';
export type Summary = { selling: number; leading: number; maxConcurrentAuctions: number };

export const DURATIONS = [
  { label: '10 MIN', minutes: 10 },
  { label: '30 MIN', minutes: 30 },
  { label: '1 H', minutes: 60 },
  { label: '3 H', minutes: 180 },
  { label: '6 H', minutes: 360 },
  { label: '12 H', minutes: 720 },
];

/** Next minimum bid: +10 % (at least +1), as on both servers. */
export const nextBid = (current: number | null, base: number) => (current == null ? base : Math.max(Math.floor((current * 11 + 9) / 10), current + 1));

export async function browse(q: { rarities: Rarity[]; text: string; sort: MarketSort; page: number }): Promise<{ items: Lot[]; hasMore: boolean }> {
  const p = new URLSearchParams({ sort: q.sort, page: String(q.page), pageSize: '50' });
  if (q.text) p.set('q', q.text);
  q.rarities.forEach((r) => p.append('rarity', r));
  const res = await apiGet<{ items: Lot[]; hasMore: boolean }>(`/market?${p}`, { ttl: 15_000 });
  void rememberCards(res.items.map((l) => l.card));
  return res;
}
export async function mine(tab: MineTab): Promise<Lot[]> {
  const res = await apiGet<{ items: Lot[] }>(`/market/mine?tab=${tab}`, { ttl: 15_000 });
  void rememberCards(res.items.map((l) => l.card));
  return res.items;
}
export const summary = () => apiGet<Summary>('/market/summary', { ttl: 15_000 });
export const lot = (id: string) => apiGet<LotDetail>(`/market/${id}`, { force: true });
export const bid = (id: string, amount: number) => apiSend<{ current_bid: number; end_at: string; balance?: number }>('POST', `/market/${id}/bid`, { amount }, { invalidates: ['/market', '/wallet'] });
export const sell = (userCardId: string, baseAmount: number, durationMinutes: number) =>
  apiSend<{ id: string; end_at: string }>('POST', '/market', { userCardId, baseAmount, durationMinutes }, { invalidates: ['/market', '/collection'] });
/** Closes an auction that ended but wasn't settled yet (wiki-masters waits for someone to do it). */
export const settle = (id: string) => apiSend('POST', `/market/${id}/settle`, undefined, { invalidates: ['/market', '/collection', '/wallet'] });
export const cancel = (id: string) => apiSend('DELETE', `/market/${id}`, undefined, { invalidates: ['/market', '/collection'] });
export const reprice = (id: string, baseAmount: number) => apiSend('POST', `/market/${id}/reprice`, { baseAmount }, { invalidates: ['/market'] });

/** "2 h 05", "4 min 12 s", "terminée". */
export function timeLeft(endAt: string, now: number): string {
  const ms = new Date(endAt).getTime() - now;
  if (ms <= 0) return 'terminée';
  const s = Math.floor(ms / 1000);
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
  if (s >= 60) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return `${s} s`;
}
