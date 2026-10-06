import { useEffect, useState } from 'react';
import { useAccount } from './account';

/** Re-renders every `ms` with the current time. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** 83 000 ms → "01:23". */
export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Packs in reserve, the cap, and when the next one arrives (null when full). */
export function usePacks() {
  const { profile } = useAccount();
  const packs = profile?.packs_remaining ?? null;
  const cap = profile?.pack_cap ?? 10;
  const nextAt = profile?.packs_last_regen_at && packs != null && packs < cap ? new Date(profile.packs_last_regen_at).getTime() + (profile.pack_regen_ms ?? 600_000) : null;
  return { packs, cap, nextAt, regenMs: profile?.pack_regen_ms ?? 600_000 };
}
