import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { refreshBalance, useAccount } from '../lib/account';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/auth';
import { loadCollection, useOwnedCounts, type Item } from '../lib/collection';
import { fmt, RARITY_ORDER, RARITY_STYLE } from '../lib/rarity';
import { setQuery as setUrl, useQuery } from '../lib/router';
import { useNow } from '../lib/time';
import * as trades from '../lib/trades';
import type { PartnerCard, Person, Trade } from '../lib/trades';
import type { Card } from '../lib/types';
import { CardGrid, savedSize, type CardSize } from './CardGrid';
import { norm, SizeButtons } from './Collection';
import { Icon, ICON, Modal, Panel, SearchField, useArmed, useToast } from './kit';

// Trades: offers received / sent / closed as a list; an offer opens with its cards on the board
// (what you get, what you give) and a panel to accept, decline, counter or cancel. Composing picks
// cards straight off the board — yours or your partner's — plus wikibidous.

type Tab = 'received' | 'sent' | 'history';
const TABS: { id: Tab; label: string }[] = [
  { id: 'received', label: 'REÇUES' },
  { id: 'sent', label: 'ENVOYÉES' },
  { id: 'history', label: 'HISTORIQUE' },
];
type Mode = { kind: 'list' } | { kind: 'view'; trade: Trade } | { kind: 'compose'; peer: Person | null; counterOf?: Trade };
type Side = 'give' | 'take';
type Entry = { key: string; card: Card; shiny: boolean; cardId: string; locked?: boolean; count?: number; quantity?: number; side?: Side };
type Picked = { side: Side; item: Entry };
type Source = 'mine' | 'theirs' | 'offer';

const rank = (r: Entry) => RARITY_ORDER.indexOf(r.card.rarity) - (r.shiny ? 0.5 : 0);
const plural = (n: number, w: string) => `${fmt(n)} ${w}${n > 1 ? 's' : ''}`;

/** "Tour Eiffel + 2 autres · 50 WB", or "Rien". */
function describe(items: trades.TradeItem[], wb: number) {
  const best = [...items].sort((a, b) => RARITY_ORDER.indexOf(a.card.rarity) - RARITY_ORDER.indexOf(b.card.rarity))[0];
  const n = items.reduce((s, i) => s + i.quantity, 0);
  const cards = best ? `${best.card.title}${n > 1 ? ` + ${n - 1} autre${n > 2 ? 's' : ''}` : ''}` : '';
  const money = wb ? `${fmt(wb)} WB` : '';
  return [cards, money].filter(Boolean).join(' · ') || 'Rien';
}
const statusOf = (t: Trade) => trades.STATUS[t.status] ?? { label: t.status.toUpperCase(), color: '#9aa6c8' };

// ---------------------------------------------------------------- list

function TradeRows({ items, me, onOpen, empty }: { items: Trade[]; me: string; onOpen: (t: Trade) => void; empty: string }) {
  const now = useNow(30_000);
  if (!items.length)
    return (
      <div className="rows">
        <div className="empty" style={{ position: 'static', paddingTop: 80 }}>
          {empty}
        </div>
      </div>
    );
  return (
    <div className="rows">
      {items.map((t) => {
        const s = trades.sides(t, me);
        const st = statusOf(t);
        return (
          <button key={t.id} className={`trow${t.status === 'pending' && !s.mine ? ' attn' : ''}`} data-trade={t.id} onClick={() => onOpen(t)}>
            <span className="who2">{s.other.username}</span>
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="when">{`${s.mine ? 'envoyée' : 'reçue'} ${trades.ago(t.created_at, now)}`}</span>
              <span className="status" style={{ background: st.color }}>
                {st.label}
              </span>
            </span>
            <span className="sides">
              <div>
                <span className="lbl get">Tu reçois</span>
                {describe(s.get, s.getWb)}
              </div>
              <div>
                <span className="lbl give">Tu donnes</span>
                {describe(s.give, s.giveWb)}
              </div>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- panels (view / compose)

function TradePanel({ trade, me, onClose, onChanged, onCounter }: { trade: Trade; me: string; onClose: () => void; onChanged: () => void; onCounter: () => void }) {
  const now = useNow(30_000);
  const [busy, setBusy] = useState(false);
  const [accept, armAccept] = useArmed();
  const [cancel, armCancel] = useArmed();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const s = trades.sides(trade, me);
  const st = statusOf(trade);
  const pending = trade.status === 'pending';
  const count = (xs: trades.TradeItem[]) => xs.reduce((n, i) => n + i.quantity, 0);
  const act = async (action: 'accept' | 'decline' | 'cancel') => {
    setBusy(true);
    setError(null);
    try {
      await trades.respond(trade.id, action);
      setNote(action === 'accept' ? 'Échange conclu ! Les cartes ont changé de main.' : action === 'decline' ? 'Offre refusée.' : 'Offre annulée.');
      refreshBalance().catch(() => {});
      onChanged();
      setTimeout(onClose, 1400);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
      armAccept(false);
      armCancel(false);
    }
  };
  return (
    <Panel onClose={onClose} label={`Échange avec ${s.other.username}`}>
      <span className="status" style={{ background: st.color, justifySelf: 'start', alignSelf: 'flex-start' }}>
        {st.label}
      </span>
      <h2>{s.other.username}</h2>
      <span className="muted">{`${s.mine ? 'Offre envoyée' : 'Offre reçue'} ${trades.ago(trade.created_at, now)}${trade.parent_trade_id ? ' · contre-offre' : ''}`}</span>
      <div className="box">
        <span className="lbl get">{`Tu reçois · ${plural(count(s.get), 'carte')}`}</span>
        <b>{describe(s.get, s.getWb)}</b>
      </div>
      <div className="box">
        <span className="lbl give">{`Tu donnes · ${plural(count(s.give), 'carte')}`}</span>
        <b>{describe(s.give, s.giveWb)}</b>
      </div>
      {trade.message && <p style={{ color: 'var(--soft)' }}>{`« ${trade.message} »`}</p>}
      <p className="hint">Les cartes de l’offre sont sur le plateau, marquées « reçue » ou « donnée ».</p>
      <div className="spacer" />
      {error && <p className="err" role="alert">{error}</p>}
      {note && <p className="ok">{note}</p>}
      {pending && !s.mine && !note && (
        <>
          <button className={`btn big ${accept ? 'confirm' : 'primary'}`} disabled={busy} onClick={() => (accept ? void act('accept') : armAccept(true))}>
            {accept ? 'Confirmer l’échange' : 'Accepter'}
          </button>
          <div className="row2">
            <button className="btn" disabled={busy} onClick={() => void act('decline')}>
              Refuser
            </button>
            <button className="btn" disabled={busy} onClick={onCounter}>
              Contre-offre
            </button>
          </div>
        </>
      )}
      {pending && s.mine && !note && (
        <button className={`btn ${cancel ? 'confirm' : 'danger'}`} disabled={busy} onClick={() => (cancel ? void act('cancel') : armCancel(true))}>
          {cancel ? 'Confirmer l’annulation ?' : 'Annuler l’offre'}
        </button>
      )}
    </Panel>
  );
}

function OfferPanel({ peer, counterOf, picked, onRemove, giveWb, takeWb, setGiveWb, setTakeWb, message, setMessage, onCancel, onSent }: {
  peer: Person;
  counterOf?: Trade;
  picked: Map<string, Picked>;
  onRemove: (id: string) => void;
  giveWb: string;
  takeWb: string;
  setGiveWb: (v: string) => void;
  setTakeWb: (v: string) => void;
  message: string;
  setMessage: (v: string) => void;
  onCancel: () => void;
  onSent: () => void;
}) {
  const { balance } = useAccount();
  const [busy, setBusy] = useState(false);
  const [armed, arm] = useArmed();
  const [error, setError] = useState<string | null>(null);
  const list = [...picked.entries()].sort((a, b) => (a[1].side === b[1].side ? rank(a[1].item) - rank(b[1].item) : a[1].side === 'take' ? -1 : 1));
  const give = list.filter(([, p]) => p.side === 'give');
  const take = list.filter(([, p]) => p.side === 'take');
  const gw = Number(giveWb || 0);
  const tw = Number(takeWb || 0);
  useEffect(() => arm(false), [picked, giveWb, takeWb]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!give.length && !take.length && !gw && !tw) return setError('Ajoutez au moins une carte ou des wikibidous.');
    if (give.length > trades.MAX_CARDS || take.length > trades.MAX_CARDS) return setError(`Maximum ${trades.MAX_CARDS} cartes par côté.`);
    if (gw > trades.MAX_WB || tw > trades.MAX_WB) return setError(`Maximum ${fmt(trades.MAX_WB)} WB par côté.`);
    if (balance != null && gw > balance) return setError(`Solde insuffisant (${fmt(balance)} WB).`);
    if (!armed) return arm(true);
    setBusy(true);
    setError(null);
    try {
      const ref = (xs: typeof give) => xs.map(([id, p]) => ({ userCardId: id, cardId: p.item.cardId, quantity: 1 }));
      await trades.propose({ recipientId: peer.id, give: ref(give), take: ref(take), giveWb: gw, takeWb: tw, message: message.trim() || undefined, parentTradeId: counterOf?.id });
      refreshBalance().catch(() => {});
      onSent();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
      arm(false);
    } finally {
      setBusy(false);
    }
  };
  const sides = [
    { side: 'take' as const, label: 'Tu reçois', cls: 'get', n: take.length, wb: takeWb, set: setTakeWb, id: 'trade-take-wb' },
    { side: 'give' as const, label: 'Tu donnes', cls: 'give', n: give.length, wb: giveWb, set: setGiveWb, id: 'trade-give-wb' },
  ];
  return (
    <Panel onClose={onCancel} label="Votre offre">
      <h2>{counterOf ? 'Contre-offre' : 'Votre offre'}</h2>
      <span className="muted">{`à ${peer.username}`}</span>
      {sides.map((b) => (
        <div className="box" key={b.side} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <span className={`lbl ${b.cls}`}>{b.label}</span>
            <div style={{ fontWeight: 600 }}>{plural(b.n, 'carte')}</div>
          </div>
          <input id={b.id} className="field" style={{ width: 110 }} inputMode="numeric" aria-label={`${b.label} (WB)`} placeholder="+ WB" value={b.wb} onChange={(e) => b.set(e.target.value.replace(/\D/g, '').slice(0, 5))} />
        </div>
      ))}
      {list.length ? (
        <div className="list">
          {list.map(([id, p]) => (
            <div className="li" key={id}>
              <span className="chip" style={{ height: 'auto', padding: 0, border: 0 }}>
                <span className="dot" style={{ background: RARITY_STYLE[p.item.card.rarity].color }} />
              </span>
              <span className={`t ${p.side === 'take' ? 'get' : 'give'}`}>{`${p.side === 'take' ? '+' : '−'} ${p.item.card.title}${p.item.shiny ? ' ✦' : ''}`}</span>
              <button className="iconbtn" style={{ width: 26, height: 26 }} aria-label={`Retirer ${p.item.card.title}`} onClick={() => onRemove(id)}>
                <Icon d={ICON.close} size={10} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Touchez des cartes sur le plateau : les vôtres (MES CARTES) ou celles de votre partenaire.</p>
      )}
      <div className="spacer" />
      <textarea id="trade-message" className="field" placeholder="Message (facultatif)" value={message} onChange={(e) => setMessage(e.target.value.slice(0, 500))} />
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row2">
        <button className="btn" onClick={onCancel}>
          Annuler
        </button>
        <button className={`btn ${armed ? 'confirm' : 'primary'}`} disabled={busy} onClick={() => void send()}>
          {armed ? 'Confirmer l’envoi' : 'Envoyer l’offre'}
        </button>
      </div>
    </Panel>
  );
}

function PeerPicker({ onPick, onClose }: { onPick: (p: Person) => void; onClose: () => void }) {
  const [friends, setFriends] = useState<(Person & { online?: boolean })[] | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    trades
      .friends()
      .then(setFriends)
      .catch((e) => (setFriends([]), setError(e instanceof ApiError ? e.message : 'Erreur réseau')));
  }, []);
  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) return setFound(null);
    const t = setTimeout(() => trades.searchPlayers(v).then(setFound, () => setFound([])), 300);
    return () => clearTimeout(t);
  }, [q]);
  const people = found ?? friends ?? [];
  return (
    <Modal title="Échanger avec…" onClose={onClose} width={420}>
      <SearchField id="trade-peer" value={q} onChange={setQ} placeholder="Chercher un joueur" />
      <span className="lbl muted">{found ? 'Joueurs' : 'Vos amis'}</span>
      <div className="peers">
        {people.map((p) => (
          <button key={p.id} onClick={() => onPick(p)}>
            {p.username}
            {(p as { online?: boolean }).online && <small>EN LIGNE</small>}
          </button>
        ))}
      </div>
      {!people.length && <p className="muted">{error ?? (friends === null ? 'Chargement…' : found ? 'Aucun joueur trouvé.' : 'Pas encore d’amis : cherchez un joueur ci-dessus.')}</p>}
    </Modal>
  );
}

// ---------------------------------------------------------------- screen

export function TradesScreen() {
  const me = useSession()?.user.id ?? '';
  const [tab, setTab] = useState<Tab>('received');
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [active, setActive] = useState<Trade[] | null>(null);
  const [history, setHistory] = useState<Trade[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [size, setSize] = useState<CardSize>(savedSize);
  const [toast, setToast] = useToast(3500);

  // Composer state
  const [source, setSource] = useState<Source>('theirs');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [mine, setMine] = useState<Item[] | null>(null);
  const [theirs, setTheirs] = useState<PartnerCard[] | null>(null);
  const [theirsMore, setTheirsMore] = useState(false);
  const [theirsPage, setTheirsPage] = useState(0);
  const [picked, setPicked] = useState<Map<string, Picked>>(new Map());
  const [giveWb, setGiveWb] = useState('');
  const [takeWb, setTakeWb] = useState('');
  const [message, setMessage] = useState('');
  const loadingMore = useRef(false);
  const ownedCounts = useOwnedCounts();
  const peer = mode.kind === 'compose' ? mode.peer : null;

  // Offers: pending ones always (badge), history when that tab is open; refreshed every 20 s.
  useEffect(() => {
    let off = false;
    const load = () => {
      trades.list('active').then(
        (t) => !off && (setActive(t), setError(null)),
        (e) => !off && setError(e instanceof ApiError ? e.message : 'Erreur réseau'),
      );
      if (tab === 'history') trades.list('history').then((t) => !off && setHistory(t), () => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [tab, tick]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => {
    if (mode.kind === 'compose' && !mine) loadCollection(false).then((c) => setMine(c.items), () => setMine([]));
  }, [mode.kind, mine]);
  // Partner's cards: first page whenever the partner or the search changes.
  useEffect(() => {
    if (!peer) return;
    let off = false;
    setTheirs(null);
    trades.partnerCards(peer, debounced, 0).then(
      (r) => !off && (setTheirs(r.items), setTheirsMore(r.hasMore), setTheirsPage(0)),
      (e) => !off && (setTheirs([]), setToast(e instanceof ApiError ? e.message : 'Erreur réseau')),
    );
    return () => {
      off = true;
    };
  }, [peer, debounced, setToast]);
  const more = useCallback(() => {
    if (!peer || source !== 'theirs' || !theirsMore || loadingMore.current) return;
    loadingMore.current = true;
    trades
      .partnerCards(peer, debounced, theirsPage + 1)
      .then((r) => {
        setTheirs((l) => [...(l ?? []), ...r.items.filter((x) => !l?.some((y) => y.id === x.id))]);
        setTheirsMore(r.hasMore);
        setTheirsPage((p) => p + 1);
      })
      .catch(() => {})
      .finally(() => (loadingMore.current = false));
  }, [peer, source, theirsMore, debounced, theirsPage]);

  const startCompose = (p: Person | null, counterOf?: Trade) => {
    setPicked(new Map());
    setGiveWb('');
    setTakeWb('');
    setMessage('');
    setQuery('');
    setSource(counterOf ? 'offer' : 'theirs');
    setMode({ kind: 'compose', peer: p, counterOf });
    if (!counterOf) return;
    // Counter-offer: start from the offer, sides as they are for me.
    const s = trades.sides(counterOf, me);
    const m = new Map<string, Picked>();
    let missing = 0;
    for (const [side, xs] of [['give', s.give], ['take', s.get]] as const)
      for (const it of xs) {
        if (!it.user_card_id) missing++;
        else m.set(it.user_card_id, { side, item: { key: it.user_card_id, card: it.card, shiny: it.is_shiny, cardId: it.card.id } });
      }
    setPicked(m);
    setGiveWb(s.giveWb ? String(s.giveWb) : '');
    setTakeWb(s.getWb ? String(s.getWb) : '');
    if (missing) setToast(`${plural(missing, 'carte')} de l’offre n’${missing > 1 ? 'existent' : 'existe'} plus.`);
  };

  // Links from elsewhere: ?new=1[&with=<player id>][&give=<my card>] starts an offer, ?box=history.
  const qp = useQuery();
  const deep = useRef(false);
  useEffect(() => {
    if (deep.current) return;
    deep.current = true;
    if (qp.get('box') === 'history') setTab('history');
    if (qp.get('new') !== '1') return;
    const withId = qp.get('with');
    const give = qp.get('give');
    const start = (p: Person | null) => {
      startCompose(p);
      if (give)
        loadCollection(false).then(
          (c) => {
            const it = c.items.find((i) => i.id === give);
            if (!it || it.locked) return;
            setPicked(new Map([[it.id, { side: 'give', item: { key: it.id, card: { ...it.card, rarity: it.rarity }, shiny: it.is_shiny, cardId: it.card.id } }]]));
          },
          () => {},
        );
    };
    const name = qp.get('name');
    if (withId && name) start({ id: withId, username: name });
    else if (withId) trades.friends().then((fs) => start(fs.find((f) => f.id === withId) ?? null), () => start(null));
    else start(null);
    setUrl({ new: null, with: null, name: null, give: null, box: null });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (it: Entry, side: Side) => {
    const n = new Map(picked);
    if (n.has(it.key)) n.delete(it.key);
    else {
      if (it.locked && side === 'give') return setToast('Carte verrouillée : déverrouillez-la dans la collection pour l’échanger.');
      if ([...n.values()].filter((p) => p.side === side).length >= trades.MAX_CARDS) return setToast(`Maximum ${trades.MAX_CARDS} cartes par côté.`);
      n.set(it.key, { side, item: it });
    }
    setPicked(n);
  };

  // What the board shows.
  const board = useMemo((): Entry[] | null => {
    if (mode.kind === 'view') {
      const s = trades.sides(mode.trade, me);
      return [...s.get, ...s.give].map((i, n) => ({ key: `${mode.trade.id}:${n}`, card: i.card, shiny: i.is_shiny, cardId: i.card.id, side: (i.offered_by === me ? 'give' : 'take') as Side, quantity: i.quantity }));
    }
    if (mode.kind !== 'compose' || !peer) return null;
    if (source === 'offer') return [...picked.values()].sort((a, b) => (a.side === b.side ? rank(a.item) - rank(b.item) : a.side === 'take' ? -1 : 1)).map((p) => ({ ...p.item, side: p.side }));
    if (source === 'mine') {
      if (!mine) return null;
      const q = norm(debounced);
      return mine
        .filter((i) => !q || norm(i.card.title).includes(q))
        .map((i) => ({ key: i.id, card: { ...i.card, rarity: i.rarity }, shiny: i.is_shiny, cardId: i.card.id, locked: i.locked, count: i.count }))
        .sort((a, b) => rank(a) - rank(b) || a.card.title.localeCompare(b.card.title));
    }
    return theirs ? theirs.map((t) => ({ key: t.id, card: t.card, shiny: t.is_shiny, cardId: t.card.id, locked: t.locked, count: t.count })) : null;
  }, [mode, me, peer, source, picked, mine, theirs, debounced]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && mode.kind === 'view' && setMode({ kind: 'list' });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode.kind]);

  const received = (active ?? []).filter((t) => t.recipient.id === me);
  const sent = (active ?? []).filter((t) => t.initiator.id === me);
  const shown = tab === 'received' ? received : tab === 'sent' ? sent : (history ?? []);
  const counts = { give: [...picked.values()].filter((p) => p.side === 'give').length, take: [...picked.values()].filter((p) => p.side === 'take').length };
  const composing = mode.kind === 'compose' && !!peer;
  const title = mode.kind === 'compose' ? (mode.counterOf ? 'Contre-offre' : 'Proposer un échange') : mode.kind === 'view' ? 'Échange' : 'Échanges';
  const sideOf = (e: Entry): Side => e.side ?? (source === 'mine' ? 'give' : 'take');

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{title}</h1>
            <span className="muted">{composing ? `Avec ${peer!.username} · touchez une carte pour l’ajouter à l’offre ou l’en retirer` : mode.kind === 'list' && received.length ? `${plural(received.length, 'offre')} à traiter` : ''}</span>
          </div>
          <div className="chips">
            {mode.kind === 'list' &&
              TABS.map((t) => (
                <button key={t.id} className={`chip${tab === t.id ? ' on' : ''}`} aria-pressed={tab === t.id} onClick={() => (setTab(t.id), setMode({ kind: 'list' }))}>
                  {t.label}
                  {t.id === 'received' && received.length > 0 && <span className="n">{received.length}</span>}
                </button>
              ))}
            {mode.kind === 'view' && (
              <button className="chip" onClick={() => setMode({ kind: 'list' })}>
                ← RETOUR AUX OFFRES
              </button>
            )}
            {composing &&
              (
                [
                  { id: 'mine', label: 'MES CARTES', count: counts.give },
                  { id: 'theirs', label: `CARTES DE ${peer!.username.toUpperCase()}`, count: counts.take },
                  { id: 'offer', label: 'L’OFFRE', count: counts.give + counts.take },
                ] as const
              ).map((c) => (
                <button key={c.id} className={`chip${source === c.id ? ' on' : ''}`} aria-pressed={source === c.id} onClick={() => (setSource(c.id), setQuery(''))}>
                  {c.label}
                  {c.count > 0 && <span className="n">{c.count}</span>}
                </button>
              ))}
          </div>
        </div>
        <div className="tools">
          {mode.kind === 'list' && (
            <button className="btn primary" onClick={() => startCompose(null)}>
              + Proposer un échange
            </button>
          )}
          {mode.kind !== 'list' && <SizeButtons size={size} setSize={setSize} />}
          {composing && source !== 'offer' && <SearchField id="trade-search" value={query} onChange={setQuery} />}
        </div>
      </section>

      {mode.kind === 'list' &&
        (active === null || (tab === 'history' && history === null) ? (
          <div className="rows">
            <div className="empty" style={{ position: 'static', paddingTop: 80 }}>
              {error ?? 'Chargement des échanges…'}
            </div>
          </div>
        ) : (
          <TradeRows
            items={shown}
            me={me}
            onOpen={(t) => setMode({ kind: 'view', trade: t })}
            empty={error ?? (tab === 'received' ? 'Aucune offre reçue en attente.' : tab === 'sent' ? 'Aucune offre envoyée en attente.' : 'Aucun échange terminé.')}
          />
        ))}

      {mode.kind !== 'list' && (
        <section className="main">
          {board ? (
            <CardGrid
              items={board}
              resetKey={`${mode.kind}|${mode.kind === 'view' ? mode.trade.id : ''}|${source}|${debounced}`}
              size={size}
              hasMore={composing && source === 'theirs' && theirsMore}
              onMore={more}
              label={(e) => `${e.card.title}${mode.kind === 'compose' ? (picked.has(e.key) ? ', dans l’offre' : ', ajouter à l’offre') : ''}`}
              slotClass={(e) => (mode.kind === 'compose' && picked.has(e.key) ? `picked ${picked.get(e.key)!.side === 'give' ? 'give' : ''}` : undefined)}
              onPick={mode.kind === 'compose' ? (e) => toggle(e, picked.get(e.key)?.side ?? sideOf(e)) : undefined}
              caption={(e) => {
                if (mode.kind === 'view' || source === 'offer') {
                  const side = e.side ?? 'take';
                  return (
                    <>
                      <b className={side === 'take' ? 'get' : 'give'}>{side === 'take' ? 'REÇUE' : 'DONNÉE'}</b>
                      <span>{(e.quantity ?? 1) > 1 ? `×${e.quantity}` : mode.kind === 'compose' ? 'toucher pour retirer' : ''}</span>
                    </>
                  );
                }
                const on = picked.has(e.key);
                if (e.locked && source === 'mine')
                  return (
                    <>
                      <b className="muted">Verrouillée</b>
                      <span />
                    </>
                  );
                return (
                  <>
                    <b className={on ? (source === 'mine' ? 'give' : 'get') : 'muted'}>{on ? '✓ Dans l’offre' : '+ Ajouter'}</b>
                    <span>
                      {source === 'theirs' && ownedCounts?.get(e.card.id) ? <i className="own" title="Déjà dans votre collection">{`✓ possédée${ownedCounts.get(e.card.id)! > 1 ? ` ×${ownedCounts.get(e.card.id)}` : ''}`}</i> : null}
                      {(e.count ?? 1) > 1 ? ` ×${e.count}` : ''}
                    </span>
                  </>
                );
              }}
              empty={source === 'offer' && mode.kind === 'compose' ? 'L’offre est vide : ajoutez des cartes depuis MES CARTES ou celles de votre partenaire.' : 'Aucune carte ne correspond.'}
            />
          ) : (
            <div className="board">
              <div className="empty">{mode.kind === 'compose' && !peer ? 'Choisissez un joueur.' : 'Chargement des cartes…'}</div>
            </div>
          )}
          {mode.kind === 'view' && <TradePanel key={mode.trade.id} trade={mode.trade} me={me} onClose={() => setMode({ kind: 'list' })} onChanged={() => setTick((n) => n + 1)} onCounter={() => startCompose(trades.sides(mode.trade, me).other, mode.trade)} />}
          {composing && (
            <OfferPanel
              peer={peer!}
              counterOf={mode.kind === 'compose' ? mode.counterOf : undefined}
              picked={picked}
              onRemove={(id) => setPicked((m) => (m.delete(id), new Map(m)))}
              giveWb={giveWb}
              takeWb={takeWb}
              setGiveWb={setGiveWb}
              setTakeWb={setTakeWb}
              message={message}
              setMessage={setMessage}
              onCancel={() => setMode({ kind: 'list' })}
              onSent={() => {
                setToast(`Offre envoyée à ${peer!.username}.`);
                setMode({ kind: 'list' });
                setTab('sent');
                setTick((n) => n + 1);
              }}
            />
          )}
        </section>
      )}
      {mode.kind === 'compose' && !mode.peer && <PeerPicker onPick={(p) => setMode({ kind: 'compose', peer: p })} onClose={() => setMode({ kind: 'list' })} />}
      {toast}
    </div>
  );
}
