import { apiGet, apiSend } from './api';
import { rememberCards } from './cardCache';
import type { Card } from './types';

// Trades between players: wiki-masters' /api/trades, mapped to these shapes by the adapter
// (src/ext/wm.ts). Nothing is escrowed: their server re-checks ownership when the offer is accepted.

export type Person = { id: string; username: string };
export type TradeItem = { offered_by: string; card: Card; is_shiny: boolean; quantity: number; user_card_id?: string };
export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'countered';
export type Trade = {
  id: string;
  status: TradeStatus;
  initiator: Person;
  recipient: Person;
  initiator_wb: number;
  recipient_wb: number;
  message?: string | null;
  parent_trade_id?: string | null;
  expires_at?: string | null;
  created_at: string;
  resolved_at?: string | null;
  items: TradeItem[];
};
export type Box = 'active' | 'history';
export type PartnerCard = { id: string; card: Card; is_shiny: boolean; count: number; locked?: boolean };
export type Offer = {
  recipientId: string;
  give: { userCardId: string; quantity: number; cardId?: string }[];
  take: { userCardId: string; quantity: number; cardId?: string }[];
  giveWb: number;
  takeWb: number;
  message?: string;
  parentTradeId?: string;
};

export const MAX_CARDS = 100;
export const MAX_WB = 10_000;

export const STATUS: Record<TradeStatus, { label: string; color: string }> = {
  pending: { label: 'EN ATTENTE', color: '#ffd23f' },
  accepted: { label: 'ACCEPTÉ', color: '#5ee0a0' },
  declined: { label: 'REFUSÉ', color: '#ff8a9a' },
  cancelled: { label: 'ANNULÉ', color: '#a3a3a3' },
  expired: { label: 'EXPIRÉ', color: '#a3a3a3' },
  countered: { label: 'CONTRE-OFFRE', color: '#8fe3ff' },
};

export async function list(box: Box): Promise<Trade[]> {
  const res = await apiGet<{ items: Trade[] }>(`/trades?box=${box}`, { ttl: 10_000 });
  void rememberCards(res.items.flatMap((t) => t.items.map((i) => i.card)).filter(Boolean));
  return res.items;
}
export const respond = (id: string, action: 'accept' | 'decline' | 'cancel') =>
  apiSend<{ status: TradeStatus }>('PATCH', `/trades/${id}`, { action }, { invalidates: ['/trades', '/collection', '/wallet'] });
export const propose = (o: Offer) => apiSend<{ id: string }>('POST', '/trades', o, { invalidates: ['/trades'] });

export const friends = () => apiGet<{ friends: (Person & { online?: boolean })[] }>('/friends', { ttl: 60_000 }).then((r) => r.friends);
export const searchPlayers = (q: string) => apiGet<Person[]>(`/players?q=${encodeURIComponent(q)}`, { ttl: 60_000 });

/** A partner's cards, rarest first, searchable and paged (the username is for wiki-masters). */
export async function partnerCards(peer: Person, q: string, page: number): Promise<{ items: PartnerCard[]; hasMore: boolean }> {
  const p = new URLSearchParams({ page: String(page), username: peer.username });
  if (q) p.set('q', q);
  const res = await apiGet<{ items: PartnerCard[]; hasMore: boolean }>(`/players/id/${peer.id}/cards?${p}`, { ttl: 60_000 });
  void rememberCards(res.items.map((i) => i.card));
  return res;
}

/** From my point of view: who's on the other side, what I give, what I get. */
export function sides(t: Trade, me: string) {
  const mine = t.initiator.id === me;
  return {
    mine,
    other: mine ? t.recipient : t.initiator,
    give: t.items.filter((i) => i.offered_by === me),
    get: t.items.filter((i) => i.offered_by !== me),
    giveWb: mine ? t.initiator_wb : t.recipient_wb,
    getWb: mine ? t.recipient_wb : t.initiator_wb,
  };
}

export const ago = (iso: string, now = Date.now()) => {
  const m = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
  return `il y a ${Math.floor(m / 1440)} j`;
};
