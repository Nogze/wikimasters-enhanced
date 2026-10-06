import { useSyncExternalStore } from 'react';
import { apiGet } from './api';

// Shared account state: profile (GET /me), pack counter (GET /packs) and WB balance (GET /wallet).
// Loaded once per session, then re-read after actions and when a pack is due.

export type Profile = {
  id: string;
  email?: string;
  username?: string;
  tier?: 'free' | 'pro' | 'vip';
  role?: 'player' | 'admin';
  lang?: string;
  is_public?: boolean;
  hide_sensitive?: boolean;
  bio?: string | null;
  avatar_user_card_id?: string | null;
  username_change_available_at?: string | null;
  created_at?: string;
  // Pack counter, under the field names the pages already use.
  packs_remaining?: number;
  pack_cap?: number;
  /** Start of the current regeneration period (next pack = this + regen period). */
  packs_last_regen_at?: string | null;
  pack_regen_ms?: number;
  [key: string]: unknown;
};

type PackState = { packs: number; cap: number; nextAt: string | null; regenMs?: number };
type State = { profile: Profile | null; balance: number | null };
let state: State = { profile: null, balance: null };
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

export function patchProfile(patch: Partial<Profile>) {
  if (state.profile) set({ profile: { ...state.profile, ...patch } });
}

let regenMs = 10 * 60_000;
function applyPacks(p: PackState) {
  if (p.regenMs) regenMs = p.regenMs;
  patchProfile({
    packs_remaining: p.packs,
    pack_cap: p.cap,
    pack_regen_ms: regenMs,
    packs_last_regen_at: p.nextAt ? new Date(new Date(p.nextAt).getTime() - regenMs).toISOString() : null,
  });
  scheduleRegen(p.nextAt);
}

// The server adds regenerated packs when the counter is read, without telling anyone: re-read it
// when the next pack is due, when the tab comes back into view, and every few minutes anyway.
let regenTimer: ReturnType<typeof setTimeout> | undefined;
let lastPacksRead = 0;
function scheduleRegen(nextAt: string | null) {
  clearTimeout(regenTimer);
  if (!nextAt) return;
  regenTimer = setTimeout(() => void refreshPacks(), Math.max(1000, new Date(nextAt).getTime() - Date.now() + 1500));
}
async function refreshPacks() {
  if (!started) return;
  lastPacksRead = Date.now();
  try {
    applyPacks(await apiGet<PackState>('/packs', { force: true }));
  } catch {
    clearTimeout(regenTimer);
    regenTimer = setTimeout(() => void refreshPacks(), 30_000);
  }
}

let syncing: Promise<Profile | null> | null = null;
/** (Re)loads profile + packs + balance. */
export function syncProfile(_userId?: string): Promise<Profile | null> {
  syncing ??= (async () => {
    const [me, packs, wallet] = await Promise.all([
      apiGet<Profile>('/me', { force: true }),
      apiGet<PackState>('/packs', { force: true }),
      apiGet<{ balance: number }>('/wallet', { force: true }),
    ]);
    set({ profile: me, balance: wallet.balance });
    applyPacks(packs);
    lastPacksRead = Date.now();
    return state.profile;
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function refreshBalance(force = true) {
  const { balance } = await apiGet<{ balance: number }>('/wallet', { ttl: 60_000, force });
  set({ balance });
}

export function setBalance(balance: number) {
  set({ balance });
}

export function setPacks(p: PackState) {
  applyPacks(p);
}

let started: string | null = null;
export function startAccount(userId: string) {
  if (started === userId) return;
  started = userId;
  syncProfile().catch((e) => console.warn('[profile]', e));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastPacksRead > 15_000) void refreshPacks();
  });
  setInterval(() => document.visibilityState === 'visible' && void refreshPacks(), 5 * 60_000);
}

export function useAccount(): State {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => state,
  );
}

const FREE_PACK_MAX = 10;
export const packCap = (p: Profile | null) => p?.pack_cap ?? FREE_PACK_MAX;
export const regenPeriodMs = (p: Profile | null) => p?.pack_regen_ms ?? regenMs;

