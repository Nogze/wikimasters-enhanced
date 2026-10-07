import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useSession } from '../lib/auth';
import { rememberCards } from '../lib/cardCache';
import { loadCollection, type Item } from '../lib/collection';
import { fmt, RARITY_STYLE } from '../lib/rarity';
import { setQuery, useQuery } from '../lib/router';
import type { Card } from '../lib/types';
import { useKept } from '../lib/kept';
import { CardGrid, savedSize, type CardSize } from './CardGrid';
import { SizeButtons } from './Collection';
import { CardInfoPanel, CardStrip, Loading, PlayerLink } from './common';
import { Modal, Panel, PanelPlaceholder, SearchField, useArmed, useToast } from './kit';

// Guilds: a home with the members' wishlist (ask for one card, give cards to the others), the
// members (leader tools, invitations), the chat, and the weekly guild ranking.

type Guild = { id: string; name: string; description?: string | null; leader_id?: string };
type Membership = { guild_id: string; user_id: string; role: string };
type GuildInfo = { guild: Guild | null; membership: Membership | null; member_count: number; invites?: { guild_id: string; guild_name: string }[] };
type Person = { id?: string; user_id?: string; username?: string; profile?: { username?: string }; user?: { username?: string } };
const nameOf = (p?: Person | null) => p?.username ?? p?.profile?.username ?? p?.user?.username ?? undefined;
type Wish = { id: string; user_id: string; card: Card; can_donate?: boolean; recipient_received_today?: boolean; user?: Person; recipient?: Person };
type Home = {
  my_wishlist?: Wish | null;
  wishlists?: Wish[];
  weekly_karma_donors?: { user_id: string; username?: string; karma?: number; karma_this_week?: number; donations_this_week?: number }[];
  received_donation_today?: boolean;
};
type RankEntry = { rank: number; guild_id: string; guild_name: string; member_count: number; score_battles: number; score_wb: number; total_score: number };
type Ranking = { entries: RankEntry[]; week_start: string; week_end: string; reset_in_ms: number; user_guild_id: string | null };
type Member = Person & { role?: string; joined_at?: string };
type ChatMessage = { id: string; body: string; system: boolean; created_at: string; user: { id: string; username: string } | null };

const TABS = { home: 'Accueil', members: 'Membres', chat: 'Chat', ranking: 'Classement' } as const;
type Tab = keyof typeof TABS;

export function GuildScreen() {
  const me = useSession()?.user.id ?? '';
  const qp = useQuery();
  const [info, setInfo] = useKept<GuildInfo | null>('guild', null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (force = false) => {
    try {
      setInfo(await apiGet<GuildInfo>('/guilds', { ttl: 60_000, force }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const inGuild = !!info?.guild;
  const tab: Tab = qp.get('tab') && qp.get('tab')! in TABS ? (qp.get('tab') as Tab) : inGuild ? 'home' : 'ranking';
  const tabs = (inGuild ? Object.keys(TABS) : ['ranking']) as Tab[];

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{info?.guild?.name ?? 'Guildes'}</h1>
            <span className="muted">{inGuild ? `${info!.member_count} membre${info!.member_count > 1 ? 's' : ''}${info!.membership?.role === 'leader' ? ' · vous êtes le chef' : ''}` : 'Créez une guilde ou rejoignez celle d’un ami'}</span>
          </div>
          {info?.guild?.description && <p style={{ margin: '6px 0 0', color: 'var(--soft)' }}>{info.guild.description}</p>}
          {inGuild && (
            <div className="chips">
              {tabs.map((t) => (
                <button key={t} className={`chip${t === tab ? ' on' : ''}`} aria-pressed={t === tab} onClick={() => setQuery({ tab: t === 'home' ? null : t })}>
                  {TABS[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
      {error && (
        <div className="page">
          <p className="err">{error}</p>
        </div>
      )}
      {!info && !error && <Loading />}
      {info && !inGuild && (
        <div className="page cols">
          <div className="col">
            <GuildRanking />
          </div>
          <div className="col side">
            <NoGuild invites={info.invites ?? []} onJoined={() => void load(true)} />
          </div>
        </div>
      )}
      {info && inGuild && tab === 'home' && <GuildHome me={me} guild={info.guild!} />}
      {info && inGuild && tab === 'members' && <GuildMembers me={me} membership={info.membership} onChanged={() => void load(true)} />}
      {info && inGuild && tab === 'chat' && <GuildChat me={me} guild={info.guild!} />}
      {info && inGuild && tab === 'ranking' && (
        <div className="page">
          <GuildRanking />
        </div>
      )}
    </div>
  );
}

function NoGuild({ invites, onJoined }: { invites: { guild_id: string; guild_name: string }[]; onJoined: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(f: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await f();
      onJoined();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {invites.length > 0 && (
        <div className="card-box">
          <h2>Invitations</h2>
          {invites.map((i) => (
            <div className="row" key={i.guild_id}>
              <b className="grow">{i.guild_name}</b>
              <button className="btn sm primary" disabled={busy} onClick={() => void run(() => apiSend('POST', '/guilds/join', { guild_id: i.guild_id }, { invalidates: ['/guilds'] }))}>
                Rejoindre
              </button>
              <button className="btn sm" disabled={busy} onClick={() => void run(() => apiSend('DELETE', `/guilds/invites/${i.guild_id}`, undefined, { invalidates: ['/guilds'] }))}>
                Refuser
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="card-box"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(() => apiSend('POST', '/guilds', { name: name.trim(), description: description.trim() || undefined }, { invalidates: ['/guilds'] }));
        }}
      >
        <h2>Fonder une guilde</h2>
        <p className="muted" style={{ margin: 0 }}>
          Ou attendez l’invitation d’un ami : elle apparaîtra ici.
        </p>
        <input id="guild-name" className="field" placeholder="Nom de la guilde" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <textarea id="guild-desc" className="field" placeholder="Décrivez votre guilde…" value={description} maxLength={280} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="err">{error}</p>}
        <button className="btn primary" disabled={busy || !name.trim()}>
          {busy ? 'Création…' : 'Créer la guilde'}
        </button>
      </form>
    </>
  );
}

// ---------------------------------------------------------------- home: wishlist

function GuildHome({ me, guild }: { me: string; guild: Guild }) {
  const [home, setHome] = useKept<Home | null>('guild:home', null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [open, setOpen] = useState<Wish | null>(null);
  const [toast, setToast] = useToast();
  const load = useCallback(async (force = false) => {
    try {
      const h = await apiGet<Home>('/guilds/home', { ttl: 60_000, force });
      rememberCards([h.my_wishlist?.card, ...(h.wishlists ?? []).map((w) => w.card)].filter(Boolean) as Card[]);
      setHome(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de charger l’accueil');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function setWish(card: Card) {
    setPicking(false);
    try {
      await apiSend('PUT', '/guilds/wishlist', { card_id: card.id }, { invalidates: ['/guilds/home'] });
      setToast(`Demande enregistrée : ${card.title}.`);
      void load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’enregistrer la demande');
    }
  }
  async function clearWish() {
    try {
      await apiSend('DELETE', '/guilds/wishlist', undefined, { invalidates: ['/guilds/home'] });
      setOpen(null);
      void load(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible de retirer la demande');
    }
  }
  if (picking) return <WishPicker onPick={(c) => void setWish(c)} onCancel={() => setPicking(false)} />;
  if (error)
    return (
      <div className="page">
        <p className="err">{error}</p>
      </div>
    );
  if (!home) return <Loading />;
  const others = (home.wishlists ?? []).filter((w) => w.user_id !== me);
  const mine = home.my_wishlist;

  return (
    <section className="main">
      <div className="board scrollboard">
        <div className="sechead">
          <h2>Ma demande</h2>
          <span className="muted">{home.received_donation_today ? 'Carte reçue aujourd’hui · une par jour au plus' : 'Une carte à la fois, que les membres peuvent vous offrir.'}</span>
        </div>
        {mine ? (
          <CardStrip items={[{ key: `wish-${mine.id}`, card: mine.card, shiny: false, wish: mine }]} width={130} selected={open?.id === mine.id ? `wish-${mine.id}` : null} label={(w) => w.card.title} onPick={() => setOpen(mine)} />
        ) : (
          <div className="strip">
            <div className="slotcell" style={{ width: 130 }}>
              <button className="emptyslot" onClick={() => setPicking(true)}>
                + Demander une carte
              </button>
            </div>
          </div>
        )}
        <div className="sechead" style={{ marginTop: 18 }}>
          <h2>Souhaits des membres</h2>
          <span className="muted">Liseré vert : vous pouvez l’offrir.</span>
        </div>
        <CardStrip
          items={others.map((w) => ({ key: `wish-${w.id}`, card: w.card, shiny: false, wish: w }))}
          width={130}
          selected={open ? `wish-${open.id}` : null}
          label={(w) => `${w.card.title}, demandée par ${nameOf(w.wish.user ?? w.wish.recipient) ?? '?'}`}
          onPick={(w) => setOpen(w.wish)}
          caption={(w) => (
            <>
              <b className={w.wish.can_donate && !w.wish.recipient_received_today ? 'ok' : 'muted'}>{nameOf(w.wish.user ?? w.wish.recipient) ?? '?'}</b>
              <span>{w.wish.recipient_received_today ? 'déjà servi' : w.wish.can_donate ? 'à offrir' : ''}</span>
            </>
          )}
          empty="En attente des souhaits des autres membres."
        />
        {!!home.weekly_karma_donors?.length && (
          <>
            <div className="sechead" style={{ marginTop: 18 }}>
              <h2>Entraide de la semaine</h2>
            </div>
            <div className="table">
              {home.weekly_karma_donors.map((d, i) => (
                <div key={d.user_id} className="trow2">
                  <span className="rank">{`#${i + 1}`}</span>
                  <span className="grow">
                    <PlayerLink name={d.username} />
                  </span>
                  <span className="muted">{`${d.donations_this_week ?? 0} don${(d.donations_this_week ?? 0) > 1 ? 's' : ''}`}</span>
                  <b className="num">{`${fmt(d.karma_this_week ?? d.karma ?? 0)} karma`}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {open ? (
        <CardInfoPanel
          k={`wish-${open.id}`}
          card={open.card}
          shiny={false}
          onClose={() => setOpen(null)}
          extra={
            open.user_id === me ? (
              <button className="btn danger" onClick={() => void clearWish()}>
                Retirer ma demande
              </button>
            ) : (
              <Donate me={me} wish={open} onDone={(msg) => (setToast(msg), setOpen(null), void load(true))} />
            )
          }
        />
      ) : (
        <PanelPlaceholder>
          <div className="ghost" />
          <p>{`Semaine en cours dans ${guild.name} : touchez une carte demandée pour l’offrir.`}</p>
        </PanelPlaceholder>
      )}
      {toast}
    </section>
  );
}

function Donate({ me, wish, onDone }: { me: string; wish: Wish; onDone: (msg: string) => void }) {
  const [copies, setCopies] = useState<Item[] | null>(null);
  const [choose, setChoose] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    loadCollection(false).then(
      (c) => setCopies(c.items.filter((i) => i.card_id === wish.card.id && !i.locked)),
      () => setCopies([]),
    );
  }, [me, wish.card.id]);
  const who = nameOf(wish.user ?? wish.recipient) ?? '?';
  async function donate(userCardId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/guilds/wishlist/donate', { wishlist_id: wish.id, user_card_id: userCardId }, { invalidates: ['/guilds/home', '/collection'] });
      onDone(`Carte offerte à ${who}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Impossible d’offrir la carte');
    } finally {
      setBusy(false);
      setChoose(false);
    }
  }
  if (wish.recipient_received_today) return <p className="muted">{`${who} a déjà reçu une carte aujourd’hui.`}</p>;
  if (copies === null) return <Loading />;
  if (!copies.length) return <p className="muted">Vous ne possédez pas cette carte (ou elle est verrouillée).</p>;
  return (
    <>
      {error && <p className="err">{error}</p>}
      <button className="btn primary" disabled={busy || wish.can_donate === false} onClick={() => (copies.length > 1 ? setChoose(true) : void donate(copies[0]!.id))}>
        {`Offrir à ${who}`}
      </button>
      {choose && (
        <Modal title="Quel exemplaire offrir ?" onClose={() => setChoose(false)} width={380}>
          <div className="peers">
            {copies.map((c) => (
              <button key={c.id} disabled={busy} onClick={() => void donate(c.id)}>
                {`${c.card.title}${c.is_shiny ? ' ✦ brillante' : ''}`}
                <small>{`×${c.count}`}</small>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function WishPicker({ onPick, onCancel }: { onPick: (c: Card) => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [cards, setCards] = useState<(Card & { key: string; card: Card; shiny: boolean })[] | null>(null);
  const [size, setSize] = useState<CardSize>(savedSize);
  useEffect(() => {
    if (q.trim().length < 2) return setCards(null);
    const t = setTimeout(() => {
      apiGet<{ items: Card[] }>(`/cards?${new URLSearchParams({ page: '0', pageSize: '60', q: q.trim() })}`, { ttl: 5 * 60_000 })
        .then((d) => {
          rememberCards(d.items);
          setCards(d.items.map((c) => ({ ...c, key: `pick-${c.id}`, card: c, shiny: false })));
        })
        .catch(() => setCards([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <>
      <section className="main">
        <div className="boardcol">
          <div className="boardtools">
            <SizeButtons size={size} setSize={setSize} />
            <SearchField id="wish-search" value={q} onChange={setQ} placeholder="Chercher dans le catalogue" />
          </div>
          <CardGrid
            items={cards ?? []}
            resetKey={q}
            size={size}
            label={(c) => c.title}
            onPick={(c) => onPick(c.card)}
            caption={(c) => (
              <>
                <b style={{ color: RARITY_STYLE[c.rarity].color }}>{c.rarity}</b>
                <span />
              </>
            )}
            empty={q.trim().length < 2 ? 'Tapez le nom d’un article pour trouver la carte voulue.' : 'Aucune carte ne correspond.'}
          />
        </div>
        <Panel onClose={onCancel} label="Demander une carte">
          <h2>Demander une carte</h2>
          <p className="muted">Cherchez une carte du catalogue et touchez-la : elle devient votre demande auprès de la guilde.</p>
          <div className="spacer" />
          <button className="btn" onClick={onCancel}>
            Annuler
          </button>
        </Panel>
      </section>
    </>
  );
}

// ---------------------------------------------------------------- members

function MemberActions({ m, onAct }: { m: Member; onAct: (path: string, body: unknown) => void }) {
  const [kick, armKick] = useArmed();
  const [lead, armLead] = useArmed();
  const id = m.user_id ?? m.id!;
  return (
    <>
      <button className={`btn sm${lead ? ' confirm' : ''}`} onClick={() => (lead ? onAct('/guilds/transfer-leadership', { user_id: id }) : armLead(true))}>
        {lead ? 'Confirmer ?' : 'Nommer chef'}
      </button>
      <button className={`btn sm ${kick ? 'confirm' : 'danger'}`} onClick={() => (kick ? onAct('/guilds/kick', { user_id: id }) : armKick(true))}>
        {kick ? 'Confirmer ?' : 'Exclure'}
      </button>
    </>
  );
}

function GuildMembers({ me, membership, onChanged }: { me: string; membership: Membership | null; onChanged: () => void }) {
  const [members, setMembers] = useKept<Member[] | null>('guild:members', null);
  const [hasMore, setHasMore] = useState(false);
  const [friends, setFriends] = useState<{ id: string; username: string }[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [leave, armLeave] = useArmed();
  const isLeader = membership?.role === 'leader';
  const load = useCallback(async (from: number, force = false) => {
    const d = await apiGet<{ members?: Member[]; hasMore?: boolean }>(`/guilds/members?limit=50&offset=${from}`, { ttl: 60_000, force });
    const list = d.members ?? [];
    setMembers((prev) => (from === 0 ? list : [...(prev ?? []), ...list]));
    setHasMore(d.hasMore ?? list.length === 50);
  }, []);
  useEffect(() => {
    load(0).catch((e) => setError(String(e.message ?? e)));
  }, [load]);
  useEffect(() => {
    apiGet<{ friends: { id: string; username: string }[] }>('/friends', { ttl: 60_000 })
      .then((d) => setFriends(d.friends))
      .catch(() => {});
  }, []);
  const memberIds = new Set((members ?? []).map((m) => m.user_id ?? m.id));
  async function act(path: string, body: unknown) {
    setError(null);
    try {
      await apiSend('POST', path, body, { invalidates: ['/guilds'] });
      await load(0, true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  }
  const invitable = friends.filter((f) => !memberIds.has(f.id));
  return (
    <div className="page cols">
      <div className="col">
        <div className="card-box">
          <h2>{`Membres${members ? ` (${members.length}${hasMore ? '+' : ''})` : ''}`}</h2>
          {!members && <Loading />}
          {members?.map((m) => {
            const id = m.user_id ?? m.id!;
            return (
              <div className="row" key={id}>
                <PlayerLink name={nameOf(m)} />
                {m.role === 'leader' && <span className="pill">Chef</span>}
                <span className="grow muted">{m.joined_at ? `depuis le ${new Date(m.joined_at).toLocaleDateString('fr')}` : ''}</span>
                {isLeader && id !== me && <MemberActions m={m} onAct={(p, b) => void act(p, b)} />}
              </div>
            );
          })}
          {hasMore && (
            <button className="btn sm" onClick={() => void load(members?.length ?? 0)}>
              Plus de membres
            </button>
          )}
        </div>
      </div>
      <div className="col side">
        <div className="card-box">
          <h2>Inviter des amis</h2>
          {!invitable.length && <p className="muted">Aucun ami à inviter. Ajoutez des amis depuis l’écran Amis.</p>}
          {invitable.map((f) => (
            <div className="row" key={f.id}>
              <PlayerLink name={f.username} />
              <span className="grow" />
              <button
                className="btn sm"
                disabled={invited.has(f.id)}
                onClick={() =>
                  void act('/guilds/invite', { user_id: f.id }).then(() => setInvited((s) => new Set(s).add(f.id)))
                }
              >
                {invited.has(f.id) ? 'Invité' : 'Inviter'}
              </button>
            </div>
          ))}
        </div>
        <div className="card-box">
          <h2>Quitter</h2>
          {isLeader && <p className="muted">Nommez d’abord un autre chef si d’autres membres restent.</p>}
          <button className={`btn ${leave ? 'confirm' : 'danger'}`} onClick={() => (leave ? void act('/guilds/leave', undefined) : armLeave(true))}>
            {leave ? 'Confirmer : quitter la guilde' : 'Quitter la guilde'}
          </button>
        </div>
        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- chat

function GuildChat({ me, guild }: { me: string; guild: Guild }) {
  const [messages, setMessages] = useKept<ChatMessage[] | null>('guild:chat', null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    apiGet<ChatMessage[]>('/guilds/chat', { force: true })
      .then(setMessages)
      .catch((e) => setError(String(e.message ?? e)));
  }, [guild.id]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages?.length]);
  async function send() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      const m = await apiSend<ChatMessage>('POST', '/guilds/chat', { content });
      setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]));
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="main">
      <section className="thread" style={{ flex: 1 }}>
        <div className="log" ref={log}>
          {messages === null && <Loading />}
          {messages?.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>Soyez le premier à écrire dans le chat de la guilde !</p>}
          {messages?.map((m) =>
            m.system ? (
              <div key={m.id} className="day">
                {m.body}
              </div>
            ) : (
              <div key={m.id} className={`msg${m.user?.id === me ? ' me' : ''}`}>
                {m.user?.id !== me && <b className="from">{m.user?.username ?? '?'}</b>}
                <p>{m.body}</p>
                <small>{new Date(m.created_at).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            ),
          )}
        </div>
        {error && <p className="err" style={{ padding: '0 16px' }}>{error}</p>}
        <form
          className="compose"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <input id="guild-chat" className="field" placeholder="Message à la guilde…" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} autoComplete="off" />
          <button className="btn primary" disabled={busy || !text.trim()}>
            Envoyer
          </button>
        </form>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- ranking

function GuildRanking() {
  const [data, setData] = useKept<Ranking | null>('guild:ranking', null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Ranking>('/guilds/leaderboard', { ttl: 5 * 60_000 })
      .then(setData)
      .catch((e) => setError(String(e.message ?? e)));
  }, []);
  const reset = useMemo(() => {
    if (!data) return '';
    const d = Math.floor(data.reset_in_ms / 86_400_000);
    const h = Math.floor((data.reset_in_ms % 86_400_000) / 3_600_000);
    return `${d} j ${h} h`;
  }, [data]);
  if (error) return <p className="err">{error}</p>;
  if (!data) return <Loading />;
  return (
    <div className="card-box">
      <h2>Classement des guildes</h2>
      <p className="muted" style={{ margin: 0 }}>{`Chaque semaine, remis à zéro le lundi (UTC) · dans ${reset}`}</p>
      {!data.entries.length ? (
        <p className="muted">Aucune guilde n’a encore marqué de points cette semaine.</p>
      ) : (
        <div className="table">
          <div className="trow2 th">
            <span className="rank">#</span>
            <span className="grow">Guilde</span>
            <span>Membres</span>
            <span>Enchères</span>
            <b>Total</b>
          </div>
          {data.entries.map((e) => (
            <div key={e.guild_id} className={`trow2${e.guild_id === data.user_guild_id ? ' me' : ''}`}>
              <span className={`rank${e.rank <= 3 ? ` top${e.rank}` : ''}`}>{`#${e.rank}`}</span>
              <span className="grow">{e.guild_name}</span>
              <span className="num">{e.member_count}</span>
              <span className="num">{fmt(e.score_wb)}</span>
              <b className="num">{fmt(e.total_score)}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
