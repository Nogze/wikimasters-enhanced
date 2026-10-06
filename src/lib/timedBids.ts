import { useSyncExternalStore } from 'react';
import { ApiError, prepareRequest } from './api';
import * as market from './market';
import { refreshBalance } from './account';
import { LATENCY_FACTOR, latency, runAt, SNIPE_LEFT, type Fired } from './snipe';

// Timed bids (« Miser à 10 s de la fin »), kept by the app rather than by a screen: once armed, a
// bid goes out even if the player closes the lot or goes elsewhere in the game (the tab must stay
// open). Each bid is sent so it lands just before the last 10 seconds of the auction — a bid inside
// them pushes the end back by a minute on both servers.
//
// The send time is fixed when arming (end of the auction, server clock offset, latency margin) and
// only moves if the auction's end moves. A few seconds before sending, the auction is re-read: an
// extension or a higher bid since arming is taken into account (a bid now below the minimum is not
// sent: that would spend nothing anyway, but the player is told why).

export type TimedBid = {
  lotId: string;
  title: string;
  amount: number;
  endAt: string;
  /** Server clock − local clock (ms). */
  offset: number;
  /** Margin before the last 10 s: latency × factor, measured when arming. */
  margin: number;
  sendAt: number;
  state: 'armed' | 'sending' | 'placed' | 'failed';
  message?: string;
};

const bids = new Map<string, TimedBid>();
const cancels = new Map<string, () => void>();
const subs = new Set<() => void>();
let snapshot: TimedBid[] = [];
const emit = () => {
  snapshot = [...bids.values()];
  subs.forEach((f) => f());
};
const listeners = new Set<(b: TimedBid) => void>();
/** Called when a timed bid is placed or fails (the shell shows a toast). */
export const onTimedResult = (f: (b: TimedBid) => void) => (listeners.add(f), () => void listeners.delete(f));

const computeSend = (endAt: string, offset: number, margin: number) => new Date(endAt).getTime() - offset - SNIPE_LEFT - margin;

function settle(b: TimedBid, state: 'placed' | 'failed', message: string) {
  const done = { ...b, state, message };
  bids.set(b.lotId, done);
  emit();
  listeners.forEach((f) => f(done));
  // Results stay visible on the lot for a while, then go.
  setTimeout(() => {
    if (bids.get(b.lotId) === done) bids.delete(b.lotId), emit();
  }, 60_000);
}

/** `checked`: the final re-read is done; only the send remains (built now: fresh token). */
function schedule(b: TimedBid, checked = false) {
  cancels.get(b.lotId)?.();
  const check = checked ? () => {} : runAt(Math.max(Date.now(), b.sendAt - 4000), () => void recheck(b.lotId));
  // The bid itself leaves from the worker at the exact moment (the page may be busy drawing);
  // without a worker, from the page.
  const req = prepareRequest('POST', `/market/${b.lotId}/bid`, { amount: b.amount });
  const fire = runAt(b.sendAt, (r) => void (req && r.status != null ? sent(b.lotId, r) : send(b.lotId)), req ?? undefined);
  cancels.set(b.lotId, () => (check(), fire()));
}

/** The worker's answer to the bid it sent. */
async function sent(lotId: string, r: Fired) {
  const b = bids.get(lotId);
  if (!b || b.state !== 'armed') return;
  if (r.status && r.status < 300) {
    refreshBalance().catch(() => {});
    return settle(b, 'placed', `Mise de dernière seconde placée : ${b.amount.toLocaleString('fr')} WB sur « ${b.title} ».`);
  }
  let msg = 'erreur réseau';
  try {
    const j = JSON.parse(r.text ?? '');
    msg = j.message ?? j.error ?? msg;
  } catch {
    if (r.status) msg = `le serveur a répondu ${r.status}`;
  }
  settle(b, 'failed', `Mise de dernière seconde sur « ${b.title} » refusée : ${msg}.`);
}

/** Re-reads the auction a few seconds before sending: its end may have moved (anti-snipe). */
async function recheck(lotId: string) {
  const b = bids.get(lotId);
  if (!b || b.state !== 'armed') return;
  try {
    const cal = await calibrate(lotId, 2);
    const d = await market.lot(lotId);
    if (d.status !== 'active') return settle(b, 'failed', 'Mise de dernière seconde annulée : la vente est terminée.');
    const offset = cal?.offset ?? b.offset;
    const moved = d.end_at !== b.endAt || Math.abs(offset - b.offset) > 150;
    const next = moved ? { ...b, endAt: d.end_at, offset, sendAt: computeSend(d.end_at, offset, b.margin) } : b;
    if (moved) bids.set(lotId, next), emit();
    // Rebuilt with the token the re-read just used; a send pushed far back gets its own re-read.
    schedule(next, next.sendAt - Date.now() < 6000);
  } catch {
    /* keep the plan: the send itself will report a problem */
  }
}

async function send(lotId: string) {
  const b = bids.get(lotId);
  if (!b || b.state !== 'armed') return;
  bids.set(lotId, { ...b, state: 'sending' });
  emit();
  try {
    await market.bid(lotId, b.amount);
    refreshBalance().catch(() => {});
    settle(b, 'placed', `Mise de dernière seconde placée : ${b.amount.toLocaleString('fr')} WB sur « ${b.title} ».`);
  } catch (e) {
    settle(b, 'failed', `Mise de dernière seconde sur « ${b.title} » refusée : ${e instanceof ApiError ? e.message : 'erreur réseau'}.`);
  }
}

/**
 * Server clock − local clock, from a few reads of the auction: each answer's server time against
 * the middle of its round trip; the fastest round trip is the most precise. Null when the server
 * gives no time (a timed bid can't be aimed then).
 */
async function calibrate(lotId: string, samples = 4): Promise<{ offset: number; rtt: number; endAt: string } | null> {
  let best: { offset: number; rtt: number; endAt: string } | null = null;
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const d = await market.lot(lotId);
    const t1 = Date.now();
    if (d.server_time) {
      const s = { offset: new Date(d.server_time).getTime() - (t0 + t1) / 2, rtt: t1 - t0, endAt: d.end_at };
      if (!best || s.rtt < best.rtt) best = s;
    }
    if (i < samples - 1) await new Promise((r) => setTimeout(r, 120));
  }
  return best;
}

/** Arms a timed bid, aimed by the server's clock. Throws when it can't be (too late, no clock). */
export async function armTimedBid(lot: { id: string; title: string }, amount: number) {
  const cal = await calibrate(lot.id);
  if (!cal) throw new Error('Horloge du serveur indisponible : la mise à 10 s ne peut pas être visée. Enchérissez directement.');
  const offset = cal.offset;
  // Margin: the slower of the recent API calls and the calibration round trips.
  const margin = Math.max(latency(), cal.rtt) * LATENCY_FACTOR;
  const lotEnd = cal.endAt;
  const sendAt = computeSend(lotEnd, offset, margin);
  if (sendAt - Date.now() < 500) throw new Error('Trop tard pour une mise à 10 s : enchérissez directement.');
  const b: TimedBid = { lotId: lot.id, title: lot.title, amount, endAt: lotEnd, offset, margin, sendAt, state: 'armed' };
  bids.set(lot.id, b);
  emit();
  schedule(b);
  return b;
}

export function cancelTimedBid(lotId: string) {
  cancels.get(lotId)?.();
  cancels.delete(lotId);
  bids.delete(lotId);
  emit();
}

/** A lot's end moved (live bid event): follow it. */
export function lotEndChanged(lotId: string, endAt: string) {
  const b = bids.get(lotId);
  if (!b || b.state !== 'armed' || b.endAt === endAt) return;
  const next = { ...b, endAt, sendAt: computeSend(endAt, b.offset, b.margin) };
  bids.set(lotId, next);
  emit();
  schedule(next);
}

export function useTimedBids(): TimedBid[] {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => snapshot,
  );
}
