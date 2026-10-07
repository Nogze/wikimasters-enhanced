import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { useSession } from '../lib/auth';
import { linkClick, navigate, setQuery, useQuery } from '../lib/router';
import { useNow } from '../lib/time';
import { useKept } from '../lib/kept';
import { Avatar, ago, href, Loading, PlayerLink } from './common';
import { SearchField, useArmed } from './kit';

// Social: friends (search players, requests, presence) and private messages between friends.

type User = { id: string; username: string };
type Friend = User & { online: boolean; last_seen_at: string | null; since: string | null };
type Request = User & { requestId: string; at: string };
export type Friends = { friends: Friend[]; incoming: Request[]; outgoing: Request[] };

const FRIEND_ERRORS: Record<string, string> = {
  ALREADY_FRIENDS: 'Vous êtes déjà amis.',
  REQUEST_PENDING: 'Demande déjà envoyée.',
  FRIEND_LIMIT: 'Limite d’amis atteinte.',
};
export const addFriend = (username: string) => apiSend('POST', '/friends/requests', { username }, { invalidates: ['/friends', '/players/'] });

// ---------------------------------------------------------------- Amis

function RemoveFriend({ f, busy, onRemove }: { f: Friend; busy: boolean; onRemove: () => void }) {
  const [armed, arm] = useArmed();
  return (
    <button className={`btn sm ${armed ? 'confirm' : 'danger'}`} disabled={busy} onClick={() => (armed ? onRemove() : arm(true))}>
      {armed ? 'Confirmer ?' : 'Retirer'}
    </button>
  );
}

export function FriendsScreen() {
  const me = useSession()?.user.id ?? '';
  const now = useNow(60_000);
  const [data, setData] = useKept<Friends | null>('friends', null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<User[] | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Friends>('/friends', { force: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const v = q.trim();
    if (v.length < 2) return setFound(null);
    const t = setTimeout(() => {
      apiGet<User[]>(`/players?q=${encodeURIComponent(v)}`, { ttl: 60_000 })
        .then((d) => setFound(d.filter((u) => u.id !== me)))
        .catch(() => setFound([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, me]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? (FRIEND_ERRORS[e.code] ?? e.message) : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  }
  const respond = (requestId: string, accept: boolean) => act(() => apiSend('POST', `/friends/requests/${requestId}`, { accept }, { invalidates: ['/friends'] }));
  const known = new Map<string, string>([
    ...(data?.friends ?? []).map((f) => [f.id, 'Déjà amis'] as const),
    ...(data?.outgoing ?? []).map((f) => [f.id, 'Demande envoyée'] as const),
    ...(data?.incoming ?? []).map((f) => [f.id, 'Demande reçue'] as const),
  ]);
  const friends = (data?.friends ?? []).filter((f) => !filter || f.username.toLowerCase().includes(filter.toLowerCase())).sort((a, b) => Number(b.online) - Number(a.online) || a.username.localeCompare(b.username));

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">Amis</h1>
            {data && <span className="muted">{`${data.friends.length} ami${data.friends.length > 1 ? 's' : ''} · ${data.friends.filter((f) => f.online).length} en ligne`}</span>}
          </div>
        </div>
        <div className="tools">
          <SearchField id="friends-filter" value={filter} onChange={setFilter} placeholder="Filtrer mes amis" />
        </div>
      </section>
      <div className="page cols">
        <div className="col">
          {error && <p className="err">{error}</p>}
          {!data && !error && <Loading />}
          {!!data?.incoming.length && (
            <div className="card-box">
              <div className="sechead">
                <h2>{`Demandes reçues (${data.incoming.length})`}</h2>
                {data.incoming.length > 1 && (
                  <button className="btn sm" disabled={busy} onClick={() => void act(() => apiSend('POST', '/friends/requests/accept-all', undefined, { invalidates: ['/friends'] }))}>
                    Tout accepter
                  </button>
                )}
              </div>
              {data.incoming.map((r) => (
                <div className="row" key={r.requestId}>
                  <PlayerLink name={r.username} />
                  <span className="muted grow">{ago(r.at, now)}</span>
                  <button className="btn sm primary" disabled={busy} onClick={() => void respond(r.requestId, true)}>
                    Accepter
                  </button>
                  <button className="btn sm" disabled={busy} onClick={() => void respond(r.requestId, false)}>
                    Refuser
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="card-box">
            <h2>Mes amis</h2>
            {data && !data.friends.length && <p className="muted">Pas encore d’amis : trouvez des joueurs avec la recherche.</p>}
            {friends.map((f) => (
              <div className="row" key={f.id}>
                <PlayerLink name={f.username} online={f.online} />
                <span className="muted grow">{f.online ? 'en ligne' : f.last_seen_at ? `vu ${ago(f.last_seen_at, now)}` : ''}</span>
                <button className="btn sm" onClick={() => navigate(`/dms?with=${f.id}`)}>
                  Message
                </button>
                <button className="btn sm" onClick={() => navigate(`/trades?new=1&with=${f.id}&name=${encodeURIComponent(f.username)}`)}>
                  Échanger
                </button>
                <button className="btn sm" onClick={() => navigate(`/battle?challenge=${f.id}`)}>
                  Défier
                </button>
                <RemoveFriend f={f} busy={busy} onRemove={() => void act(() => apiSend('DELETE', `/friends/${f.id}`, undefined, { invalidates: ['/friends'] }))} />
              </div>
            ))}
          </div>
        </div>
        <div className="col side">
          <div className="card-box">
            <h2>Trouver des joueurs</h2>
            <SearchField id="player-search" value={q} onChange={setQ} placeholder="Nom d’utilisateur" />
            {q.trim().length === 1 && <span className="muted">Au moins 2 caractères…</span>}
            {found?.length === 0 && <span className="muted">{`Aucun joueur pour « ${q.trim()} ».`}</span>}
            {found?.map((u) => (
              <div className="row" key={u.id}>
                <PlayerLink name={u.username} />
                <span className="grow" />
                {known.get(u.id) ? (
                  <span className="pill">{known.get(u.id)}</span>
                ) : (
                  <button className="btn sm primary" disabled={busy} onClick={() => void act(() => addFriend(u.username))}>
                    Ajouter
                  </button>
                )}
              </div>
            ))}
          </div>
          {!!data?.outgoing.length && (
            <div className="card-box">
              <h2>{`Demandes envoyées (${data.outgoing.length})`}</h2>
              {data.outgoing.map((r) => (
                <div className="row" key={r.requestId}>
                  <PlayerLink name={r.username} />
                  <span className="grow" />
                  <button className="btn sm" disabled={busy} onClick={() => void respond(r.requestId, false)}>
                    Annuler
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Messages

type Peer = User & { online?: boolean };
type Conversation = { peer: Peer; last: { id: string; from: string; body: string; created_at: string }; unread: number };
type Message = { id: string; from: string; to: string; body: string; read: boolean; created_at: string };

export function MessagesScreen() {
  const me = useSession()?.user.id ?? '';
  const peerId = useQuery().get('with');
  const [conversations, setConversations] = useKept<Conversation[] | null>('dms', null);
  const [friends, setFriends] = useState<Peer[]>([]);
  const loadList = useCallback(async () => setConversations(await apiGet<Conversation[]>('/dms', { force: true })), []);
  useEffect(() => {
    loadList().catch(() => setConversations([]));
    apiGet<{ friends: Peer[] }>('/friends', { ttl: 60_000 })
      .then((d) => setFriends(d.friends))
      .catch(() => {});
  }, [loadList]);
  const peer = conversations?.find((c) => c.peer.id === peerId)?.peer ?? friends.find((f) => f.id === peerId);
  const startable = friends.filter((f) => !conversations?.some((c) => c.peer.id === f.id));

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <h1 className="h1">Messages</h1>
        </div>
      </section>
      <div className={`main dms${peer ? ' open' : ''}`}>
        <aside className="dmlist">
          {!conversations && <Loading />}
          {conversations?.map((c) => (
            <button key={c.peer.id} className={`dmitem${c.peer.id === peerId ? ' on' : ''}`} onClick={() => setQuery({ with: c.peer.id })}>
              <Avatar name={c.peer.username} online={c.peer.online} />
              <span className="dmmeta">
                <b>{c.peer.username}</b>
                <small>{`${c.last.from === me ? 'Vous : ' : ''}${c.last.body}`}</small>
              </span>
              {c.unread > 0 && c.peer.id !== peerId && <span className="count">{c.unread}</span>}
            </button>
          ))}
          {startable.length > 0 && (
            <>
              <span className="lbl muted" style={{ padding: '12px 4px 4px' }}>
                Nouvelle conversation
              </span>
              {startable.map((f) => (
                <button key={f.id} className={`dmitem${f.id === peerId ? ' on' : ''}`} onClick={() => setQuery({ with: f.id })}>
                  <Avatar name={f.username} online={f.online} />
                  <span className="dmmeta">
                    <b>{f.username}</b>
                    <small>Écrire un message</small>
                  </span>
                </button>
              ))}
            </>
          )}
          {conversations?.length === 0 && friends.length === 0 && (
            <p className="muted">
              Ajoutez des{' '}
              <a href={href('/friends')} onClick={linkClick}>
                amis
              </a>{' '}
              pour leur écrire.
            </p>
          )}
        </aside>
        <section className="thread">
          {peer ? (
            <Thread key={peer.id} me={me} peer={peer} onRead={() => setConversations((cs) => cs?.map((c) => (c.peer.id === peer.id ? { ...c, unread: 0 } : c)) ?? cs)} />
          ) : (
            <div className="empty">Choisissez une conversation.</div>
          )}
        </section>
      </div>
    </div>
  );
}

function Thread({ me, peer, onRead }: { me: string; peer: Peer; onRead: () => void }) {
  const [messages, setMessages] = useKept<Message[] | null>(`dm:${peer.id}`, null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const markRead = () => apiSend('POST', `/dms/${peer.id}/read`).then(onRead, () => {});
    apiGet<Message[]>(`/dms/${peer.id}`, { force: true })
      .then((d) => {
        setMessages(d);
        void markRead();
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [me, peer.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages?.length]);

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const m = await apiSend<Message>('POST', `/dms/${peer.id}`, { body });
      setMessages((prev) => (prev?.some((x) => x.id === m.id) ? prev : [...(prev ?? []), m]));
      setText('');
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'FORBIDDEN' ? 'Vous devez être amis pour échanger des messages.' : e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="threadhead">
        <button className="iconbtn back" aria-label="Retour aux conversations" onClick={() => setQuery({ with: null })}>
          ←
        </button>
        <PlayerLink name={peer.username} online={peer.online} />
        <span className="grow" />
        <button className="btn sm" onClick={() => navigate(`/trades?new=1&with=${peer.id}&name=${encodeURIComponent(peer.username)}`)}>
          Proposer un échange
        </button>
      </header>
      <div className="log" ref={log}>
        {messages === null && <Loading />}
        {messages?.length === 0 && <p className="muted" style={{ textAlign: 'center' }}>{`Démarrez la conversation avec ${peer.username}.`}</p>}
        {messages?.map((m, i) => {
          const day = new Date(m.created_at).toDateString();
          const newDay = i === 0 || new Date(messages[i - 1]!.created_at).toDateString() !== day;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {newDay && <div className="day">{new Date(m.created_at).toLocaleDateString('fr', { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
              <div className={`msg${m.from === me ? ' me' : ''}`}>
                <p>{m.body}</p>
                <small>{new Date(m.created_at).toLocaleTimeString('fr', { hour: '2-digit', minute: '2-digit' })}</small>
              </div>
            </div>
          );
        })}
      </div>
      {error && <p className="err" style={{ padding: '0 16px' }}>{error}</p>}
      <form
        className="compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input id="dm-text" className="field" placeholder={`Message à ${peer.username}`} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <button className="btn primary" disabled={busy || !text.trim()}>
          Envoyer
        </button>
      </form>
    </>
  );
}
