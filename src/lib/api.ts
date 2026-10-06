import { recordCall } from './metrics';

// The client's endpoints (/packs, /collection, /market…), answered from wiki-masters by the backend
// set at start (src/ext/wm.ts). Reads: identical concurrent requests share one call, and responses
// are kept for `ttl` ms. Writes: only ever on an explicit user action; they invalidate related reads.

type Entry = { at: number; data: unknown };
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** API error: `code` is the stable machine-readable `error` field (e.g. NO_PACKS, BID_TOO_LOW). */
export class ApiError extends Error {
  constructor(
    public status: number,
    public path: string,
    public body: { error?: string; message?: string; details?: Record<string, unknown> } = {},
  ) {
    super(body.message ?? `${path} → HTTP ${status}`);
  }
  get code() {
    return this.body.error ?? `HTTP_${this.status}`;
  }
  get details() {
    return this.body.details ?? {};
  }
}

// ---------- backend ----------

export type Prepared = { url: string; init: RequestInit };
/** Answers the endpoints (throws ApiError on failure). */
export type Backend = {
  request(method: string, path: string, body?: unknown): Promise<unknown>;
  /** The raw HTTP request for a call, when it can be sent as is (timed bids). */
  prepare?(method: string, path: string, body?: unknown): Prepared | null;
  /** The signed-in player, or null. */
  session(): Promise<Session | null>;
};
let backend: Backend | null = null;
export function setBackend(b: Backend) {
  backend = b;
}
function need(): Backend {
  if (!backend) throw new Error('backend not set');
  return backend;
}

/** The HTTP request a call makes (absolute URL, headers, body), to send it later from a worker. */
export function prepareRequest(method: string, path: string, body?: unknown): Prepared | null {
  return need().prepare?.(method, path, body) ?? null;
}

// ---------- session ----------

type Me = { id: string; email: string; username: string; role: 'player' | 'admin'; emailVerified: boolean };
export type Session = { accessToken: string; user: Me };

let session: Session | null | undefined; // undefined = not known yet
const sessionSubs = new Set<() => void>();
const emitSession = () => sessionSubs.forEach((s) => s());

function setSession(s: Session | null) {
  session = s;
  emitSession();
}
export const getSession = () => session;
export function subscribeSession(fn: () => void) {
  sessionSubs.add(fn);
  return () => sessionSubs.delete(fn);
}

// One read at a time, shared by everything that asks together.
let refreshing: Promise<boolean> | null = null;
export function refreshSession(): Promise<boolean> {
  refreshing ??= need()
    .session()
    .then((s) => (setSession(s), !!s))
    .catch(() => (setSession(null), false))
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

// ---------- requests ----------

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const t = performance.now();
  const data = (await need().request(method, path, body)) as T;
  recordCall({ url: `${method === 'GET' ? '' : method + ' '}${path}`, ms: Math.round(performance.now() - t), bytes: 0, at: Date.now(), cached: false });
  return data;
}

export async function apiGet<T>(path: string, { ttl = 30_000, force = false } = {}): Promise<T> {
  const hit = cache.get(path);
  if (!force && hit && Date.now() - hit.at < ttl) {
    recordCall({ url: path, ms: 0, bytes: 0, at: Date.now(), cached: true });
    return hit.data as T;
  }
  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;
  const p = request<T>('GET', path)
    .then((data) => {
      cache.set(path, { at: Date.now(), data });
      return data;
    })
    .finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

/** Mutating call. `invalidates` lists path prefixes whose cached reads become stale. */
export async function apiSend<T = Record<string, unknown>>(
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  { invalidates = [] as string[] } = {},
): Promise<T> {
  try {
    return await request<T>(method, path, body);
  } finally {
    invalidates.forEach(invalidate);
  }
}

function invalidate(prefix: string) {
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}
