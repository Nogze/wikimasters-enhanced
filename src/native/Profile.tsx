import { useCallback, useEffect, useMemo, useState } from 'react';
import { patchProfile, syncProfile, useAccount } from '../lib/account';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { rememberCards } from '../lib/cardCache';
import { loadCollection, useOwnedCounts, type Item } from '../lib/collection';
import { fmt, RARITY_ORDER, RARITY_STYLE } from '../lib/rarity';
import { linkClick, navigate, setQuery, useQuery } from '../lib/router';
import { partnerCards, type PartnerCard } from '../lib/trades';
import type { Card, Rarity } from '../lib/types';
import { CardGrid, savedSize, type CardSize } from './CardGrid';
import { norm, SizeButtons } from './Collection';
import { ago, Avatar, CardInfoPanel, CardStrip, href, Loading } from './common';
import { BigCard, Modal, Panel, PanelPlaceholder, SearchField, useToast } from './kit';
import { addFriend } from './Social';

// Profiles: mine (avatar, bio, visibility, showcase to arrange) and other players' (showcase,
// collection, friend / message / trade actions).

type Stats = { score?: number; unique: number; copies?: number; shiny?: number; by_rarity?: Record<Rarity, { unique: number; copies: number }>; packs_opened?: number; auctions_sold?: number };
type Shown = { user_card_id: string; is_shiny: boolean; card: Card } | null;
type Player = {
  id: string;
  username: string;
  avatar: Shown;
  relation: 'self' | 'friends' | 'incoming' | 'outgoing' | 'none';
  online: boolean;
  created_at: string;
  private?: boolean;
  bio?: string | null;
  last_seen_at?: string | null;
  stats?: Stats;
  showcase?: Shown[];
};

function StatsLine({ stats, since, extra }: { stats?: Stats; since?: string; extra?: string | null }) {
  return (
    <span className="muted num">
      {[stats ? `${fmt(stats.unique)} cartes${stats.score != null ? ` · ${fmt(stats.score)} points` : ''}` : null, stats?.packs_opened != null ? `${fmt(stats.packs_opened)} paquets · ${fmt(stats.auctions_sold ?? 0)} ventes` : null, since ? `depuis ${since}` : null, extra]
        .filter(Boolean)
        .join(' · ')}
    </span>
  );
}

function RarityCounts({ stats }: { stats?: Stats }) {
  if (!stats?.by_rarity) return null;
  return (
    <div className="chips">
      {RARITY_ORDER.map((r) => (
        <span key={r} className="chip static" title={RARITY_STYLE[r].label}>
          <span className="dot" style={{ background: RARITY_STYLE[r].color }} />
          {r}
          <span className="n">{fmt(stats.by_rarity![r]?.unique ?? 0)}</span>
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- mine

type Picking = { kind: 'slot'; slot: number } | { kind: 'avatar' } | null;

export function ProfileScreen() {
  const { profile } = useAccount();
  const [items, setItems] = useState<Item[] | null>(null);
  const [slots, setSlots] = useState<(string | null)[] | null>(null);
  const [stats, setStats] = useState<Stats | undefined>(undefined);
  const [bio, setBio] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [size, setSize] = useState<CardSize>(savedSize);
  const [toast, setToast] = useToast();

  const loadShowcase = useCallback(() => {
    apiGet<{ slots: (string | null)[] }>('/me/showcase', { force: true })
      .then((s) => setSlots(s.slots))
      .catch(() => setSlots([]));
  }, []);
  useEffect(() => {
    loadCollection(false).then((c) => setItems(c.items), () => setItems([]));
    loadShowcase();
  }, [loadShowcase]);
  useEffect(() => {
    if (!profile?.username) return;
    apiGet<Player>(`/players/${encodeURIComponent(profile.username)}`, { ttl: 60_000 })
      .then((p) => setStats(p.stats))
      .catch(() => {});
  }, [profile?.username]);
  useEffect(() => setBio(profile?.bio ?? ''), [profile?.bio]);

  const byId = useMemo(() => new Map((items ?? []).map((i) => [i.id, i])), [items]);
  async function saveSlots(next: (string | null)[]) {
    const before = slots;
    setSlots(next);
    try {
      await apiSend('PUT', '/me/showcase', { slots: next }, { invalidates: ['/me/showcase', '/players/'] });
    } catch (e) {
      setSlots(before);
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }
  async function saveProfile(body: Record<string, unknown>, patch: Record<string, unknown>) {
    setError(null);
    try {
      await apiSend('PATCH', '/me', body, { invalidates: ['/me', '/players/'] });
      patchProfile(patch);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
      return false;
    }
  }
  async function pick(it: Item) {
    if (!picking || !slots) return;
    if (picking.kind === 'avatar') {
      if (await saveProfile({ avatarUserCardId: it.id }, { avatar_user_card_id: it.id })) {
        await syncProfile();
        setToast('Photo de profil changée.');
      }
    } else void saveSlots(slots.map((s, i) => (i === picking.slot ? it.id : s === it.id ? null : s)));
    setPicking(null);
    setQ('');
  }

  const candidates = useMemo(() => {
    const nq = norm(q.trim());
    return (items ?? [])
      .filter((i) => (picking?.kind !== 'avatar' || (i.card.image_url && !i.card.sensitive)) && (!nq || norm(i.card.title).includes(nq)))
      .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || a.card.title.localeCompare(b.card.title, 'fr'))
      .map((i) => ({ ...i, key: i.id, shiny: i.is_shiny, card: { ...i.card, rarity: i.rarity } }));
  }, [items, q, picking?.kind]);

  if (!profile) return <Loading />;
  const since = profile.created_at ? new Date(profile.created_at).toLocaleDateString('fr', { month: 'long', year: 'numeric' }) : undefined;
  const openItem = open ? byId.get(open) : undefined;

  if (picking)
    return (
      <div className="screen">
        <section className="head">
          <div className="headmain">
            <div className="titleline">
              <h1 className="h1">{picking.kind === 'avatar' ? 'Photo de profil' : `Vitrine · emplacement ${picking.slot + 1}`}</h1>
              <span className="muted">{picking.kind === 'avatar' ? 'Choisissez une carte : son image devient votre photo.' : 'Choisissez la carte à exposer.'}</span>
            </div>
          </div>
          <div className="tools">
            <SizeButtons size={size} setSize={setSize} />
            <SearchField id="pick-search" value={q} onChange={setQ} />
          </div>
        </section>
        <section className="main">
          <CardGrid items={candidates} resetKey={`${picking.kind}|${q}`} size={size} label={(i) => i.card.title} onPick={(i) => void pick(i)} empty={picking.kind === 'avatar' ? 'Aucune carte avec une image utilisable.' : 'Aucune carte trouvée.'} />
          <Panel onClose={() => setPicking(null)} label="Choisir une carte">
            <h2>{picking.kind === 'avatar' ? 'Photo de profil' : 'Vitrine'}</h2>
            <p className="muted">Touchez une carte sur le plateau pour la choisir.</p>
            <div className="spacer" />
            <button className="btn" onClick={() => setPicking(null)}>
              Annuler
            </button>
          </Panel>
        </section>
      </div>
    );

  return (
    <div className="screen">
      <section className="head profilehead">
        <button className="avatarbtn" title="Changer la photo de profil" onClick={() => setPicking({ kind: 'avatar' })}>
          <Avatar name={profile.username} url={profile.avatar_url as string | null | undefined} size={72} />
          <span>Changer</span>
        </button>
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{profile.username}</h1>
            <StatsLine stats={stats} since={since} />
          </div>
          <RarityCounts stats={stats} />
        </div>
        <div className="tools">
          <button className="btn" onClick={() => navigate(`/profile/${encodeURIComponent(profile.username!)}`)}>
            Voir comme les autres
          </button>
        </div>
      </section>
      <section className="main">
        <div className="board scrollboard">
          <div className="sechead">
            <h2>{`Vitrine${slots ? ` · ${slots.filter(Boolean).length} / ${slots.length}` : ''}`}</h2>
            <span className="muted">Les cartes que les autres voient en premier sur votre profil.</span>
          </div>
          {!slots || !items ? (
            <Loading />
          ) : (
            <CardStrip
              items={slots.map((id) => {
                const it = id ? byId.get(id) : undefined;
                return it ? { ...it, key: it.id, shiny: it.is_shiny, card: { ...it.card, rarity: it.rarity } } : null;
              })}
              width={140}
              selected={open}
              label={(i) => i.card.title}
              onPick={(i) => setOpen(i.id)}
              emptySlot={(n) => (
                <button className="emptyslot" onClick={() => setPicking({ kind: 'slot', slot: n })}>
                  + Ajouter
                </button>
              )}
            />
          )}
          <div className="sechead" style={{ marginTop: 18 }}>
            <h2>À propos</h2>
          </div>
          <textarea id="profile-bio" className="field" rows={3} maxLength={280} placeholder="Quelques mots sur vous…" value={bio} onChange={(e) => setBio(e.target.value)} />
          <div className="row" style={{ border: 0, padding: '8px 0' }}>
            {bio !== (profile.bio ?? '') && (
              <button className="btn sm primary" onClick={() => void saveProfile({ bio: bio || null }, { bio: bio || null })}>
                Enregistrer la bio
              </button>
            )}
            <button className={`btn sm${profile.is_public !== false ? ' on' : ''}`} onClick={() => void saveProfile({ isPublic: profile.is_public === false }, { is_public: profile.is_public === false })}>
              {profile.is_public !== false ? 'Profil public' : 'Profil réservé aux amis'}
            </button>
          </div>
          {error && <p className="err">{error}</p>}
        </div>
        {openItem && slots ? (
          <Panel onClose={() => setOpen(null)} label={openItem.card.title}>
            <ShowcaseCard item={openItem} />
            <div className="spacer" />
            <button
              className="btn"
              onClick={() => {
                const slot = slots.indexOf(openItem.id);
                setOpen(null);
                setPicking({ kind: 'slot', slot });
              }}
            >
              Remplacer
            </button>
            <button
              className="btn danger"
              onClick={() => {
                setOpen(null);
                void saveSlots(slots.map((s) => (s === openItem.id ? null : s)));
              }}
            >
              Retirer de la vitrine
            </button>
          </Panel>
        ) : (
          <PanelPlaceholder>
            <div className="ghost" />
            <p>Touchez une carte de la vitrine pour la remplacer ou la retirer, ou un emplacement vide pour en ajouter une.</p>
          </PanelPlaceholder>
        )}
      </section>
      {toast}
    </div>
  );
}

function ShowcaseCard({ item }: { item: Item }) {
  const s = RARITY_STYLE[item.rarity];
  return (
    <div className="ptop">
      <BigCardFor item={item} />
      <div className="ptxt">
        <span className="rarity-tag" style={{ color: s.color }}>
          {s.label}
        </span>
        <h2>{item.card.title}</h2>
      </div>
    </div>
  );
}
const BigCardFor = ({ item }: { item: Item }) => <BigCard k={item.id} card={{ ...item.card, rarity: item.rarity }} shiny={item.is_shiny} />;

// ---------------------------------------------------------------- someone else's

type Entry = PartnerCard & { key: string; shiny: boolean };

export function PlayerScreen({ username }: { username: string }) {
  const qp = useQuery();
  const tab = qp.get('tab') === 'collection' ? 'collection' : 'vitrine';
  const [info, setInfo] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<{ key: string; card: Card; shiny: boolean } | null>(null);
  const [toast, setToast] = useToast();
  const owned = useOwnedCounts();
  const load = useCallback(
    () =>
      apiGet<Player>(`/players/${encodeURIComponent(username)}`, { force: true })
        .then((p) => {
          setInfo(p);
          rememberCards((p.showcase ?? []).flatMap((s) => (s ? [s.card] : [])));
        })
        .catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'Joueur introuvable.' : 'Erreur réseau')),
    [username],
  );
  useEffect(() => {
    setInfo(null);
    setError(null);
    setOpen(null);
    void load();
  }, [load]);

  if (error)
    return (
      <div className="screen">
        <div className="page">
          <p className="err">{error}</p>
        </div>
      </div>
    );
  if (!info) return <Loading />;
  const since = new Date(info.created_at).toLocaleDateString('fr', { month: 'long', year: 'numeric' });
  const showcase = (info.showcase ?? []).flatMap((s) => (s ? [{ key: `sc-${s.user_card_id}`, card: s.card, shiny: s.is_shiny }] : []));

  return (
    <div className="screen">
      <section className="head profilehead">
        <Avatar name={info.username} url={info.avatar?.card.image_url} online={info.online} size={72} />
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{info.username}</h1>
            <StatsLine stats={info.stats} since={since} extra={info.online ? 'en ligne' : info.last_seen_at ? `vu ${ago(info.last_seen_at)}` : null} />
          </div>
          {info.bio && <p style={{ margin: '8px 0 0', color: 'var(--soft)', maxWidth: 640 }}>{info.bio}</p>}
          <div className="chips">
            <button className={`chip${tab === 'vitrine' ? ' on' : ''}`} onClick={() => (setQuery({ tab: null }), setOpen(null))}>
              VITRINE
            </button>
            {!info.private && (
              <button className={`chip${tab === 'collection' ? ' on' : ''}`} onClick={() => (setQuery({ tab: 'collection' }), setOpen(null))}>
                COLLECTION
              </button>
            )}
          </div>
        </div>
        <div className="tools">
          {info.relation === 'self' && (
            <button className="btn" onClick={() => navigate('/profile')}>
              Modifier mon profil
            </button>
          )}
          {info.relation === 'friends' && (
            <>
              <button className="btn" onClick={() => navigate(`/dms?with=${info.id}`)}>
                Message
              </button>
              <button className="btn" onClick={() => navigate(`/battle?challenge=${info.id}`)}>
                Défier
              </button>
            </>
          )}
          {info.relation !== 'self' && !info.private && (
            <button className="btn" onClick={() => navigate(`/trades?new=1&with=${info.id}&name=${encodeURIComponent(info.username)}`)}>
              Proposer un échange
            </button>
          )}
          {info.relation === 'none' && (
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                addFriend(info.username)
                  .then(() => (setToast('Demande envoyée.'), load()))
                  .catch((e) => setToast(e instanceof ApiError ? e.message : 'Erreur réseau'))
                  .finally(() => setBusy(false));
              }}
            >
              Ajouter en ami
            </button>
          )}
          {info.relation === 'outgoing' && <span className="pill">Demande envoyée</span>}
          {info.relation !== 'self' && <ReportButton userId={info.id} username={info.username} />}
          {info.relation === 'incoming' && (
            <a className="btn" href={href('/friends')} onClick={linkClick}>
              Vous a envoyé une demande
            </a>
          )}
        </div>
      </section>
      {info.private ? (
        <div className="page">
          <p className="muted">{`Ce profil est réservé aux amis de ${info.username}.`}</p>
        </div>
      ) : (
        <section className="main">
          {tab === 'vitrine' ? (
            <div className="board scrollboard">
              <RarityCounts stats={info.stats} />
              <div style={{ height: 14 }} />
              <CardStrip
                items={showcase}
                width={150}
                selected={open?.key ?? null}
                label={(s) => `${s.card.title}${owned?.get(s.card.id) ? ', déjà possédée' : ''}`}
                onPick={(s) => setOpen(s)}
                caption={(s) => (
                  <>
                    <b style={{ color: RARITY_STYLE[s.card.rarity].color }}>{s.card.rarity}</b>
                    <span>{owned?.get(s.card.id) ? <i className="own" title="Déjà dans votre collection">{`✓ possédée${owned?.get(s.card.id)! > 1 ? ` ×${owned?.get(s.card.id)}` : ''}`}</i> : null}</span>
                  </>
                )}
                empty="Vitrine vide."
              />
            </div>
          ) : (
            <PlayerCollection player={info} selected={open?.key ?? null} onOpen={setOpen} owned={owned} />
          )}
          {open ? (
            <CardInfoPanel k={open.key} card={open.card} shiny={open.shiny} owned={owned ? (owned.get(open.card.id) ?? 0) : undefined} onClose={() => setOpen(null)} />
          ) : (
            <PanelPlaceholder>
              <div className="ghost" />
              <p>Touchez une carte pour la voir en grand.</p>
            </PanelPlaceholder>
          )}
        </section>
      )}
      {toast}
    </div>
  );
}

function PlayerCollection({ player, selected, onOpen, owned }: { player: Player; selected: string | null; onOpen: (e: Entry) => void; owned: Map<string, number> | null }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<Entry[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<CardSize>(savedSize);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const map = (r: PartnerCard): Entry => ({ ...r, key: r.id, shiny: r.is_shiny });
  useEffect(() => {
    let off = false;
    setItems(null);
    partnerCards(player, debounced, 0).then(
      (r) => !off && (setItems(r.items.map(map)), setHasMore(r.hasMore), setPage(0)),
      () => !off && setItems([]),
    );
    return () => {
      off = true;
    };
  }, [player, debounced]);
  const more = useCallback(() => {
    if (!hasMore || busy) return;
    setBusy(true);
    partnerCards(player, debounced, page + 1)
      .then((r) => {
        setItems((l) => [...(l ?? []), ...r.items.map(map).filter((x) => !l?.some((y) => y.key === x.key))]);
        setHasMore(r.hasMore);
        setPage((p) => p + 1);
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [player, debounced, page, hasMore, busy]);
  return (
    <div className="boardcol">
      <div className="boardtools">
        <SizeButtons size={size} setSize={setSize} />
        <SearchField id="player-cards-search" value={q} onChange={setQ} />
      </div>
      {items ? (
        <CardGrid
          items={items}
          resetKey={debounced}
          size={size}
          selected={selected}
          hasMore={hasMore}
          onMore={more}
          label={(e) => `${e.card.title}${owned?.get(e.card.id) ? ', déjà possédée' : ''}`}
          onPick={onOpen}
          caption={(e) => (
            <>
              <b style={{ color: RARITY_STYLE[e.card.rarity].color }}>{e.card.rarity}</b>
              <span>
                {owned?.get(e.card.id) ? <i className="own" title="Déjà dans votre collection">{`✓ possédée${owned?.get(e.card.id)! > 1 ? ` ×${owned?.get(e.card.id)}` : ''}`}</i> : null}
                {e.count > 1 ? ` · ${e.count} ex.` : ''}
              </span>
            </>
          )}
          empty={debounced ? `Aucune carte pour « ${debounced} ».` : 'Collection vide.'}
        />
      ) : (
        <div className="board">
          <div className="empty">Chargement de la collection…</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- catalogue

type CatalogEntry = Card & { key: string; card: Card; shiny: boolean };
const PAGE_SIZE = 60;

export function CatalogScreen() {
  const { profile } = useAccount();
  const lang = profile?.lang ?? 'fr';
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set());
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState<CatalogEntry[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<Record<Rarity, number> | null>(null);
  const [owned, setOwned] = useState<Map<string, number> | null>(null);
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [size, setSize] = useState<CardSize>(savedSize);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim().length >= 2 ? q.trim() : ''), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    apiGet<Record<Rarity, number>>(`/cards/pool/${lang}`, { ttl: 5 * 60_000 }).then(setCounts).catch(() => {});
    loadCollection(false)
      .then((c) => {
        const m = new Map<string, number>();
        c.items.forEach((i) => m.set(i.card_id, (m.get(i.card_id) ?? 0) + i.count));
        setOwned(m);
      })
      .catch(() => setOwned(new Map()));
  }, [lang]);
  const query = useCallback(
    (p: number) => {
      const s = new URLSearchParams({ lang, page: String(p), pageSize: String(PAGE_SIZE) });
      if (debounced) s.set('q', debounced);
      rarities.forEach((r) => s.append('rarity', r));
      return apiGet<{ items: Card[]; hasMore: boolean }>(`/cards?${s}`, { ttl: 5 * 60_000 }).then((d) => {
        rememberCards(d.items);
        return { items: d.items.map((c) => ({ ...c, key: `cat-${c.id}`, card: c, shiny: false })), hasMore: d.hasMore };
      });
    },
    [lang, debounced, rarities],
  );
  useEffect(() => {
    let off = false;
    setItems(null);
    setError(null);
    query(0).then(
      (r) => !off && (setItems(r.items), setHasMore(r.hasMore), setPage(0)),
      (e) => !off && (setError(e instanceof Error ? e.message : 'Erreur'), setItems([])),
    );
    return () => {
      off = true;
    };
  }, [query]);
  const more = useCallback(() => {
    if (!hasMore || busy) return;
    setBusy(true);
    query(page + 1)
      .then((r) => {
        setItems((l) => [...(l ?? []), ...r.items.filter((x) => !l?.some((y) => y.key === x.key))]);
        setHasMore(r.hasMore);
        setPage((p) => p + 1);
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [query, page, hasMore, busy]);
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;
  // « Ma liste »: the cards I'm looking for (and the filter that shows only them).
  const [wished, setWished] = useState<CatalogEntry[] | null>(null);
  const [onlyWished, setOnlyWished] = useState(false);
  useEffect(() => {
    apiGet<{ items: Card[] }>('/wishlist', { force: true }).then(
      (d) => setWished(d.items.map((c) => ({ ...c, key: `cat-${c.id}`, card: c, shiny: false }))),
      () => setWished([]),
    );
  }, []);
  const wishedIds = useMemo(() => new Set((wished ?? []).map((c) => c.id)), [wished]);
  const toggleWish = async (c: CatalogEntry) => {
    const on = !wishedIds.has(c.id);
    setWished((w) => (on ? [c, ...(w ?? [])] : (w ?? []).filter((x) => x.id !== c.id)));
    try {
      await apiSend(on ? 'PUT' : 'DELETE', `/wishlist/${c.id}`, undefined, { invalidates: ['/wishlist'] });
    } catch {
      setWished((w) => (on ? (w ?? []).filter((x) => x.id !== c.id) : [c, ...(w ?? [])]));
    }
  };
  const shown = useMemo(() => (onlyWished ? (wished ?? []) : (items ?? [])).filter((c) => !onlyMissing || !owned?.get(c.id)), [items, wished, onlyWished, onlyMissing, owned]);

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">Catalogue</h1>
            <span className="muted num">{total != null ? `${fmt(total)} cartes dans le jeu${owned ? ` · vous en avez ${fmt(owned.size)}` : ''}` : 'Toutes les cartes du jeu'}</span>
          </div>
          <div className="chips">
            {RARITY_ORDER.map((r) => (
              <button
                key={r}
                className={`chip${rarities.has(r) ? ' on' : ''}`}
                aria-pressed={rarities.has(r)}
                title={RARITY_STYLE[r].label}
                onClick={() =>
                  setRarities((cur) => {
                    const n = new Set(cur);
                    n.has(r) ? n.delete(r) : n.add(r);
                    return n;
                  })
                }
              >
                <span className="dot" style={{ background: RARITY_STYLE[r].color }} />
                {r}
                {counts && <span className="n">{fmt(counts[r] ?? 0)}</span>}
              </button>
            ))}
            <button className={`chip${onlyMissing ? ' on' : ''}`} aria-pressed={onlyMissing} onClick={() => setOnlyMissing((v) => !v)}>
              PAS ENCORE À MOI
            </button>
            <button className={`chip${onlyWished ? ' on' : ''}`} aria-pressed={onlyWished} onClick={() => setOnlyWished((v) => !v)}>
              MA LISTE
              {wished && wished.length > 0 && <span className="n">{wished.length}</span>}
            </button>
          </div>
        </div>
        <div className="tools">
          <SizeButtons size={size} setSize={setSize} />
          <SearchField id="catalog-search" value={q} onChange={setQ} placeholder="Rechercher un article" />
        </div>
      </section>
      <section className="main">
        {items ? (
          <CardGrid
            items={shown}
            resetKey={`${debounced}|${[...rarities].join()}|${onlyMissing}|${onlyWished}`}
            size={size}
            selected={open?.key ?? null}
            hasMore={!onlyWished && hasMore}
            onMore={more}
            label={(c) => `${c.title}${owned?.get(c.id) ? ', possédée' : ''}${wishedIds.has(c.id) ? ', dans ma liste' : ''}`}
            onPick={setOpen}
            caption={(c) => (
              <>
                <b style={{ color: RARITY_STYLE[c.rarity].color }}>{c.rarity}</b>
                <span className={owned?.get(c.id) ? 'ok' : wishedIds.has(c.id) ? 'gold' : undefined}>{owned?.get(c.id) ? `possédée ×${owned.get(c.id)}` : wishedIds.has(c.id) ? 'dans ma liste' : ''}</span>
              </>
            )}
            empty={onlyWished ? 'Votre liste est vide : ouvrez une carte et ajoutez-la.' : (error ?? 'Aucune carte ne correspond.')}
          />
        ) : (
          <div className="board">
            <div className="empty">Chargement du catalogue…</div>
          </div>
        )}
        {open ? (
          <CardInfoPanel
            k={open.key}
            card={open.card}
            shiny={false}
            owned={owned?.get(open.id) ?? 0}
            onClose={() => setOpen(null)}
            extra={
              <>
                <FriendOwners cardId={open.id} />
                <button className={`btn${wishedIds.has(open.id) ? ' on' : ''}`} aria-pressed={wishedIds.has(open.id)} onClick={() => void toggleWish(open)}>
                  {wishedIds.has(open.id) ? 'Dans ma liste' : 'Ajouter à ma liste'}
                </button>
              </>
            }
          />
        ) : (
          <PanelPlaceholder>
            <div className="ghost" />
            <p>Touchez une carte pour la voir en grand.</p>
          </PanelPlaceholder>
        )}
      </section>
    </div>
  );
}

/** Friends who own a card: ask them for a trade. */
function FriendOwners({ cardId }: { cardId: string }) {
  const [people, setPeople] = useState<{ id: string; username: string }[] | null>(null);
  useEffect(() => {
    setPeople(null);
    apiGet<{ id: string; username: string }[]>(`/cards/${cardId}/friends`, { ttl: 60_000 }).then(setPeople, () => setPeople([]));
  }, [cardId]);
  if (!people?.length) return null;
  return (
    <div className="list">
      <span className="lbl muted">Vos amis qui l’ont</span>
      {people.map((p) => (
        <div className="li" key={p.id}>
          <span className="t">{p.username}</span>
          <button className="btn sm" onClick={() => navigate(`/trades?new=1&with=${p.id}&name=${encodeURIComponent(p.username)}`)}>
            Proposer un échange
          </button>
        </div>
      ))}
    </div>
  );
}

const REASONS = { cheating: 'Triche', inappropriate_content: 'Contenu inapproprié', spam: 'Spam' } as const;

/** Report a player to moderation (one report per player, can be updated). */
function ReportButton({ userId, username }: { userId: string; username: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<keyof typeof REASONS>('cheating');
  const [details, setDetails] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    apiGet<{ report?: { reason?: keyof typeof REASONS; details?: string | null } | null }>(`/reports?reportedUserId=${userId}`, { force: true })
      .then((r) => {
        if (!r.report) return;
        if (r.report.reason) setReason(r.report.reason);
        setDetails(r.report.details ?? '');
        setSent('Vous avez déjà signalé ce joueur : vous pouvez compléter le signalement.');
      })
      .catch(() => {});
  }, [open, userId]);
  async function send() {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/reports', { reportedUserId: userId, reason, details: details.trim() });
      setSent('Signalement envoyé. Merci.');
      setTimeout(() => setOpen(false), 1500);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button className="btn danger" onClick={() => (setOpen(true), setSent(null))}>
        Signaler
      </button>
      {open && (
        <Modal title={`Signaler ${username}`} onClose={() => setOpen(false)} width={440}>
          <div className="chips" style={{ marginTop: 0 }}>
            {(Object.keys(REASONS) as (keyof typeof REASONS)[]).map((r) => (
              <button key={r} className={`chip${reason === r ? ' on' : ''}`} aria-pressed={reason === r} onClick={() => setReason(r)}>
                {REASONS[r].toUpperCase()}
              </button>
            ))}
          </div>
          <textarea id="report-details" className="field" maxLength={500} placeholder="Ce qui s’est passé (facultatif)" value={details} onChange={(e) => setDetails(e.target.value)} />
          {sent && <p className="ok">{sent}</p>}
          {error && <p className="err">{error}</p>}
          <div className="row2">
            <button className="btn" onClick={() => setOpen(false)}>
              Annuler
            </button>
            <button className="btn primary" disabled={busy} onClick={() => void send()}>
              Envoyer
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
