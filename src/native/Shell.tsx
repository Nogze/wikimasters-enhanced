import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from '../lib/account';
import { apiGet, apiSend } from '../lib/api';
import { loadCollection } from '../lib/collection';
import { linkClick, navigate } from '../lib/router';
import { sfx } from '../lib/sfx';
import { mmss, useNow, usePacks } from '../lib/time';
import type { Notification } from '../lib/types';
import { Avatar, ago, href } from './common';
import { Icon, ICON, Overlay } from './kit';
import { GROUPS, groupOf, type ScreenId } from './nav';
import { onTimedResult } from '../lib/timedBids';
import { useToast } from './kit';

// The game frame: resource bar on top (notifications, settings), the sub-navigation of the current
// group, the dock of groups at the bottom, the command palette (Ctrl+K), and the title screen.

// ---------------------------------------------------------------- notifications

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const wb = (v: unknown) => (typeof v === 'number' ? `${v.toLocaleString('fr')} WB` : '');

/** Title, text and destination of each notification type the API sends. */
function view(n: Notification): { title: string; text: string; to: string | null } {
  const d = n.data ?? {};
  const card = str(d.cardTitle);
  const auction = typeof d.auctionId === 'string' ? `/market/${d.auctionId}` : null;
  switch (n.type) {
    case 'auction_outbid':
      return { title: 'Enchère dépassée', text: `${card} · nouvelle enchère ${wb(d.amount)}`, to: auction };
    case 'auction_bid':
      return { title: 'Nouvelle enchère', text: `${card} · ${wb(d.amount)}`, to: auction };
    case 'auction_won':
      return { title: 'Enchère remportée', text: `${card} pour ${wb(d.amount)}`, to: auction };
    case 'auction_sold':
      return { title: 'Carte vendue', text: `${card} pour ${wb(d.amount)}`, to: auction };
    case 'auction_unsold':
      return { title: 'Invendue', text: `${card} est revenue dans votre collection`, to: auction };
    case 'trade_received':
      return { title: 'Offre d’échange reçue', text: '', to: '/trades' };
    case 'trade_countered':
      return { title: 'Contre-proposition reçue', text: '', to: '/trades' };
    case 'trade_accepted':
      return { title: 'Échange accepté', text: '', to: '/trades?box=history' };
    case 'trade_declined':
      return { title: 'Échange refusé', text: '', to: '/trades?box=history' };
    case 'trade_cancelled':
      return { title: 'Échange annulé', text: '', to: '/trades?box=history' };
    case 'friend_request':
      return { title: 'Demande d’ami', text: str(d.username), to: '/friends' };
    case 'friend_accepted':
      return { title: 'Demande d’ami acceptée', text: str(d.username), to: '/friends' };
    case 'guild_invite':
      return { title: 'Invitation de guilde', text: str(d.guildName), to: '/guild' };
    case 'guild_kicked':
      return { title: 'Exclu de la guilde', text: '', to: '/guild' };
    case 'guild_donation':
      return { title: 'Carte offerte par la guilde', text: card, to: '/collection' };
    case 'battle_invite':
      return { title: 'Défi de bataille', text: str(d.username), to: `/battle/${str(d.battleId)}` };
    case 'battle_accepted':
      return { title: 'Défi accepté', text: 'Choisissez votre deck', to: `/battle/${str(d.battleId)}` };
    case 'battle_declined':
      return { title: 'Défi refusé', text: '', to: '/battle' };
    case 'battle_started':
      return { title: 'La bataille commence', text: d.yourTurn ? 'À vous de jouer' : '', to: `/battle/${str(d.battleId)}` };
    case 'battle_attacked':
      return { title: 'Attaque !', text: `Quiz sur ${card}`, to: `/battle/${str(d.battleId)}` };
    case 'battle_won':
      return { title: 'Bataille gagnée', text: '', to: `/battle/${str(d.battleId)}` };
    case 'battle_lost':
      return { title: 'Bataille perdue', text: '', to: `/battle/${str(d.battleId)}` };
    case 'import_done':
      return { title: 'Import wiki-masters terminé', text: `${d.imported ?? 0} cartes importées`, to: '/collection' };
    default: {
      // wiki-masters' own notifications (in the extension): their title and text, and where they point.
      const to = typeof d.auction_id === 'string' ? `/market/${d.auction_id}` : typeof d.trade_id === 'string' ? '/trades' : typeof d.battle_id === 'string' ? `/battle/${d.battle_id}` : /friend/i.test(n.type) ? '/friends' : /guild/i.test(n.type) ? '/guild' : null;
      return { title: str(d.title) || n.type.replace(/_/g, ' '), text: str(d.message) || str(d.card_title) || str(d.wikipedia_title), to };
    }
  }
}

function Notifications() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const now = useNow(60_000);
  useEffect(() => {
    apiGet<{ items: Notification[] }>('/notifications?limit=50', { force: true })
      .then((d) => setItems(d.items ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const unread = items.filter((n) => !n.read).length;
  const markRead = (ids: string[] | 'all') => {
    setItems((prev) => prev.map((n) => (ids === 'all' || ids.includes(n.id) ? { ...n, read: true } : n)));
    apiSend('POST', '/notifications/read', { ids }).catch(() => {});
  };
  return (
    <>
      <button className="iconbtn bell" aria-label={unread ? `Notifications (${unread} non lues)` : 'Notifications'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon d={ICON.bell} size={18} />
        {unread > 0 && <span className="dotbadge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <Overlay>
          <div className="popscrim" onPointerDown={() => setOpen(false)} />
          <div className="popover" role="dialog" aria-label="Notifications">
            <div className="pophead">
              <b>Notifications</b>
              {unread > 0 && (
                <button className="btn link" onClick={() => markRead('all')}>
                  Tout marquer comme lu
                </button>
              )}
            </div>
            {!items.length && <p className="muted">Aucune notification.</p>}
            <div className="notifs">
              {items.map((n) => {
                const v = view(n);
                return (
                  <button
                    key={n.id}
                    className={`notif${n.read ? '' : ' unread'}`}
                    onClick={() => {
                      if (!n.read) markRead([n.id]);
                      if (v.to) {
                        setOpen(false);
                        navigate(v.to);
                      }
                    }}
                  >
                    <b>{v.title}</b>
                    {v.text && <span>{v.text}</span>}
                    <small>{ago(n.created_at, now)}</small>
                  </button>
                );
              })}
            </div>
          </div>
        </Overlay>
      )}
    </>
  );
}

// ---------------------------------------------------------------- command palette

type PaletteItem = { key: string; label: string; hint?: string; to: string; group: string };

function Palette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<PaletteItem[]>([]);
  const [friends, setFriends] = useState<PaletteItem[]>([]);
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    loadCollection(false)
      .then((c) => setCards(c.items.map((it) => ({ key: it.id, label: it.card.title, hint: it.rarity, to: `/collection?card=${it.id}`, group: 'Mes cartes' }))))
      .catch(() => {});
    apiGet<{ friends: { id: string; username: string }[] }>('/friends', { ttl: 60_000 })
      .then((d) => setFriends(d.friends.map((f) => ({ key: f.id, label: f.username, hint: 'Message', to: `/dms?with=${f.id}`, group: 'Amis' }))))
      .catch(() => {});
  }, []);
  const pages: PaletteItem[] = useMemo(() => [...GROUPS.flatMap((g) => g.items.map((it) => ({ key: it.path, label: it.label, to: it.path, group: 'Écrans' }))), { key: '/settings', label: 'Réglages', to: '/settings', group: 'Écrans' }], []);
  const nq = q.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const match = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(nq);
  const results = [...pages.filter((p) => match(p.label)), ...(nq ? friends.filter((f) => match(f.label)).slice(0, 5) : []), ...(nq.length >= 2 ? cards.filter((c) => match(c.label)).slice(0, 12) : [])];
  const go = (it: PaletteItem | undefined) => {
    if (!it) return;
    onClose();
    navigate(it.to);
  };
  return (
    <Overlay>
      <div className="scrim top" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="palette" role="dialog" aria-label="Aller à…">
          <input
            ref={input}
            className="field"
            placeholder="Aller à un écran, une carte, un ami…"
            value={q}
            onChange={(e) => (setQ(e.target.value), setI(0))}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              else if (e.key === 'ArrowDown') (e.preventDefault(), setI((n) => Math.min(results.length - 1, n + 1)));
              else if (e.key === 'ArrowUp') (e.preventDefault(), setI((n) => Math.max(0, n - 1)));
              else if (e.key === 'Enter') go(results[i]);
            }}
          />
          <div className="presults">
            {results.map((r, n) => (
              <button key={`${r.group}-${r.key}`} className={n === i ? 'on' : undefined} onMouseEnter={() => setI(n)} onClick={() => go(r)}>
                <span>{r.label}</span>
                <small>{r.hint ? `${r.group} · ${r.hint}` : r.group}</small>
              </button>
            ))}
            {!results.length && <p className="muted">Rien ne correspond.</p>}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ---------------------------------------------------------------- bars

export function TopBar() {
  const { profile, balance } = useAccount();
  const { packs, cap, nextAt } = usePacks();
  const now = useNow();
  const [palette, setPalette] = useState(false);
  const [toast, setToast] = useToast(6000);
  useEffect(() => onTimedResult((b) => setToast(b.message ?? '')), [setToast]);
  const name = profile?.username ?? '…';
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <header className="top">
      <a className="me" href={href('/profile')} onClick={linkClick} title="Mon profil">
        <Avatar name={name} url={profile?.avatar_url as string | null | undefined} size={32} />
        <span className="who">{name}</span>
      </a>
      <span className="tag-unofficial">Client non officiel · wiki-masters</span>
      <div className="grow" />
      <button className="iconbtn search-k" aria-label="Rechercher (Ctrl+K)" title="Rechercher (Ctrl+K)" onClick={() => setPalette(true)}>
        <Icon d={ICON.search} size={16} />
      </button>
      <button className="stat" title="Paquets en réserve" onClick={() => navigate('/')}>
        <Icon d={ICON.pack} size={14} />
        {`${packs ?? '–'} / ${cap}`}
        {nextAt && <small>{`+1 ${mmss(nextAt - now)}`}</small>}
      </button>
      <div className="stat" title="Wikibidous">
        <Icon d={ICON.coin} size={14} />
        {balance != null ? `${balance.toLocaleString('fr')} WB` : '– WB'}
      </div>
      <Notifications />
      <button className="iconbtn" aria-label="Réglages" onClick={() => navigate('/settings')}>
        <Icon d={ICON.gear} size={18} />
      </button>
      {palette && <Palette onClose={() => setPalette(false)} />}
      {toast}
    </header>
  );
}

/** Tabs of the current group (Mes cartes · Catalogue · Mon profil…). */
export function SubNav({ screen }: { screen: ScreenId }) {
  const g = groupOf(screen);
  if (!g || g.items.length < 2) return null;
  const active = screen === 'player' ? null : screen;
  return (
    <nav className="subnav" aria-label={g.label}>
      {g.items.map((it) => (
        <a key={it.id} href={href(it.path)} onClick={linkClick} className={active === it.id ? 'on' : undefined} aria-current={active === it.id ? 'page' : undefined}>
          {it.label}
        </a>
      ))}
    </nav>
  );
}

/** Remembers the last screen of each group: the dock goes back there. */
const lastOf = new Map<string, string>();

export function Dock({ screen, path, badges }: { screen: ScreenId; path: string; badges?: Partial<Record<string, number>> }) {
  const current = groupOf(screen);
  if (current) lastOf.set(current.id, path + location.search);
  return (
    <nav className="dock" aria-label="Écrans">
      {GROUPS.map((g) => {
        const on = current?.id === g.id;
        const n = badges?.[g.id] ?? 0;
        return (
          <button
            key={g.id}
            className={`tab${on ? ' on' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={() => {
              sfx.click();
              navigate(on ? g.items[0]!.path : (lastOf.get(g.id) ?? g.items[0]!.path));
            }}
          >
            <Icon d={g.icon} size={22} />
            {g.label}
            {n > 0 && <span className="badge">{n > 9 ? '9+' : n}</span>}
          </button>
        );
      })}
    </nav>
  );
}

/** Pending things per group (offers to answer, unread messages, rewards to claim). */
export function useBadges(me: string | null) {
  const [b, setB] = useState<Partial<Record<string, number>>>({});
  useEffect(() => {
    if (!me) return;
    let off = false;
    const load = () => {
      Promise.all([
        apiGet<{ items: { status: string; recipient: { id: string } }[] }>('/trades?box=active', { ttl: 20_000 }).catch(() => ({ items: [] })),
        apiGet<{ unread: number }[]>('/dms', { ttl: 20_000 }).catch(() => []),
        apiGet<{ incoming: unknown[] }>('/friends', { ttl: 20_000 }).catch(() => ({ incoming: [] })),
        apiGet<{ claimable: boolean }[]>('/achievements', { ttl: 60_000 }).catch(() => []),
        apiGet<{ battles: { status: string; opponent_id: string; game_state?: { currentTurnUserId?: string; phase?: string; pendingAttack?: { defenderId?: string } | null } | null }[] }>('/battles', { ttl: 20_000 }).catch(() => ({ battles: [] })),
      ]).then(([t, dms, fr, ach, bt]) => {
        if (off) return;
        setB({
          trades: t.items.filter((x) => x.status === 'pending' && x.recipient.id === me).length,
          social: dms.reduce((s, c) => s + (c.unread ?? 0), 0) + (fr.incoming?.length ?? 0),
          progress: ach.filter((a) => a.claimable).length,
          play: bt.battles.filter((x) => (x.status === 'pending' && x.opponent_id === me) || (x.status === 'active' && (x.game_state?.pendingAttack ? x.game_state.pendingAttack.defenderId === me : x.game_state?.currentTurnUserId === me))).length,
        });
      });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      off = true;
      clearInterval(t);
    };
  }, [me]);
  return b;
}

/** Title over the world: tap anywhere to start (the gesture that unlocks audio). */
export function TitleScreen({ onStart }: { onStart: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const start = () => {
    if (leaving) return;
    sfx.step(3);
    sfx.summon(0.4);
    setLeaving(true);
    setTimeout(onStart, 450);
  };
  return (
    <div className="center" onClick={start} style={{ transition: 'opacity .45s, transform .45s', opacity: leaving ? 0 : 1, transform: leaving ? 'scale(1.15)' : undefined }}>
      <button className="title" style={{ background: 'none', border: 0 }} onClick={start} autoFocus>
        <h1>Wikimasters</h1>
        <span className="lbl">Enhanced</span>
        <span className="go">TOUCHEZ POUR JOUER</span>
      </button>
      <p className="legal">
        Client non officiel pour wiki-masters.com : vous jouez avec votre compte wiki-masters, sur leurs serveurs. · Textes et images : Wikipédia & Wikimedia Commons (CC BY-SA)
      </p>
    </div>
  );
}

