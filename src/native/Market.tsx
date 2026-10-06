import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { refreshBalance, useAccount } from '../lib/account';
import { ApiError } from '../lib/api';
import { subtitle } from '../lib/cardSpec';
import * as market from '../lib/market';
import type { Lot, LotDetail, MarketSort, MineTab, Summary } from '../lib/market';
import { fmt, RARITY_ORDER, RARITY_STYLE } from '../lib/rarity';
import { navigate, useQuery } from '../lib/router';
import { useNow } from '../lib/time';
import { armTimedBid as armTimed, cancelTimedBid, lotEndChanged, useTimedBids } from '../lib/timedBids';
import { useOwnedCounts } from '../lib/collection';
import type { Rarity } from '../lib/types';
import { CardGrid, savedSize, type CardSize } from './CardGrid';
import { SizeButtons } from './Collection';
import { PanelPlaceholder, BigCard, Panel, SearchField, useArmed } from './kit';

// The auction house: browse (filters, search, sort; pages loaded as you go) or your own sales /
// bids / wins, as a board of cards with their price. A lot flies into its panel: bids, countdown,
// bidding, and for your own sales cancel / reprice.

type Tab = 'browse' | MineTab;
const TABS: { id: Tab; label: string }[] = [
  { id: 'browse', label: 'PARCOURIR' },
  { id: 'selling', label: 'MES VENTES' },
  { id: 'bidding', label: 'MES ENCHÈRES' },
  { id: 'won', label: 'GAGNÉES' },
  { id: 'history', label: 'HISTORIQUE' },
];
const SORTS: Record<MarketSort, string> = { ending: 'FIN PROCHE', recent: 'RÉCENTES', price_asc: 'PRIX ↑', price_desc: 'PRIX ↓' };
const SORT_ORDER: MarketSort[] = ['recent', 'ending', 'price_asc', 'price_desc'];
const priceOf = (l: Lot) => l.current_bid ?? l.base_amount;
type GridLot = Lot & { key: string; shiny: boolean };

function LotPanel({ initial, onClose, onChanged }: { initial: Lot; onClose: () => void; onChanged: () => void }) {
  const id = initial.id;
  const { balance } = useAccount();
  const now = useNow(500);
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [amount, setAmount] = useState('');
  const [armed, arm] = useArmed();
  const [newBase, setNewBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Timed bid (kept by the app: it goes out even if this panel is closed).
  const timed = useTimedBids().find((x) => x.lotId === id) ?? null;
  const [timedArmed, armTimedConfirm] = useArmed();
  const owned = useOwnedCounts();

  const load = useCallback(() => {
    market
      .lot(id)
      .then((d) => {
        lotEndChanged(d.id, d.end_at);
        setLot(d);
        setAmount((a) => a || String(d.min_next_bid ?? market.nextBid(d.current_bid, d.base_amount)));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Erreur réseau'));
  }, [id]);
  useEffect(() => {
    setLot(null);
    setAmount('');
    setError(null);
    setNote(null);
    arm(false);
    load();
    // No push from wiki-masters: poll while the lot is open.
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const l = lot ?? ({ ...initial, bids: [] } as LotDetail);
  const s = RARITY_STYLE[l.card.rarity];
  const ended = new Date(l.end_at).getTime() <= now || l.status !== 'active';
  const min = l.min_next_bid ?? market.nextBid(l.current_bid, l.base_amount);
  const value = Math.floor(Number(amount.replace(/\s/g, '')));
  const run = async (f: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await f();
      setNote(done ?? null);
      arm(false);
      refreshBalance().catch(() => {});
      onChanged();
      load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  };
  const placeBid = () => {
    if (!Number.isFinite(value) || value < min) return setError(`Mise minimale : ${fmt(min)} WB`);
    if (balance != null && value > balance) return setError(`Solde insuffisant (${fmt(balance)} WB)`);
    // Spending: always a second press to confirm.
    if (!armed) return arm(true);
    // Cleared so the reload fills in the new minimum.
    void run(() => market.bid(id, value).then(() => setAmount('')), `Enchère placée : ${fmt(value)} WB`);
  };
  const armTimedBid = () => {
    if (!Number.isFinite(value) || value < min) return setError(`Mise minimale : ${fmt(min)} WB`);
    if (balance != null && value > balance) return setError(`Solde insuffisant (${fmt(balance)} WB)`);
    if (!timedArmed) return armTimedConfirm(true);
    armTimedConfirm(false);
    setError(null);
    setBusy(true);
    armTimed({ id, title: l.card.title }, value)
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur'))
      .finally(() => setBusy(false));
  };
  // A timed bid that just went out: show where it stands.
  useEffect(() => {
    if (timed?.state === 'placed' || timed?.state === 'failed') {
      onChanged();
      load();
    }
  }, [timed?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const mineCount = owned?.get(l.card.id) ?? 0;
  const canReprice = (() => {
    if (!l.mine || ended || l.current_bid != null || l.base_repriced_at || !l.created_at) return false;
    const start = new Date(l.created_at).getTime();
    const end = new Date(l.end_at).getTime();
    return now >= start + (end - start) / 2;
  })();

  return (
    <Panel onClose={onClose} label={l.card.title}>
      <div className="ptop">
        <BigCard k={l.id} card={l.card} shiny={l.is_shiny} />
        <div className="ptxt">
          <span className="rarity-tag" style={{ color: s.color }}>
            {`${s.label}${l.is_shiny ? ' · brillante' : ''}`}
          </span>
          <h2>{l.card.title}</h2>
          <span className="muted">{`${subtitle(l.card)} · vendue par ${l.seller.username}${l.mine ? ' (vous)' : ''}`}</span>
          {owned && <span className={mineCount ? 'owned' : 'notowned'}>{mineCount ? `Déjà dans votre collection (×${mineCount})` : 'Pas encore dans votre collection'}</span>}
        </div>
      </div>
      <div className="row2">
        <div className="box">
          <span className="lbl muted">{l.current_bid != null ? 'Enchère actuelle' : 'Mise de départ'}</span>
          <span className="big" style={{ color: 'var(--gold)' }}>{`${fmt(priceOf(l))} WB`}</span>
        </div>
        <div className="box">
          <span className="lbl muted">{ended ? 'Terminée' : 'Fin dans'}</span>
          <span className="big" style={{ color: ended ? 'var(--bad)' : 'var(--ink)', fontSize: 20 }}>
            {ended ? (l.final_price ? `${fmt(l.final_price)} WB` : '—') : market.timeLeft(l.end_at, now)}
          </span>
        </div>
      </div>
      <p className={l.leading ? 'ok' : 'muted'} style={{ fontSize: 14 }}>
        {l.current_bidder ? `${l.leading ? 'Vous êtes en tête' : `En tête : ${l.current_bidder.username}`} · ${l.bid_count} enchère${l.bid_count > 1 ? 's' : ''}` : 'Aucune enchère pour l’instant'}
      </p>
      {l.bids.length > 0 && (
        <div className="list">
          {l.bids.slice(0, 6).map((b, i) => (
            <div className="li" key={`${b.created_at}-${i}`}>
              <span className="t muted">{b.username}</span>
              <b className="num">{`${fmt(b.amount)} WB`}</b>
            </div>
          ))}
        </div>
      )}
      <div className="spacer" />
      {error && <p className="err" role="alert">{error}</p>}
      {note && <p className="ok">{note}</p>}
      {!ended && !l.mine && (
        <>
          <div className="row2">
            <input id="market-bid" className="field" style={{ height: 44 }} inputMode="numeric" aria-label="Montant de l’enchère (WB)" placeholder={String(min)} value={amount} onChange={(e) => (setAmount(e.target.value.replace(/[^\d\s]/g, '')), arm(false))} onKeyDown={(e) => e.key === 'Enter' && placeBid()} />
            <button className={`btn ${armed ? 'confirm' : 'primary'}`} disabled={busy} onClick={placeBid}>
              {armed ? `Confirmer ${fmt(value)} WB` : 'Enchérir'}
            </button>
          </div>
          <div className="chips" style={{ marginTop: 0 }}>
            {[
              ['Min', min],
              ['+10 %', Math.ceil(min * 1.1)],
              ['+25 %', Math.ceil(min * 1.25)],
              ['+50 %', Math.ceil(min * 1.5)],
            ].map(([label, v]) => (
              <button key={label} className={`chip${value === v ? ' on' : ''}`} onClick={() => (setAmount(String(v)), arm(false))}>
                {`${label} · ${fmt(v as number)}`}
              </button>
            ))}
          </div>
          <span className="hint num">{`Minimum ${fmt(min)} WB · solde ${balance != null ? fmt(balance) : '–'} WB`}</span>
          {timed && timed.state !== 'armed' && timed.state !== 'sending' ? (
            <p className={timed.state === 'placed' ? 'ok' : 'err'}>{timed.message}</p>
          ) : null}
          {timed && (timed.state === 'armed' || timed.state === 'sending') ? (
            <div className="box timedbox">
              <span className="grow">
                <b className="num">{timed.state === 'sending' ? `Envoi de ${fmt(timed.amount)} WB…` : `${fmt(timed.amount)} WB dans ${market.timeLeft(new Date(timed.sendAt).toISOString(), now)}`}</b>
                <span className="hint">{`envoi à 10 s + ${(timed.margin / 1000).toFixed(2).replace('.', ',')} s de la fin, à l’heure du serveur (${timed.offset >= 0 ? '+' : '−'}${(Math.abs(timed.offset) / 1000).toFixed(2).replace('.', ',')} s par rapport à votre horloge) · part même si vous fermez cette vente (gardez Wikimasters Enhanced ouvert)`}</span>
              </span>
              {timed.state === 'armed' && (
                <button className="btn sm" onClick={() => cancelTimedBid(id)}>
                  Annuler
                </button>
              )}
            </div>
          ) : (
            <button className={`btn ${timedArmed ? 'confirm' : ''}`} disabled={busy} onClick={armTimedBid} title="La mise part juste avant les 10 dernières secondes (une mise dans ce délai prolonge la vente d’une minute).">
              {timedArmed ? `Confirmer : ${fmt(value)} WB à 10 s de la fin` : 'Miser à 10 s de la fin'}
            </button>
          )}
        </>
      )}
      {ended && l.status === 'active' && (l.leading || l.mine) && (
        <button className="btn primary" disabled={busy} onClick={() => void run(() => market.settle(id), 'Vente finalisée.')}>
          Finaliser la vente
        </button>
      )}
      {!ended && l.mine && (
        <>
          {canReprice && (
            <div className="row2">
              <input id="market-reprice" className="field" style={{ height: 44 }} inputMode="numeric" placeholder={`Nouvelle mise (≤ ${fmt(Math.floor((l.listing_base_amount ?? l.base_amount) / 2))})`} value={newBase} onChange={(e) => setNewBase(e.target.value.replace(/\D/g, ''))} />
              <button className="btn" disabled={busy || !newBase} onClick={() => void run(() => market.reprice(id, Number(newBase)), 'Prix baissé')}>
                Baisser le prix
              </button>
            </div>
          )}
          <button className={`btn ${armed ? 'confirm' : 'danger'}`} disabled={busy || l.current_bid != null} onClick={() => (armed ? void run(() => market.cancel(id).then(onClose), 'Vente annulée') : arm(true))}>
            {l.current_bid != null ? 'Annulation impossible (enchère en cours)' : armed ? 'Confirmer l’annulation ?' : 'Annuler la vente'}
          </button>
        </>
      )}
    </Panel>
  );
}

export function MarketScreen({ path }: { path: string }) {
  const now = useNow(1000);
  const qp = useQuery();
  const [tab, setTab] = useState<Tab>(() => (TABS.some((t) => t.id === qp.get('tab')) ? (qp.get('tab') as Tab) : 'browse'));
  const [rarities, setRarities] = useState<Set<Rarity>>(new Set());
  const [sort, setSort] = useState<MarketSort>('recent');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [openLot, setOpenLot] = useState<Lot | null>(null);
  const [tick, setTick] = useState(0);
  const [size, setSize] = useState<CardSize>(savedSize);
  const loadingMore = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    market.summary().then(setSummary).catch(() => {});
  }, [tick]);
  // No push from wiki-masters: the list is re-read now and then.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 45_000);
    return () => clearInterval(t);
  }, []);

  // First page (or the chosen "mine" list) whenever the query changes.
  useEffect(() => {
    let off = false;
    setLoading(true);
    setError(null);
    const p = tab === 'browse' ? market.browse({ rarities: [...rarities], text: debounced, sort, page: 0 }) : market.mine(tab).then((items) => ({ items, hasMore: false }));
    p.then(
      (r) => {
        if (off) return;
        setLots(r.items);
        setHasMore(r.hasMore);
        setPage(0);
      },
      (e) => !off && setError(e instanceof ApiError ? e.message : 'Erreur réseau'),
    ).finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
  }, [tab, rarities, debounced, sort, tick]);

  const more = useCallback(() => {
    if (tab !== 'browse' || !hasMore || loadingMore.current) return;
    loadingMore.current = true;
    market
      .browse({ rarities: [...rarities], text: debounced, sort, page: page + 1 })
      .then((r) => {
        setLots((l) => [...(l ?? []), ...r.items.filter((x) => !l?.some((y) => y.id === x.id))]);
        setHasMore(r.hasMore);
        setPage((p) => p + 1);
      })
      .catch(() => {})
      .finally(() => (loadingMore.current = false));
  }, [tab, hasMore, rarities, debounced, sort, page]);

  // /market/<id> (a notification, a shared link): open that lot.
  const linked = path.match(/^\/market\/([0-9a-f-]{36})$/)?.[1];
  useEffect(() => {
    if (!linked) return;
    market.lot(linked).then((l) => setOpenLot(l), () => {});
  }, [linked]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenLot(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ownedCounts = useOwnedCounts();
  const items = useMemo((): GridLot[] => (lots ?? []).map((l) => ({ ...l, key: l.id, shiny: l.is_shiny })), [lots]);
  const s = summary;
  const resetKey = `${tab}|${[...rarities].join()}|${debounced}|${sort}`;
  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">Marché</h1>
            <span className="muted num">
              {s ? `${s.selling} / ${s.maxConcurrentAuctions} ventes en cours · ${s.leading} enchère${s.leading > 1 ? 's' : ''} en tête` : ''}
              {tab !== 'browse' && lots ? ` · ${loading ? 'chargement…' : `${fmt(lots.length)} lot${lots.length > 1 ? 's' : ''}`}` : ''}
            </span>
          </div>
          <div className="chips">
            {TABS.map((t) => (
              <button key={t.id} className={`chip${tab === t.id ? ' on' : ''}`} aria-pressed={tab === t.id} onClick={() => (setTab(t.id), setOpenLot(null))}>
                {t.label}
              </button>
            ))}
          </div>
          {tab === 'browse' && (
            <div className="chips" style={{ marginTop: 8 }}>
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
                </button>
              ))}
              <button className="chip" onClick={() => setSort(SORT_ORDER[(SORT_ORDER.indexOf(sort) + 1) % SORT_ORDER.length]!)}>
                {`TRI : ${SORTS[sort]}`}
              </button>
            </div>
          )}
        </div>
        <div className="tools">
          <SizeButtons size={size} setSize={setSize} />
          {tab === 'browse' && <SearchField id="market-search" value={query} onChange={setQuery} />}
        </div>
      </section>
      <section className="main">
        {lots ? (
          <CardGrid
            items={items}
            resetKey={resetKey}
            size={size}
            selected={openLot?.id ?? null}
            hasMore={tab === 'browse' && hasMore}
            onMore={more}
            label={(l) => `${l.card.title}, ${fmt(priceOf(l))} WB, ${market.timeLeft(l.end_at, now)}${ownedCounts?.get(l.card.id) ? ', déjà possédée' : ''}`}
            onPick={(l) => setOpenLot(l)}
            caption={(l) => {
              const soon = new Date(l.end_at).getTime() - now < 60_000;
              return (
                <div className="capcol">
                  <div className="capline">
                    <b style={{ color: l.leading ? 'var(--good)' : l.mine ? 'var(--blue)' : 'var(--gold)' }}>{`${fmt(priceOf(l))} WB`}</b>
                    {ownedCounts?.get(l.card.id) ? <i className="own" title="Déjà dans votre collection">{`✓ possédée${ownedCounts.get(l.card.id)! > 1 ? ` ×${ownedCounts.get(l.card.id)}` : ''}`}</i> : null}
                  </div>
                  <span style={soon ? { color: 'var(--bad)' } : undefined}>
                    {l.status !== 'active' ? (l.final_price ? `vendue ${fmt(l.final_price)} WB` : 'terminée') : `${market.timeLeft(l.end_at, now)}${l.bid_count ? ` · ${l.bid_count} ench.` : ''}`}
                  </span>
                </div>
              );
            }}
            empty={error ?? (loading ? 'Chargement…' : tab === 'browse' ? 'Aucune vente ne correspond.' : 'Rien ici pour l’instant.')}
          />
        ) : (
          <div className="board">
            <div className="empty">{error ?? 'Chargement du marché…'}</div>
          </div>
        )}
        {openLot ? <LotPanel initial={openLot} onClose={() => (setOpenLot(null), linked && navigate('/market', { replace: true }))} onChanged={() => setTick((n) => n + 1)} /> : <PanelPlaceholder><div className="ghost" /><p>Choisissez un lot pour voir les enchères et enchérir.</p></PanelPlaceholder>}
      </section>
    </div>
  );
}
