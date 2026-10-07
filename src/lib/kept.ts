import { useCallback, useReducer } from 'react';

// Screen data that outlives the screen: coming back to a page shows what it showed last time at
// once, while the page's own effect re-reads it in the background (stale-while-revalidate), instead
// of « Chargement… » on every visit. Keyed by what the data is (a lot's id, a search…); kept for the
// session, the least recently used dropped past MAX.

const kept = new Map<string, unknown>();
const MAX = 300;

function remember(key: string, value: unknown) {
  kept.delete(key);
  kept.set(key, value);
  if (kept.size > MAX) kept.delete(kept.keys().next().value!);
}

/** Like useState, but the value is remembered under `key` (the initial value only until then). */
export function useKept<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const value = (kept.has(key) ? kept.get(key) : initial) as T;
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = (kept.has(key) ? kept.get(key) : initial) as T;
      remember(key, typeof next === 'function' ? (next as (p: T) => T)(prev) : next);
      rerender();
    },
    [key], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return [value, set];
}
