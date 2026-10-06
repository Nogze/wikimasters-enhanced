import { ApiError, type Backend, type Session } from '../lib/api';
import type { Card, Rarity } from '../lib/types';
import { bg, type WmAuth } from './bridge';

// The client's endpoints, answered by wiki-masters: their Next.js /api routes (same origin, the
// player's own session cookie) and their Supabase REST (the player's token, like their own app).
// Nothing else is contacted.

const ORIGIN = location.origin; // https://www.wiki-masters.com
const SUPABASE = 'https://cyrxjeppjqsxxjayfrur.supabase.co';
const CARD_COLUMNS = 'id,atk,def,lang,rarity,q_score,category,image_url,pageviews,hide_image,wikipedia_url,wikipedia_title';
const PAGE = 1000;

type WmCard = { id: string; atk: number; def: number; lang?: string | null; rarity: Rarity; q_score?: number | null; category?: string | null; image_url?: string | null; pageviews?: number | null; hide_image?: boolean | null; wikipedia_url: string; wikipedia_title?: string | null };
type WmProfile = { username?: string; avatar_url?: string | null; is_pro?: boolean; is_vip?: boolean; pack_cap?: number; packs_remaining?: number; packs_last_regen_at?: string | null; wikibidous_balance?: number };
type OpenResult = { cards: (WmCard & { is_shiny?: boolean; card?: WmCard; user_card_id?: string })[]; packs_remaining: number; packs_last_regen_at?: string; owned_copies?: Record<string, number> | null };
type History = { id: string; created_at: string; pulls: { card: Card; is_shiny: boolean }[] }[];

const fail = (status: number, path: string, error: string, message: string) => new ApiError(status, path, { error, message });

// ---- auth (the background reads the session cookie) ----
let auth: WmAuth | null = null;
async function getAuth(fresh = false): Promise<WmAuth> {
  if (!auth || fresh) auth = await bg('wm-session');
  if (!auth) throw fail(401, '', 'WM_SIGNED_OUT', 'Connectez-vous sur wiki-masters.com');
  return auth;
}
let anonKey: Promise<string> | null = null;

/** Supabase REST with the player's token; retries once with a fresh cookie (it rotates). */
async function rest<T>(path: string, init: RequestInit & { headers?: Record<string, string> } = {}, retried = false): Promise<{ data: T; res: Response }> {
  const a = await getAuth(retried);
  anonKey ??= bg('wm-anon-key');
  const res = await fetch(`${SUPABASE}/rest/v1${path}`, {
    ...init,
    headers: { apikey: await anonKey, authorization: `Bearer ${a.accessToken}`, accept: 'application/json', 'content-type': 'application/json', ...init.headers },
  });
  if ((res.status === 401 || res.status === 403) && !retried) return rest<T>(path, init, true);
  if (!res.ok) throw fail(res.status, path, `WM_${res.status}`, `wiki-masters a répondu ${res.status}`);
  const text = await res.text();
  return { data: (text ? JSON.parse(text) : null) as T, res };
}

/** wiki-masters' own API (same origin, session cookie). */
/**
 * wiki-masters' server clock. Their responses carry `x-vercel-id: …-<epoch ms>-…`, the time their
 * edge received the request; `Date` (whole seconds) is the
 * fallback. Kept per path: the auction screen gets the server time of its own last read.
 */
const serverTimes = new Map<string, number>();
function noteServerTime(path: string, res: Response, sentAt: number) {
  const edge = res.headers.get('x-vercel-id')?.match(/-(\d{13})-/);
  if (edge) return void serverTimes.set(path, Number(edge[1]));
  const date = Date.parse(res.headers.get('date') ?? '');
  // Whole seconds: the middle of that second, measured against the middle of the round trip.
  if (Number.isFinite(date)) serverTimes.set(path, date + 500 - (Date.now() - sentAt) / 2);
}

async function wmApi<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const sentAt = Date.now();
  const res = await fetch(`${ORIGIN}/api${path}`, {
    method,
    credentials: 'include',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  document.documentElement.dataset.wcApi = `${method} ${path} ${res.status}`; // diagnostics, see PullScene
  if (method === 'GET') noteServerTime(path, res, sentAt);
  const text = await res.text();
  let data: { error?: string; message?: string } & Record<string, unknown> = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* HTML error page */
  }
  if (res.status === 401) throw fail(401, path, 'WM_SIGNED_OUT', 'Connectez-vous sur wiki-masters.com');
  if (!res.ok) throw fail(res.status, path, typeof data.error === 'string' ? data.error.toUpperCase().replace(/\W+/g, '_') : `WM_${res.status}`, (data.message ?? data.error ?? `wiki-masters a répondu ${res.status}`) as string);
  return data as T;
}

// ---- profile, cards ----
let profile: { at: number; p: WmProfile } | null = null;
async function loadProfile(force = false): Promise<WmProfile> {
  if (!force && profile && Date.now() - profile.at < 30_000) return profile.p;
  const a = await getAuth();
  const { data } = await rest<WmProfile | WmProfile[]>('/rpc/sync_profile_packs', { method: 'POST', body: JSON.stringify({ user_id: a.userId }) });
  const p = (Array.isArray(data) ? data[0] : data) ?? {};
  profile = { at: Date.now(), p };
  return p;
}
const regenMs = (p: WmProfile) => (p.is_pro || p.is_vip ? 3 : 10) * 60_000;
const capOf = (p: WmProfile) => p.pack_cap ?? 10;
function packState(p: WmProfile) {
  const packs = p.packs_remaining ?? 0;
  const cap = capOf(p);
  const nextAt = packs < cap && p.packs_last_regen_at ? new Date(new Date(p.packs_last_regen_at).getTime() + regenMs(p)).toISOString() : null;
  return { packs, cap, nextAt, regenMs: regenMs(p) };
}

function mapCard(c: WmCard): Card {
  const title = c.wikipedia_title || decodeURIComponent(c.wikipedia_url.split('/wiki/')[1] ?? '').replaceAll('_', ' ') || '?';
  return {
    id: c.id,
    atk: c.atk,
    def: c.def,
    lang: c.lang || 'fr',
    rarity: c.rarity,
    q_score: c.q_score ?? 0,
    category: c.category ?? null,
    image_url: c.image_url ?? null,
    pageviews: c.pageviews ?? 0,
    sensitive: !!c.hide_image,
    wikipedia_url: c.wikipedia_url,
    title,
    excerpt: null,
  };
}
const cards = new Map<string, Card>();
async function cardsByIds(ids: string[]): Promise<Map<string, Card>> {
  const missing = [...new Set(ids)].filter((id) => !cards.has(id));
  for (let i = 0; i < missing.length; i += 150) {
    const { data } = await rest<WmCard[]>(`/cards?select=${CARD_COLUMNS}&id=in.(${missing.slice(i, i + 150).join(',')})`);
    for (const c of data) cards.set(c.id, mapCard(c));
  }
  return new Map(ids.flatMap((id) => (cards.has(id) ? [[id, cards.get(id)!] as const] : [])));
}

// ---- things wiki-masters doesn't have: locks and opening history live in this browser ----
const LOCKS = 'wme-locks';
const HISTORY = 'wme-history';
const readJson = <T,>(k: string, d: T): T => {
  try {
    return (JSON.parse(localStorage.getItem(k) ?? '') as T) ?? d;
  } catch {
    return d;
  }
};
const locks = () => new Set([...readJson<string[]>(LOCKS, []), ...lockedNow]);
const LOCK_TAG = '[LOCKED]';
let lockTagId: string | null = null;
/** Locked copies as of the last collection load (tag) — merged with the browser's own list. */
let lockedNow = new Set<string>();

/** The account's [LOCKED] tag, created on first use (a lock is that tag on the card). */
async function ensureLockTag(): Promise<string> {
  if (lockTagId) return lockTagId;
  const a = await getAuth();
  const { data: found } = await rest<{ id: string }[]>(`/tags?select=id&user_id=eq.${a.userId}&name=eq.${encodeURIComponent(LOCK_TAG)}`);
  if (found[0]) return (lockTagId = found[0].id);
  const { data } = await rest<{ id: string }[]>('/tags', { method: 'POST', body: JSON.stringify({ user_id: a.userId, name: LOCK_TAG, color: '#fb7185' }), headers: { prefer: 'return=representation' } });
  return (lockTagId = data[0]!.id);
}
async function tagCards(tagId: string, ids: string[], on: boolean) {
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    if (on) await rest('/user_card_tags', { method: 'POST', body: JSON.stringify(part.map((id) => ({ user_card_id: id, tag_id: tagId }))), headers: { prefer: 'resolution=ignore-duplicates,return=minimal' } });
    else await rest(`/user_card_tags?tag_id=eq.${tagId}&user_card_id=in.(${part.join(',')})`, { method: 'DELETE', headers: { prefer: 'return=minimal' } });
  }
}
function pushHistory(pulls: { card: Card; is_shiny: boolean }[]) {
  const h = readJson<History>(HISTORY, []);
  h.unshift({ id: crypto.randomUUID(), created_at: new Date().toISOString(), pulls });
  localStorage.setItem(HISTORY, JSON.stringify(h.slice(0, 30)));
}


type Row = { id: string; card_id: string; count: number; starred: boolean | null; is_shiny: boolean | null; obtained_at: string; user_card_tags?: { tag_id: string }[]; card?: WmCard | null };

async function collection() {
  const a = await getAuth();
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    // Card data joined in (one request per 1000 rows), instead of fetching cards by id in batches.
    const { data } = await rest<Row[]>(`/user_cards?select=id,card_id,count,starred,is_shiny,obtained_at,user_card_tags(tag_id),card:cards(${CARD_COLUMNS})&user_id=eq.${a.userId}&order=obtained_at.desc`, {
      headers: { range: `${from}-${from + PAGE - 1}`, 'range-unit': 'items' },
    });
    for (const r of data) if (r.card) cards.set(r.card.id, mapCard(r.card));
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  const { data: tags } = await rest<{ id: string; name: string; color: string | null }[]>(`/tags?select=id,name,color&user_id=eq.${a.userId}&order=name`);
  const byId = await cardsByIds(rows.map((r) => r.card_id));
  // Locks: the account's [LOCKED] tag (seen on every device, and on the official site), plus the
  // ones an older version kept in this browser.
  const lockTag = tags.find((t) => t.name.trim().toUpperCase() === LOCK_TAG);
  lockTagId = lockTag?.id ?? null;
  const locked = locks();
  if (lockTag) rows.forEach((r) => r.user_card_tags?.some((t) => t.tag_id === lockTag.id) && locked.add(r.id));
  lockedNow = locked;
  const items = rows.map((r) => ({
    id: r.id,
    card_id: r.card_id,
    is_shiny: !!r.is_shiny,
    count: Math.max(1, r.count),
    starred: !!r.starred,
    locked: locked.has(r.id),
    obtained_at: r.obtained_at,
    rarity: byId.get(r.card_id)?.rarity ?? ('C' as Rarity),
    tag_ids: (r.user_card_tags ?? []).map((t) => t.tag_id),
  }));
  return { items, tags };
}

/**
 * wiki-masters' anti-bot check before opening packs. It is theirs to run, on their own page: the
 * client never tries to get around it, it sends the player there (PullPage, WM_HUMAN_CHECK).
 */
const isHumanCheck = (e: unknown) => e instanceof ApiError && (/bot|humain|human|v[ée]rif/i.test(e.message) || /HUMAN|BOT|VERIF/.test(e.code));

async function openPack() {
  const r = await wmApi<OpenResult>('POST', '/packs/open').catch((e) => {
    throw isHumanCheck(e) ? fail((e as ApiError).status, '/packs/open', 'WM_HUMAN_CHECK', (e as ApiError).message) : e;
  });
  const pulls = r.cards.map((x, i) => {
    const card = mapCard(x.card ?? x);
    cards.set(card.id, card);
    const copies = r.owned_copies?.[card.id] ?? 1;
    return { card, is_shiny: !!x.is_shiny, user_card_id: x.user_card_id ?? `${card.id}-${Date.now()}-${i}`, owned_copies: copies, is_new: copies <= 1 };
  });
  const p = await loadProfile().catch(() => ({}) as WmProfile);
  const next: WmProfile = { ...p, packs_remaining: r.packs_remaining, ...(r.packs_last_regen_at ? { packs_last_regen_at: r.packs_last_regen_at } : {}) };
  profile = { at: Date.now(), p: next };
  pushHistory(pulls.map((x) => ({ card: x.card, is_shiny: x.is_shiny })));
  // Refresh the mirror shortly after (the collection changed).
  setTimeout(() => void collection().catch(() => {}), 1500);
  return { packs: [pulls], state: packState(next) };
}

async function summary(id: string) {
  const c = (await cardsByIds([id])).get(id);
  if (!c) throw fail(404, `/cards/${id}`, 'NOT_FOUND', 'Carte introuvable');
  const res = await fetch(`https://${c.lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(c.title.replaceAll(' ', '_'))}`, { credentials: 'omit' });
  const j = res.ok ? ((await res.json()) as { extract?: string }) : {};
  return { ...c, summary: j.extract ?? null };
}

// ---- market: wiki-masters' /api/marketplace, mapped to lib/market.ts shapes ----
type WmUser = { id?: string; username?: string } | null | undefined;
type WmLot = {
  id: string;
  card: WmCard;
  is_shiny?: boolean | null;
  seller_id?: string;
  seller?: WmUser;
  current_bidder_id?: string | null;
  current_bidder?: WmUser;
  base_amount: number;
  current_bid?: number | null;
  effective_bid?: number | null;
  end_at: string;
  status: string;
  bids_count?: number;
  bid_count?: number;
  created_at?: string;
  listing_base_amount?: number | null;
  base_repriced_at?: string | null;
  final_price?: number | null;
};
const WM_SORT: Record<string, string> = { ending: 'ending_soon', recent: 'recent', price_asc: 'price_asc', price_desc: 'price_desc' };
const nextBid = (current: number | null, base: number) => (current == null ? base : Math.max(Math.ceil(1.1 * current), current + 1));

function mapLot(l: WmLot, me: string) {
  const card = mapCard(l.card);
  cards.set(card.id, card);
  const current = l.effective_bid ?? l.current_bid ?? null;
  return {
    id: l.id,
    card,
    is_shiny: !!l.is_shiny,
    seller: { id: l.seller_id, username: l.seller?.username ?? '?' },
    current_bidder: l.current_bidder_id ? { id: l.current_bidder_id, username: l.current_bidder?.username ?? '?' } : null,
    base_amount: l.base_amount,
    current_bid: current,
    min_next_bid: nextBid(l.current_bid ?? null, l.base_amount),
    bid_count: l.bid_count ?? l.bids_count ?? 0,
    end_at: l.end_at,
    status: l.status,
    created_at: l.created_at,
    listing_base_amount: l.listing_base_amount ?? null,
    base_repriced_at: l.base_repriced_at ?? null,
    final_price: l.final_price ?? null,
    mine: l.seller_id === me,
    leading: !!l.current_bidder_id && l.current_bidder_id === me,
  };
}

let mineCache: { at: number; data: Record<string, WmLot[]> } | null = null;
async function wmMine(force = false) {
  if (!force && mineCache && Date.now() - mineCache.at < 20_000) return mineCache.data;
  const data = await wmApi<Record<string, WmLot[]>>('GET', '/marketplace?page=1&limit=50&sort=recent&mine=1');
  mineCache = { at: Date.now(), data };
  return data;
}

async function marketRoute(method: string, path: string, query: URLSearchParams, b: Record<string, unknown>): Promise<unknown> {
  const me = (await getAuth()).userId;
  const route = `${method} ${path}`;
  if (route === 'GET /market') {
    const p = new URLSearchParams({ page: String(Number(query.get('page') ?? 0) + 1), limit: '50', sort: WM_SORT[query.get('sort') ?? 'ending'] ?? 'recent' });
    if (query.get('q')) p.set('q', query.get('q')!);
    query.getAll('rarity').forEach((r) => p.append('rarity', r));
    const r = await wmApi<{ auctions: WmLot[]; hasMore?: boolean }>('GET', `/marketplace?${p}`);
    // Their « ending soon » list starts with lots already over but not settled yet: not biddable.
    const live = r.auctions.filter((l) => l.status === 'active' && new Date(l.end_at).getTime() > Date.now());
    return { items: live.map((l) => mapLot(l, me)), hasMore: !!r.hasMore };
  }
  if (route === 'GET /market/mine') {
    const tab = query.get('tab') ?? 'selling';
    return { items: ((await wmMine())[tab] ?? []).map((l) => mapLot(l, me)), hasMore: false };
  }
  if (route === 'GET /market/summary') {
    const [slots, mineData] = await Promise.all([wmApi<{ sellingCount: number; maxConcurrentAuctions: number }>('GET', '/marketplace/mine'), wmMine().catch(() => ({}) as Record<string, WmLot[]>)]);
    const leading = (mineData.bidding ?? []).filter((l) => l.status === 'active' && l.current_bidder_id === me).length;
    return { selling: slots.sellingCount, leading, maxConcurrentAuctions: slots.maxConcurrentAuctions };
  }
  if (route === 'POST /market') {
    if (locks().has(String(b.userCardId))) throw fail(409, path, 'CARD_LOCKED', 'Carte verrouillée : mise en vente annulée.');
    mineCache = null;
    return wmApi('POST', '/marketplace', { card_id: b.userCardId, base_amount: b.baseAmount, duration_minutes: b.durationMinutes });
  }
  const one = path.match(/^\/market\/([0-9a-f-]{36})(\/bid|\/reprice|\/settle)?$/);
  if (one) {
    const [, id, action] = one;
    if (method === 'GET' && !action) {
      const d = await wmApi<{ auction: WmLot; bids?: { amount: number; placed_at?: string; created_at?: string; bidder?: WmUser }[] }>('GET', `/marketplace/${id}`);
      const at = serverTimes.get(`/marketplace/${id}`);
      return { ...mapLot(d.auction, me), bids: (d.bids ?? []).map((x) => ({ amount: x.amount, created_at: x.placed_at ?? x.created_at ?? '', username: x.bidder?.username ?? '?' })).sort((x, y) => y.amount - x.amount), server_time: at ? new Date(at).toISOString() : null };
    }
    mineCache = null;
    if (method === 'POST' && action === '/bid') return wmApi('POST', `/marketplace/${id}/bid`, { amount: b.amount });
    if (method === 'POST' && action === '/settle') return wmApi('POST', `/marketplace/${id}/settle`);
    if (method === 'POST' && action === '/reprice') return wmApi('POST', `/marketplace/${id}/reprice`, { new_base_amount: b.baseAmount });
    if (method === 'DELETE' && !action) return wmApi('DELETE', `/marketplace/${id}`);
  }
  throw fail(404, path, 'NOT_IN_EXTENSION', 'Indisponible dans Wikimasters Enhanced');
}

// ---- trades & friends: wiki-masters' /api/trades, /api/friends, /api/profile/:name/collection ----
type WmPerson = { id: string; username: string };
type WmTrade = {
  id: string;
  status: string;
  initiator_id: string;
  recipient_id: string;
  initiator?: WmPerson;
  recipient?: WmPerson;
  initiator_wikibidous: number;
  recipient_wikibidous: number;
  parent_trade_id?: string | null;
  created_at: string;
  updated_at?: string;
  items: { user_card_id: string; card_id: string; offered_by: string; is_shiny?: boolean; card?: WmCard }[];
};
// Their trade routes want the player's calendar time zone, like their own client sends.
const tz = () => ({ 'x-wiki-calendar-tz': Intl.DateTimeFormat().resolvedOptions().timeZone });

async function mapTrade(t: WmTrade) {
  const known = await cardsByIds(t.items.filter((i) => !i.card).map((i) => i.card_id));
  return {
    id: t.id,
    status: t.status,
    initiator: { id: t.initiator_id, username: t.initiator?.username ?? '?' },
    recipient: { id: t.recipient_id, username: t.recipient?.username ?? '?' },
    initiator_wb: t.initiator_wikibidous ?? 0,
    recipient_wb: t.recipient_wikibidous ?? 0,
    message: null,
    parent_trade_id: t.parent_trade_id ?? null,
    created_at: t.created_at,
    resolved_at: t.status === 'pending' ? null : (t.updated_at ?? null),
    items: t.items.flatMap((i) => {
      const card = i.card ? mapCard(i.card) : known.get(i.card_id);
      return card ? [{ offered_by: i.offered_by, card, is_shiny: !!(i.is_shiny ?? (i.card as { is_shiny?: boolean } | undefined)?.is_shiny), quantity: 1, user_card_id: i.user_card_id }] : [];
    }),
  };
}

async function socialRoute(method: string, path: string, query: URLSearchParams, b: Record<string, unknown>): Promise<unknown> {
  const me = (await getAuth()).userId;
  const route = `${method} ${path}`;
  if (route === 'GET /trades') {
    const box = query.get('box') ?? 'active';
    const r = await wmApi<{ trades: WmTrade[] }>('GET', '/trades');
    const items = await Promise.all(r.trades.filter((t) => (box === 'active') === (t.status === 'pending')).map(mapTrade));
    return { items: items.sort((x, y) => y.created_at.localeCompare(x.created_at)), hasMore: false };
  }
  if (route === 'POST /trades') {
    const side = (xs: unknown, by: string) => ((xs as { userCardId: string; cardId?: string }[]) ?? []).map((i) => ({ user_card_id: i.userCardId, card_id: i.cardId, offered_by: by }));
    const items = [...side(b.give, me), ...side(b.take, String(b.recipientId))];
    if (items.some((i) => !i.card_id)) throw fail(400, path, 'BAD_ITEMS', 'Carte inconnue dans l’offre');
    if (items.some((i) => i.offered_by === me && locks().has(i.user_card_id))) throw fail(409, path, 'CARD_LOCKED', 'Carte verrouillée : offre annulée.');
    return wmApi('POST', '/trades', { recipient_id: b.recipientId, items, initiator_wikibidous: b.giveWb ?? 0, recipient_wikibidous: b.takeWb ?? 0, parent_trade_id: b.parentTradeId }, tz());
  }
  const one = path.match(/^\/trades\/([0-9a-f-]{36})$/);
  if (one && method === 'PATCH') return wmApi('PATCH', `/trades/${one[1]}`, { action: b.action }, tz());
  if (route === 'GET /players') {
    const r = await wmApi<{ users?: WmPerson[] }>('GET', `/friends/search?q=${encodeURIComponent(query.get('q') ?? '')}`);
    return (r.users ?? []).map((u) => ({ id: u.id, username: u.username }));
  }
  const coll = path.match(/^\/players\/id\/([0-9a-f-]{36})\/cards$/);
  if (coll && method === 'GET') {
    const name = query.get('username') ?? '';
    const p = new URLSearchParams({ page: query.get('page') ?? '0', stats: '0' });
    if (query.get('q')) p.set('q', query.get('q')!);
    const r = await wmApi<{ collection?: { id: string; card: WmCard; count?: number; is_shiny?: boolean }[] }>('GET', `/profile/${encodeURIComponent(name)}/collection?${p}`);
    const list = r.collection ?? [];
    return {
      items: list.map((i) => {
        const card = mapCard(i.card);
        cards.set(card.id, card);
        return { id: i.id, card, is_shiny: !!i.is_shiny, count: i.count ?? 1 };
      }),
      hasMore: list.length >= 50,
    };
  }
  throw fail(404, path, 'NOT_IN_EXTENSION', 'Indisponible dans Wikimasters Enhanced');
}

// ---- friends, messages, profiles, showcase, notifications, achievements, catalogue, guilds, tags ----
// wiki-masters' /api routes and Supabase tables, mapped to the shapes the screens use.

type Friendship = { id: string; status: string; requester_id: string; addressee_id: string; requester: WmPerson & { avatar_url?: string | null }; addressee: WmPerson & { avatar_url?: string | null }; created_at: string };
let friendships: Friendship[] = [];
async function loadFriendships() {
  friendships = (await wmApi<{ friendships: Friendship[] }>('GET', '/friends')).friendships ?? [];
  return friendships;
}
const SHOWCASE_SLOTS = 4;
let lastCheck = 0;
/** Friends owning each card, as the catalogue pages report them. */
const friendOwners = new Map<string, string[]>();
type WmShowcase = { showcase: { position: number; user_card_id?: string; user_card: { id: string; card: WmCard; is_shiny?: boolean } }[] };
type WmNotification = { id: string; type: string; data?: Record<string, unknown>; read?: boolean; created_at: string };
type WmAchievement = { id: string; title: string; description: string; wikibidous_reward?: number; sort_order?: number };
type WmGuildMessage = { id: string; user_id: string; content: string; created_at: string; username?: string; user?: { username?: string }; profile?: { username?: string } };

async function moreRoute(method: string, path: string, query: URLSearchParams, b: Record<string, unknown>): Promise<unknown> {
  const me = (await getAuth()).userId;
  const route = `${method} ${path}`;

  // friends
  if (route === 'GET /friends') {
    const all = await loadFriendships();
    const other = (f: Friendship) => (f.requester_id === me ? f.addressee : f.requester);
    return {
      friends: all.filter((f) => f.status === 'accepted').map((f) => ({ id: other(f).id, username: other(f).username, online: false, last_seen_at: null, since: f.created_at })).sort((x, y) => x.username.localeCompare(y.username)),
      incoming: all.filter((f) => f.status === 'pending' && f.addressee_id === me).map((f) => ({ id: f.requester.id, username: f.requester.username, requestId: f.id, at: f.created_at })),
      outgoing: all.filter((f) => f.status === 'pending' && f.requester_id === me).map((f) => ({ id: f.addressee.id, username: f.addressee.username, requestId: f.id, at: f.created_at })),
    };
  }
  if (route === 'POST /friends/requests') {
    const name = String(b.username ?? '');
    const r = await wmApi<{ users?: WmPerson[] }>('GET', `/friends/search?q=${encodeURIComponent(name)}`);
    const u = (r.users ?? []).find((x) => x.username.toLowerCase() === name.toLowerCase());
    if (!u) throw fail(404, path, 'NOT_FOUND', 'Joueur introuvable');
    return wmApi('POST', '/friends', { addressee_id: u.id });
  }
  if (route === 'POST /friends/requests/accept-all') return wmApi('POST', '/friends/accept-all');
  const req = path.match(/^\/friends\/requests\/([0-9a-f-]{36})$/);
  if (req && method === 'POST') {
    if (!friendships.length) await loadFriendships();
    const f = friendships.find((x) => x.id === req[1]);
    // My own request: withdraw it; one I received: accept or decline.
    if (f?.requester_id === me) return wmApi('DELETE', `/friends/${req[1]}`);
    return wmApi('PATCH', `/friends/${req[1]}`, { action: b.accept ? 'accept' : 'decline' });
  }
  const unfriend = path.match(/^\/friends\/([0-9a-f-]{36})$/);
  if (unfriend && method === 'DELETE') {
    const f = (await loadFriendships()).find((x) => x.status === 'accepted' && (x.requester_id === unfriend[1] || x.addressee_id === unfriend[1]));
    if (!f) throw fail(404, path, 'NOT_FOUND', 'Ami introuvable');
    return wmApi('DELETE', `/friends/${f.id}`);
  }

  // a player's profile, my showcase, my profile settings
  const player = path.match(/^\/players\/([^/]+)$/);
  if (player && method === 'GET') {
    const enc = player[1]!;
    const p = await wmApi<{ profile: { id: string; username: string; avatar_url?: string | null; is_public: boolean; created_at: string; bio?: string | null }; isOwn: boolean; isFriend: boolean; lastSeenAt?: string | null }>('GET', `/profile/${enc}`);
    const pr = p.profile;
    const hidden = !pr.is_public && !p.isOwn && !p.isFriend;
    const [show, stats] = hidden
      ? [null, null]
      : await Promise.all([
          wmApi<WmShowcase>('GET', `/profile/${enc}/showcase`).catch(() => null),
          wmApi<{ total?: number; rarityCounts?: Partial<Record<Rarity, number>> }>('GET', `/profile/${enc}/collection?page=0&stats=1`).catch(() => null),
        ]);
    if (!friendships.length && !p.isOwn) await loadFriendships().catch(() => []);
    const pending = friendships.find((f) => f.status === 'pending' && (f.requester_id === pr.id || f.addressee_id === pr.id));
    const counts = stats?.rarityCounts ?? {};
    return {
      id: pr.id,
      username: pr.username,
      avatar: pr.avatar_url ? { user_card_id: '', is_shiny: false, card: { image_url: pr.avatar_url } } : null,
      relation: p.isOwn ? 'self' : p.isFriend ? 'friends' : pending ? (pending.requester_id === me ? 'outgoing' : 'incoming') : 'none',
      online: false,
      created_at: pr.created_at,
      private: hidden || undefined,
      bio: pr.bio ?? null,
      last_seen_at: p.lastSeenAt ?? null,
      stats: stats ? { unique: stats.total ?? 0, by_rarity: Object.fromEntries((['L', 'UR', 'SR', 'R', 'PC', 'C'] as Rarity[]).map((r) => [r, { unique: counts[r] ?? 0, copies: 0 }])) } : undefined,
      showcase: Array.from({ length: SHOWCASE_SLOTS }, (_, i) => {
        const e = show?.showcase.find((x) => x.position === i);
        if (!e) return null;
        const card = mapCard(e.user_card.card);
        cards.set(card.id, card);
        return { user_card_id: e.user_card.id, is_shiny: !!e.user_card.is_shiny, card };
      }),
    };
  }
  if (route === 'GET /me/showcase') {
    const s = await wmApi<WmShowcase>('GET', '/showcase');
    return { slots: Array.from({ length: SHOWCASE_SLOTS }, (_, i) => s.showcase.find((e) => e.position === i)?.user_card.id ?? null) };
  }
  if (route === 'PUT /me/showcase') {
    const next = (b.slots as (string | null)[]) ?? [];
    const s = await wmApi<WmShowcase>('GET', '/showcase');
    for (let i = 0; i < SHOWCASE_SLOTS; i++) {
      const cur = s.showcase.find((e) => e.position === i)?.user_card.id ?? null;
      const want = next[i] ?? null;
      if (cur === want) continue;
      if (want) await wmApi('PUT', '/showcase', { position: i, user_card_id: want });
      else await wmApi('DELETE', '/showcase', { position: i });
    }
    return { slots: next };
  }
  if (route === 'PATCH /me') {
    const name = (await loadProfile()).username ?? '';
    const body: Record<string, unknown> = {};
    if (typeof b.isPublic === 'boolean') body.is_public = b.isPublic;
    if ('bio' in b) body.bio = b.bio;
    if (b.avatarUserCardId) body.avatar_user_card_id = b.avatarUserCardId;
    const r = await wmApi('PATCH', `/profile/${encodeURIComponent(name)}`, body);
    await loadProfile(true).catch(() => {});
    return r;
  }

  // messages
  if (route === 'GET /dms') {
    const r = await wmApi<{ conversations: { peer_id: string; peer_username: string; last_message: string; last_message_at: string; unread_count: number }[] }>('GET', '/chat');
    return (r.conversations ?? []).map((c) => ({ peer: { id: c.peer_id, username: c.peer_username, online: false }, last: { id: '', from: '', body: c.last_message, created_at: c.last_message_at }, unread: c.unread_count ?? 0 }));
  }
  const dm = path.match(/^\/dms\/([0-9a-f-]{36})(\/read)?$/);
  if (dm) {
    const peer = dm[1]!;
    const mapMsg = (m: { id: string; sender_id: string; recipient_id: string; content: string; read?: boolean; created_at: string }) => ({ id: m.id, from: m.sender_id, to: m.recipient_id, body: m.content, read: !!m.read, created_at: m.created_at });
    if (method === 'GET' && !dm[2]) return ((await wmApi<{ messages: Parameters<typeof mapMsg>[0][] }>('GET', `/chat/${peer}`)).messages ?? []).map(mapMsg);
    if (method === 'POST' && dm[2]) {
      await rest(`/chat_messages?sender_id=eq.${peer}&recipient_id=eq.${me}&read=eq.false`, { method: 'PATCH', body: JSON.stringify({ read: true }), headers: { prefer: 'return=minimal' } }).catch(() => {});
      return {};
    }
    if (method === 'POST') {
      const r = await wmApi<{ message?: Parameters<typeof mapMsg>[0] }>('POST', `/chat/${peer}`, { content: b.body });
      return r.message ? mapMsg(r.message) : { id: `local-${Date.now()}`, from: me, to: peer, body: String(b.body), read: false, created_at: new Date().toISOString() };
    }
  }

  // notifications (their types and data, shown as they come)
  if (route === 'GET /notifications') {
    const r = await wmApi<{ notifications: WmNotification[] }>('GET', '/notifications');
    return { items: (r.notifications ?? []).map((n) => ({ id: n.id, type: n.type, data: n.data ?? {}, read: !!n.read, created_at: n.created_at })) };
  }
  if (route === 'POST /notifications/read') return wmApi('PATCH', '/notifications', Array.isArray(b.ids) ? { ids: b.ids } : {});

  // achievements: one tier each (their achievements pay once)
  if (route === 'GET /achievements') {
    const [{ data: defs }, { data: mine }] = await Promise.all([rest<WmAchievement[]>('/achievements?select=*'), rest<{ achievement_id: string; claimed_at?: string | null }[]>(`/user_achievements?select=achievement_id,claimed_at&user_id=eq.${me}`)]);
    // Their server re-checks progress on demand (slow): ask now and then, the next load shows it.
    if (Date.now() - lastCheck > 5 * 60_000) {
      lastCheck = Date.now();
      void wmApi('POST', '/achievements/check', { event: 'achievements_sync' }).catch(() => {});
    }
    const got = new Map(mine.map((u) => [u.achievement_id, u]));
    return defs
      .sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
      .map((a) => {
        const u = got.get(a.id);
        const claimable = !!u && !u.claimed_at;
        return { id: a.id, label: a.title, description: a.description, progress: u ? 1 : 0, claimable, tiers: [{ tier: 1, at: 1, reward: a.wikibidous_reward ?? 0, claimed: !!u?.claimed_at, claimable }] };
      });
  }
  const claim = path.match(/^\/achievements\/([^/]+)\/claim$/);
  if (claim && method === 'POST') {
    const before = (await wmApi<{ balance: number }>('GET', '/wikibidous')).balance;
    await wmApi('POST', '/achievements/claim', { achievement_id: claim[1] });
    const balance = (await wmApi<{ balance: number }>('GET', '/wikibidous')).balance;
    return { gained: Math.max(0, balance - before), balance };
  }
  if (path.startsWith('/leaderboard/')) return { board: 'score', updated_at: null, total: 0, me: null, items: [], maintenance: true };

  // catalogue
  if (route === 'GET /cards' || path.startsWith('/cards/pool/')) {
    const p = new URLSearchParams({ page: query.get('page') ?? '0', sort: 'rarity' });
    if (query.get('q')) p.set('q', query.get('q')!);
    query.getAll('rarity').forEach((r) => p.append('rarity', r));
    const r = await wmApi<{ cards: WmCard[]; total: number | null; searchHasMore?: boolean; rarityCounts?: Partial<Record<Rarity, number>>; friendOwners?: Record<string, ({ username: string } | string)[]> }>('GET', `/cards?${p}`);
    for (const [cid, owners] of Object.entries(r.friendOwners ?? {})) friendOwners.set(cid, owners.map((o) => (typeof o === 'string' ? o : o.username)));
    if (path.startsWith('/cards/pool/')) return r.rarityCounts ?? {};
    const items = (r.cards ?? []).map((c) => {
      const card = mapCard(c);
      cards.set(card.id, card);
      return card;
    });
    const page = Number(query.get('page') ?? 0);
    return { items, hasMore: r.searchHasMore ?? (r.total != null ? (page + 1) * 50 < r.total : items.length >= 50) };
  }

  // battles: their routes, actions and shapes; card data added for the decks
  if (route === 'GET /battles') return wmApi('GET', '/battles');
  if (route === 'POST /battles') return wmApi('POST', '/battles', { opponent_id: b.opponent_id });
  const battle = path.match(/^\/battles\/([0-9a-f-]{36})$/);
  if (battle && method === 'GET') {
    const d = await wmApi<{ battle: unknown; decks?: { user_id: string; card_ids: string[] }[] }>('GET', `/battles/${battle[1]}`);
    const ids = (d.decks ?? []).flatMap((k) => k.card_ids);
    return { ...d, decks: d.decks ?? [], cards: [...(await cardsByIds(ids)).values()] };
  }
  if (battle && method === 'PATCH') return wmApi('PATCH', `/battles/${battle[1]}`, b);

  // wishlist (their `wishlist_items` table), friends owning a card (seen in catalogue pages), reports
  if (route === 'GET /wishlist') {
    const { data } = await rest<{ card_id: string }[]>(`/wishlist_items?select=card_id&user_id=eq.${me}&order=created_at.desc`);
    const byId = await cardsByIds(data.map((w) => w.card_id));
    return { items: data.flatMap((w) => (byId.has(w.card_id) ? [byId.get(w.card_id)!] : [])) };
  }
  const wish = path.match(/^\/wishlist\/([0-9a-f-]{36})$/);
  if (wish && method === 'PUT') return (await rest('/wishlist_items', { method: 'POST', body: JSON.stringify({ user_id: me, card_id: wish[1] }), headers: { prefer: 'resolution=ignore-duplicates,return=minimal' } }), { ok: true });
  if (wish && method === 'DELETE') return (await rest(`/wishlist_items?user_id=eq.${me}&card_id=eq.${wish[1]}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }), { ok: true });
  const owners = path.match(/^\/cards\/([0-9a-f-]{36})\/friends$/);
  if (owners) {
    const names = friendOwners.get(owners[1]!) ?? [];
    if (!names.length) return [];
    if (!friendships.length) await loadFriendships().catch(() => []);
    const people = friendships.filter((f) => f.status === 'accepted').map((f) => (f.requester_id === me ? f.addressee : f.requester));
    return names.map((n) => people.find((x) => x.username === n) ?? { id: '', username: n }).filter((x) => x.id);
  }
  if (route === 'GET /reports') return wmApi('GET', `/reports?reportedUserId=${encodeURIComponent(query.get('reportedUserId') ?? '')}`);
  if (route === 'POST /reports') return wmApi('POST', '/reports', b);

  // guilds: their routes and bodies, except the chat and invites
  if (path.startsWith('/guilds')) {
    if (route === 'GET /guilds') {
      const [g, n] = await Promise.all([wmApi<Record<string, unknown>>('GET', '/guilds'), wmApi<{ notifications: WmNotification[] }>('GET', '/notifications').catch(() => ({ notifications: [] }))]);
      const invites = (n.notifications ?? []).filter((x) => /guild/i.test(x.type) && typeof x.data?.guild_id === 'string').map((x) => ({ guild_id: x.data!.guild_id as string, guild_name: String(x.data!.guild_name ?? x.data!.title ?? 'Guilde') }));
      return { ...g, invites };
    }
    if (route === 'GET /guilds/chat') {
      const r = await wmApi<{ messages?: WmGuildMessage[] }>('GET', '/guilds/chat');
      return (r.messages ?? []).map((m) => ({ id: m.id, body: m.content, system: false, created_at: m.created_at, user: { id: m.user_id, username: m.username ?? m.user?.username ?? m.profile?.username ?? '?' } }));
    }
    if (route === 'POST /guilds/chat') {
      const r = await wmApi<{ message?: WmGuildMessage }>('POST', '/guilds/chat', { content: b.content });
      const m = r.message;
      return { id: m?.id ?? `local-${Date.now()}`, body: String(b.content), system: false, created_at: m?.created_at ?? new Date().toISOString(), user: { id: me, username: (await loadProfile()).username ?? 'Moi' } };
    }
    return wmApi(method, `${path}${query.toString() ? `?${query}` : ''}`, method === 'GET' ? undefined : b);
  }

  // tags (Supabase, like their own client)
  if (route === 'POST /collection/tags') {
    const { data } = await rest<{ id: string; name: string; color: string | null }[]>('/tags', { method: 'POST', body: JSON.stringify({ user_id: me, name: b.name, color: b.color ?? null }), headers: { prefer: 'return=representation' } });
    return data[0];
  }
  const tagged = path.match(/^\/collection\/tags\/([0-9a-f-]{36})\/cards$/);
  if (tagged && method === 'POST') {
    await tagCards(tagged[1]!, (b.userCardIds as string[]) ?? [], !!b.on);
    return {};
  }
  throw fail(404, path, 'NOT_IN_EXTENSION', 'Indisponible dans Wikimasters Enhanced');
}

const MORE = /^\/(battles|wishlist|reports|cards\/[0-9a-f-]{36}\/friends|friends|players\/(?!id\/)[^/]+$|me\/showcase|dms|notifications|achievements|leaderboard|guilds|collection\/tags|cards\/pool)/;

export const wmBackend: Backend = {
  prepare(method, path, body) {
    const bid = path.match(/^\/market\/([0-9a-f-]{36})\/bid$/);
    if (method !== 'POST' || !bid) return null;
    return { url: `${ORIGIN}/api/marketplace/${bid[1]}/bid`, init: { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount: (body as { amount: number }).amount }) } };
  },

  async session(): Promise<Session | null> {
    const a = await bg('wm-session');
    auth = a;
    if (!a) return null;
    const p = await loadProfile(true).catch(() => ({}) as WmProfile);
    return { accessToken: 'wiki-masters', user: { id: a.userId, email: '', username: p.username ?? 'joueur', role: 'player', emailVerified: true } };
  },

  async request(method, path, body) {
    const route = `${method} ${path.split('?')[0]}`;
    const b = (body ?? {}) as Record<string, unknown>;
    switch (route) {
      case 'GET /me': {
        const a = await getAuth();
        const p = await loadProfile(true);
        return { id: a.userId, username: p.username, avatar_url: p.avatar_url ?? null, tier: p.is_vip ? 'vip' : p.is_pro ? 'pro' : 'free', lang: 'fr' };
      }
      case 'GET /packs':
        return packState(await loadProfile());
      case 'GET /wallet':
        return { balance: (await wmApi<{ balance: number }>('GET', '/wikibidous')).balance };
      case 'GET /collection':
        return collection();
      case 'POST /cards/batch':
        return [...(await cardsByIds((b.ids as string[]) ?? [])).values()];
      case 'POST /packs/open':
        return openPack();
      case 'GET /packs/pro-daily':
        return wmApi('GET', '/packs/pro-daily');
      case 'POST /packs/pro-daily':
        return wmApi('POST', '/packs/pro-daily', undefined, tz());
      case 'GET /packs/special':
        return wmApi('GET', '/packs/special');
      case 'POST /packs/special':
        return wmApi('POST', '/packs/special', { packId: b.packId });
      case 'GET /packs/history':
        return readJson<History>(HISTORY, []);
      case 'PATCH /collection/flags': {
        const ids = (b.userCardIds as string[]) ?? [];
        if (typeof b.locked === 'boolean' && ids.length) {
          await tagCards(await ensureLockTag(), ids, b.locked);
          ids.forEach((id) => (b.locked ? lockedNow.add(id) : lockedNow.delete(id)));
          // The tag is the lock now: forget this browser's old copy of these.
          const local = new Set(readJson<string[]>(LOCKS, []));
          ids.forEach((id) => local.delete(id));
          localStorage.setItem(LOCKS, JSON.stringify([...local]));
        }
        if (typeof b.starred === 'boolean' && ids.length)
          await rest(`/user_cards?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ starred: b.starred }), headers: { prefer: 'return=minimal' } });
        return {};
      }
      case 'POST /collection/discard': {
        const l = locks();
        const ids = ((b.items as { userCardId: string }[]) ?? []).map((i) => i.userCardId).filter((id) => !l.has(id));
        const before = (await wmApi<{ balance: number }>('GET', '/wikibidous')).balance;
        if (ids.length) await wmApi('POST', '/user-cards/bulk-discard', { card_ids: ids });
        const balance = (await wmApi<{ balance: number }>('GET', '/wikibidous')).balance;
        return { gained: Math.max(0, balance - before), balance };
      }
    }
    const bare = path.split('?')[0]!;
    if (MORE.test(bare) || route === 'PATCH /me' || route === 'GET /cards') return moreRoute(method, bare, new URLSearchParams(path.split('?')[1] ?? ''), b);
    if (/^\/(trades|players)/.test(path)) return socialRoute(method, path.split('?')[0]!, new URLSearchParams(path.split('?')[1] ?? ''), b);
    if (path.startsWith('/market')) return marketRoute(method, path.split('?')[0]!, new URLSearchParams(path.split('?')[1] ?? ''), b);
    const card = route.match(/^GET \/cards\/([0-9a-f-]{36})$/);
    if (card) return summary(card[1]!);
    throw fail(404, path, 'NOT_IN_EXTENSION', 'Indisponible dans Wikimasters Enhanced');
  },
};
