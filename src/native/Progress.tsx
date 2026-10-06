import { useCallback, useEffect, useMemo, useState } from 'react';
import { packCap, regenPeriodMs, setBalance, useAccount } from '../lib/account';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { useSession } from '../lib/auth';
import { loadCollection, type Item } from '../lib/collection';
import { fmt, RARITY_STYLE } from '../lib/rarity';
import { linkClick, navigate, setQuery, useQuery } from '../lib/router';
import { mmss, useNow } from '../lib/time';
import { CardStrip, href, Loading, PlayerLink, Progress } from './common';
import { Icon, ICON, useToast } from './kit';

// Progression: today's dashboard (what's waiting, latest finds), tiered achievements that pay
// wikibidous, and the player rankings.

// ---------------------------------------------------------------- Aujourd'hui

export function HomeScreen() {
  const me = useSession()?.user.id ?? '';
  const { profile } = useAccount();
  const now = useNow();
  const [selling, setSelling] = useState<{ selling: number; maxConcurrentAuctions: number; leading?: number } | null>(null);
  const [tradesIn, setTradesIn] = useState<number | null>(null);
  const [claimable, setClaimable] = useState<number | null>(null);
  const [finds, setFinds] = useState<Item[] | null>(null);

  useEffect(() => {
    apiGet<{ selling: number; maxConcurrentAuctions: number; leading: number }>('/market/summary', { ttl: 30_000 }).then(setSelling).catch(() => {});
    apiGet<{ items: { status: string; recipient: { id: string } }[] }>('/trades?box=active', { ttl: 30_000 })
      .then((d) => setTradesIn(d.items.filter((t) => t.status === 'pending' && t.recipient.id === me).length))
      .catch(() => setTradesIn(0));
    apiGet<{ claimable: boolean }[]>('/achievements', { ttl: 60_000 })
      .then((list) => setClaimable(list.filter((a) => a.claimable).length))
      .catch(() => setClaimable(0));
    loadCollection(false)
      .then((c) => setFinds([...c.items].sort((a, b) => b.obtained_at.localeCompare(a.obtained_at)).slice(0, 8)))
      .catch(() => setFinds([]));
  }, [me]);

  const packs = profile?.packs_remaining ?? null;
  const cap = packCap(profile);
  const next = packs != null && packs < cap && profile?.packs_last_regen_at ? new Date(profile.packs_last_regen_at).getTime() + regenPeriodMs(profile) - now : null;
  const hour = new Date().getHours();
  const tiles = [
    { label: 'Paquets prêts', value: packs, hint: packs === cap ? 'Réserve pleine' : next != null && next > 0 ? `Le prochain dans ${mmss(next)}` : '', to: '/', hot: !!packs },
    { label: 'Ventes en cours', value: selling?.selling ?? null, hint: selling ? `sur ${selling.maxConcurrentAuctions} possibles${selling.leading ? ` · ${selling.leading} enchère${selling.leading > 1 ? 's' : ''} en tête` : ''}` : '', to: '/market?tab=selling', hot: false },
    { label: 'Offres reçues', value: tradesIn, hint: tradesIn ? 'à traiter' : 'Aucune offre en attente', to: '/trades', hot: !!tradesIn },
    { label: 'Succès', value: claimable, hint: claimable ? 'Récompenses à réclamer' : 'Rien à réclamer', to: '/achievements', hot: !!claimable },
  ];
  const waiting = tiles.filter((t) => t.hot).length;

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{`${hour >= 5 && hour < 18 ? 'Bonjour' : 'Bonsoir'}, ${profile?.username ?? '…'}`}</h1>
            <span className="muted">{waiting ? `${waiting} chose${waiting > 1 ? 's' : ''} vous attend${waiting > 1 ? 'ent' : ''} aujourd’hui.` : 'Tout est à jour.'}</span>
          </div>
        </div>
        <div className="tools">
          <button className="btn primary" onClick={() => navigate('/')}>
            Ouvrir un paquet {packs != null && <span className="num">{`· ${packs}`}</span>}
          </button>
        </div>
      </section>
      <div className="page">
        <div className="tiles">
          {tiles.map((t) => (
            <a key={t.label} className={`tile${t.hot ? ' hot' : ''}`} href={href(t.to)} onClick={linkClick}>
              <span className="lbl">{t.label}</span>
              <b className="num">{t.value ?? '…'}</b>
              <span className="muted">{t.hint}</span>
            </a>
          ))}
        </div>
        <div className="sechead">
          <h2>Dernières trouvailles</h2>
          <a className="btn link" href={href('/collection?sort=recent')} onClick={linkClick}>
            Voir la collection
          </a>
        </div>
        {finds === null ? (
          <Loading />
        ) : (
          <CardStrip
            items={finds.map((f) => ({ ...f, key: f.id, shiny: f.is_shiny, card: { ...f.card, rarity: f.rarity } }))}
            label={(f) => f.card.title}
            onPick={(f) => navigate(`/collection?sort=recent&card=${f.id}`)}
            caption={(f) => (
              <>
                <b style={{ color: RARITY_STYLE[f.rarity].color }}>{f.rarity}</b>
                <span>{new Date(f.obtained_at).toLocaleDateString('fr', { day: 'numeric', month: 'short' })}</span>
              </>
            )}
            empty="Aucune carte pour l’instant : ouvrez un paquet !"
          />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Succès

type Tier = { tier: number; at: number; reward: number; claimed: boolean; claimable: boolean };
type Achievement = { id: string; label: string; description: string; progress: number; tiers: Tier[]; claimable: boolean };
const ACH_ICON: Record<string, string> = { packs: ICON.pack, collector: ICON.collection, legend: ICON.star, shiny: ICON.star, merchant: ICON.coin, trader: ICON.trades, social: ICON.people };

export function AchievementsScreen() {
  const [list, setList] = useState<Achievement[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const load = useCallback(() => {
    apiGet<Achievement[]>('/achievements', { force: true })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(load, [load]);

  async function claim(a: Achievement) {
    setBusy(a.id);
    setError(null);
    try {
      const r = await apiSend<{ gained: number; balance: number }>('POST', `/achievements/${a.id}/claim`, undefined, { invalidates: ['/achievements'] });
      setBalance(r.balance);
      setToast(`+${fmt(r.gained)} WB`);
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(null);
    }
  }
  const tiers = list?.flatMap((a) => a.tiers) ?? [];
  const done = tiers.filter((t) => t.claimed).length;
  const sorted = useMemo(() => [...(list ?? [])].sort((a, b) => Number(b.claimable) - Number(a.claimable)), [list]);

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">Succès</h1>
            {list && <span className="muted num">{`${done} / ${tiers.length} paliers obtenus`}</span>}
          </div>
          {list && (
            <div style={{ marginTop: 12, maxWidth: 520 }}>
              <Progress value={done} max={tiers.length} />
            </div>
          )}
        </div>
      </section>
      <div className="page">
        {error && <p className="err">{error}</p>}
        {!list && !error && <Loading />}
        <div className="achs">
          {sorted.map((a) => {
            const next = a.tiers.find((t) => !t.claimed);
            const reward = a.tiers.filter((t) => t.claimable).reduce((s, t) => s + t.reward, 0);
            const target = next?.at ?? a.tiers[a.tiers.length - 1]!.at;
            return (
              <div key={a.id} className={`ach${!next ? ' done' : ''}${a.claimable ? ' hot' : ''}`}>
                <span className="achicon">
                  <Icon d={ACH_ICON[a.id] ?? ICON.trophy} size={22} />
                </span>
                <div className="achbody">
                  <b>{a.label}</b>
                  <span className="muted">{`${a.description} · ${fmt(a.progress)} / ${fmt(target)}`}</span>
                  <Progress value={a.progress} max={target} />
                  <div className="tiers">
                    {a.tiers.map((t) => (
                      <span key={t.tier} className={t.claimed ? 'got' : t.claimable ? 'ready' : undefined}>
                        {`${fmt(t.at)} → +${fmt(t.reward)} WB`}
                      </span>
                    ))}
                  </div>
                </div>
                {a.claimable && (
                  <button className="btn primary" disabled={busy === a.id} onClick={() => void claim(a)}>
                    {`Réclamer +${fmt(reward)} WB`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {toast}
    </div>
  );
}

// ---------------------------------------------------------------- Classement

const BOARDS = {
  score: { label: 'Collection', unit: 'pts', hint: 'Points par carte différente possédée (C 1 → L 500, brillante ×2)' },
  legendary: { label: 'Légendaires', unit: 'L', hint: 'Cartes légendaires différentes' },
  packs: { label: 'Paquets', unit: 'ouverts', hint: 'Paquets ouverts' },
  sales: { label: 'Ventes', unit: 'WB', hint: 'WB gagnés aux enchères' },
} as const;
type Board = keyof typeof BOARDS;
type Entry = { rank: number; value: number; user: { id: string; username?: string } };
type Ranking = { board: Board; updated_at: string | null; total: number; me: { rank: number; value: number } | null; items: Entry[]; maintenance?: boolean };

export function LeaderboardScreen() {
  const q = useQuery();
  const board: Board = (q.get('board') as Board) in BOARDS ? (q.get('board') as Board) : 'score';
  const page = Math.max(0, Number(q.get('page')) || 0);
  const [data, setData] = useState<Ranking | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    apiGet<Ranking>(`/leaderboard/${board}?page=${page}`, { ttl: 30_000 })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [board, page]);
  const b = BOARDS[board];
  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">Classement</h1>
            {data?.me && <span className="muted num">{`Vous : #${fmt(data.me.rank)} sur ${fmt(data.total)} · ${fmt(data.me.value)} ${b.unit}`}</span>}
          </div>
          <div className="chips">
            {(Object.keys(BOARDS) as Board[]).map((k) => (
              <button key={k} className={`chip${k === board ? ' on' : ''}`} aria-pressed={k === board} onClick={() => setQuery({ board: k === 'score' ? null : k, page: null })}>
                {BOARDS[k].label.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>
      <div className="page">
        <p className="muted" style={{ marginTop: 0 }}>
          {b.hint}
          {data?.updated_at && ` · mis à jour à ${new Date(data.updated_at).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}`}
        </p>
        {error && <p className="err">{error}</p>}
        {!data && !error && <Loading />}
        {data?.maintenance && <p className="muted">Le classement de wiki-masters est en maintenance de leur côté : il reviendra ici dès qu’il sera rétabli.</p>}
        {data && !data.maintenance && !data.items.length && <p className="muted">Personne au classement pour l’instant.</p>}
        {data && data.items.length > 0 && (
          <div className="table">
            {data.items.map((e) => (
              <div key={e.user.id} className={`trow2${e.rank === data.me?.rank ? ' me' : ''}`}>
                <span className={`rank${e.rank <= 3 ? ` top${e.rank}` : ''}`}>{`#${e.rank}`}</span>
                <span className="grow">
                  <PlayerLink name={e.user.username} />
                </span>
                <b className="num">
                  {fmt(e.value)} <span className="muted">{b.unit}</span>
                </b>
              </div>
            ))}
          </div>
        )}
        {data && data.total > 50 && (
          <div className="pager" style={{ justifyContent: 'center', marginTop: 16 }}>
            <button className="iconbtn" aria-label="Page précédente" disabled={page <= 0} onClick={() => setQuery({ page: page - 1 > 0 ? String(page - 1) : null })}>
              <Icon d={ICON.prev} size={16} />
            </button>
            <span className="lbl num">{`Page ${page + 1} sur ${Math.ceil(data.total / 50)}`}</span>
            <button className="iconbtn" aria-label="Page suivante" disabled={(page + 1) * 50 >= data.total} onClick={() => setQuery({ page: String(page + 1) })}>
              <Icon d={ICON.next} size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
