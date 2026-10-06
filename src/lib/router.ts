import { useSyncExternalStore, type MouseEvent } from 'react';

// Minimal router: the path picks the page, the query holds page state. Paths are wiki-masters'
// own (the client replaces their pages at the same addresses).
export const BASE = '';

const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());
window.addEventListener('popstate', emit);


export async function navigate(to: string, { replace = false } = {}) {
  const url = to.startsWith('http') ? to : BASE + to;
  if (url === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  emit();
}

/** App path without the base ("/", "/collection"). */
export function usePath() {
  return useSyncExternalStore(
    (fn) => (subs.add(fn), () => subs.delete(fn)),
    () => location.pathname.slice(BASE.length) || '/',
  );
}

export function useQuery(): URLSearchParams {
  const search = useSyncExternalStore(
    (fn) => (subs.add(fn), () => subs.delete(fn)),
    () => location.search,
  );
  return new URLSearchParams(search);
}

/** Merges query params (null/'' removes) and navigates, replacing history by default. */
export function setQuery(patch: Record<string, string | null | undefined>, { push = false } = {}) {
  const p = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(patch)) v == null || v === '' ? p.delete(k) : p.set(k, v);
  const qs = p.toString();
  navigate(location.pathname.slice(BASE.length) + (qs ? `?${qs}` : ''), { replace: !push });
}

/** onClick for <a href="/…">: client-side navigation for plain left clicks. */
export function linkClick(e: MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = e.currentTarget.getAttribute('href');
  if (!href?.startsWith(BASE)) return;
  e.preventDefault();
  navigate(href.slice(BASE.length));
}
