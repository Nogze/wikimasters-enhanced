import { createStore, getMany, setMany } from 'idb-keyval';
import type { Card } from './types';

// « Images manquantes »: a picture for cards that have none, looked up on Wikimedia (Commons files
// only), an approach from WikiMasters Extended (MIT):
//   1. Wikidata image properties of the article's item, in a fixed order (P18 image first); for an
//      episode or a season, the image of the series it belongs to;
//   2. otherwise a file the article itself uses: named after the article, « <titre> logo/affiche… »,
//      or the article's free lead picture;
//   3. only files hosted on Commons (never a wiki's local fair-use uploads).
// Requests go straight to Wikimedia without cookies. Results are cached in IndexedDB.

type Kind = 'picture' | 'emblem';
type Entry = { at: number; url: string | null };

const FOUND_TTL = 30 * 86_400_000;
const NOT_FOUND_TTL = 7 * 86_400_000;
const ARTICLE_BATCH = 20;
const ENTITY_BATCH = 50;
const THUMB_WIDTH = 500;
const PROPERTIES: [string, Kind][] = [
  ['P18', 'picture'],
  ['P154', 'emblem'],
  ['P3383', 'picture'],
  ['P41', 'emblem'],
  ['P94', 'emblem'],
  ['P2716', 'picture'],
];
const SERIES_LINKS = ['P179', 'P3450'];
const QUALIFIERS = ['logo', 'logotype', 'affiche', 'poster', 'cover', 'couverture', 'banner', 'titre', 'title'];
const PREF = 'wme-wiki-images';

const idb = createStore('wme-wikiimg-v1', 'images');
const results = new Map<string, string | null>();

export function wikiImagesEnabled() {
  try {
    return localStorage.getItem(PREF) !== '0';
  } catch {
    return true;
  }
}
export function setWikiImagesEnabled(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? '1' : '0');
  } catch {
    /* private mode */
  }
}

const articleTitle = (c: Card) => {
  const path = c.wikipedia_url.split('/wiki/')[1];
  return path ? decodeURIComponent(path).replace(/_/g, ' ') : c.title;
};
const stripParen = (t: string) => /^(.+) \([^()]*\)$/.exec(t)?.[1] ?? t;
const baseName = (f: string) => (f.lastIndexOf('.') === -1 ? f : f.slice(0, f.lastIndexOf('.')));
const ext = (f: string) => f.slice(f.lastIndexOf('.') + 1).toLowerCase();
const okFileName = (f: unknown): f is string => typeof f === 'string' && f.length > 0 && f.length < 250 && !/[|#<>[\]{}]/.test(f);

async function api(host: string, params: Record<string, string>) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', origin: '*', ...params });
  const res = await fetch(`https://${host}/w/api.php?${qs}`, { credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(`${host} ${res.status}`);
  return res.json();
}

type Article = { qid?: string; disambiguation: boolean; files: string[]; lead?: string };

async function fetchArticles(host: string, titles: string[]): Promise<Map<string, Article>> {
  const out = new Map<string, Article>();
  for (let i = 0; i < titles.length; i += ARTICLE_BATCH) {
    const batch = titles.slice(i, i + ARTICLE_BATCH);
    const j = await api(host, { action: 'query', redirects: '1', prop: 'pageprops|images', ppprop: 'wikibase_item|disambiguation|page_image_free', imlimit: 'max', titles: batch.join('|') });
    const alias = new Map<string, string>();
    for (const n of [...(j.query?.normalized ?? []), ...(j.query?.redirects ?? [])]) alias.set(n.from, n.to);
    const pages = new Map<string, { pageprops?: Record<string, string>; images?: { title: string }[] }>();
    for (const p of j.query?.pages ?? []) pages.set(p.title, p);
    for (const t of batch) {
      let answered = t;
      for (let k = 0; k < 3 && alias.has(answered); k++) answered = alias.get(answered)!;
      const p = pages.get(answered);
      if (!p) continue;
      out.set(t, {
        qid: p.pageprops?.wikibase_item,
        disambiguation: p.pageprops ? 'disambiguation' in p.pageprops : false,
        files: (p.images ?? []).map((im) => im.title.replace(/^[^:]+:/, '')),
        lead: p.pageprops?.page_image_free?.replace(/_/g, ' '),
      });
    }
  }
  return out;
}

type Claims = Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
async function fetchClaims(qids: string[]): Promise<Map<string, Claims>> {
  const out = new Map<string, Claims>();
  for (let i = 0; i < qids.length; i += ENTITY_BATCH) {
    const j = await api('www.wikidata.org', { action: 'wbgetentities', props: 'claims', ids: qids.slice(i, i + ENTITY_BATCH).join('|') });
    for (const [id, e] of Object.entries<{ claims?: Claims }>(j.entities ?? {})) out.set(id, e.claims ?? {});
  }
  return out;
}
const firstValue = (claims: Claims | undefined, prop: string) => claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
function fromClaims(claims: Claims | undefined, props = PROPERTIES): string | null {
  for (const [p] of props) {
    const v = firstValue(claims, p);
    if (okFileName(v)) return v;
  }
  return null;
}
function fromArticle(title: string, a: Article): string[] {
  if (a.disambiguation) return [];
  const t = stripParen(title);
  const out: string[] = [];
  const exact = a.files.find((f) => baseName(f) === t);
  if (exact) out.push(exact);
  const qualified = a.files.find((f) => {
    const b = baseName(f);
    return b.startsWith(`${t} `) && QUALIFIERS.includes(b.slice(t.length + 1).toLowerCase());
  });
  if (qualified) out.push(qualified);
  if (a.lead && a.files.includes(a.lead)) out.push(a.lead);
  return out.filter(okFileName).filter((f) => ext(f) !== 'svg' || out.length === 1);
}

/** Thumbnails of files hosted on Commons ("shared"); local files are refused. */
async function fetchThumbs(host: string, files: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(files)];
  for (let i = 0; i < unique.length; i += 50) {
    const batch = unique.slice(i, i + 50);
    const j = await api(host, { action: 'query', prop: 'imageinfo', iiprop: 'url', iiurlwidth: String(THUMB_WIDTH), titles: batch.map((f) => `File:${f}`).join('|') });
    const alias = new Map<string, string>();
    for (const n of j.query?.normalized ?? []) alias.set(n.from, n.to);
    const pages = new Map<string, { imagerepository?: string; imageinfo?: { thumburl?: string }[] }>();
    for (const p of j.query?.pages ?? []) pages.set(p.title, p);
    for (const f of batch) {
      const p = pages.get(alias.get(`File:${f}`) ?? `File:${f}`);
      const url = p?.imageinfo?.[0]?.thumburl;
      if (p?.imagerepository === 'shared' && typeof url === 'string' && /^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(url)) out.set(f, url);
    }
  }
  return out;
}

async function resolveBatch(cards: Card[]) {
  const byHost = new Map<string, Card[]>();
  for (const c of cards) {
    const host = `${c.lang || 'fr'}.wikipedia.org`;
    byHost.set(host, [...(byHost.get(host) ?? []), c]);
  }
  for (const [host, list] of byHost) {
    const byTitle = new Map(list.map((c) => [articleTitle(c), c]));
    const articles = await fetchArticles(host, [...byTitle.keys()]);
    const qids = [...new Set([...articles.values()].map((a) => a.qid).filter((q): q is string => !!q))];
    const claims = await fetchClaims(qids);
    const parentOf = new Map<string, string>();
    for (const [qid, c] of claims) {
      if (fromClaims(c)) continue;
      const parent = SERIES_LINKS.map((p) => firstValue(c, p)).find((v) => typeof v === 'object' && v && 'id' in v) as { id: string } | undefined;
      if (parent?.id) parentOf.set(qid, parent.id);
    }
    const parentClaims = parentOf.size ? await fetchClaims([...new Set(parentOf.values())]) : new Map<string, Claims>();
    const candidates = new Map<string, string[]>();
    for (const [title, card] of byTitle) {
      const a = articles.get(title);
      const files: string[] = [];
      if (a?.qid) {
        const own = fromClaims(claims.get(a.qid));
        if (own) files.push(own);
        else {
          const parent = parentOf.get(a.qid);
          const inherited = parent ? fromClaims(parentClaims.get(parent), PROPERTIES.filter(([p]) => p === 'P18' || p === 'P154')) : null;
          if (inherited) files.push(inherited);
        }
      }
      if (a && !files.length) files.push(...fromArticle(title, a));
      candidates.set(card.id, files);
    }
    const thumbs = await fetchThumbs(host, [...candidates.values()].flat());
    const entries: [string, Entry][] = [];
    for (const card of list) {
      const file = (candidates.get(card.id) ?? []).find((f) => thumbs.has(f));
      const url = file ? thumbs.get(file)! : null;
      results.set(card.id, url);
      entries.push([card.id, { at: Date.now(), url }]);
    }
    await setMany(entries, idb).catch(() => {});
  }
}

// Requests are gathered for a moment and resolved in batches (a page of cards at once).
const waiting = new Map<string, { card: Card; resolve: (url: string | null) => void }[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
async function flush() {
  timer = null;
  const batch = [...waiting.values()].slice(0, ARTICLE_BATCH * 3);
  for (const b of batch) waiting.delete(b[0]!.card.id);
  if (waiting.size) timer = setTimeout(flush, 50);
  try {
    await resolveBatch(batch.map((b) => b[0]!.card));
  } catch (e) {
    console.warn('[wiki-images]', e);
  }
  for (const b of batch) for (const w of b) w.resolve(results.get(w.card.id) ?? null);
}

/** A Commons picture for a card that has none (null when none is found or the option is off). */
export async function findWikiImage(card: Card): Promise<string | null> {
  if (!wikiImagesEnabled() || card.image_url || card.sensitive || !card.wikipedia_url) return null;
  if (results.has(card.id)) return results.get(card.id)!;
  const [cached] = await getMany<Entry | undefined>([card.id], idb).catch(() => [undefined]);
  if (cached && Date.now() - cached.at < (cached.url ? FOUND_TTL : NOT_FOUND_TTL)) {
    results.set(card.id, cached.url);
    return cached.url;
  }
  return new Promise((resolve) => {
    waiting.set(card.id, [...(waiting.get(card.id) ?? []), { card, resolve }]);
    timer ??= setTimeout(flush, 120);
  });
}
