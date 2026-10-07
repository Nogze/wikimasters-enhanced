import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, apiGet } from '../lib/api';
import { useSession } from '../lib/auth';
import * as battles from '../lib/battles';
import type { Battle, Detail, Quota } from '../lib/battles';
import { getCards } from '../lib/cardCache';
import { loadCollection } from '../lib/collection';
import { fmt, RARITY_STYLE } from '../lib/rarity';
import { navigate, useQuery } from '../lib/router';
import { sfx } from '../lib/sfx';
import { useNow } from '../lib/time';
import type { Card } from '../lib/types';
import { useKept } from '../lib/kept';
import { CardGrid, savedSize, type CardSize } from './CardGrid';
import { norm, SizeButtons } from './Collection';
import { ago, CardStrip, Loading, PlayerLink } from './common';
import { BigCard, Modal, Panel, PanelPlaceholder, SearchField, useArmed, useToast } from './kit';

// Quiz battles against a friend: decks of 3 cards (HP = sum of DEF), attacks answered by a quiz on
// the attacking card's article (damage = ATK × wrong answers / questions). wiki-masters' rules.

/** No cards known yet (one shared empty map, so it is stable between renders). */
const NO_CARDS = new Map<string, Card>();

const resultOf = (b: Battle, me: string) => (b.status === 'completed' ? (b.winner_id === me ? 'Victoire' : 'Défaite') : (battles.STATUS[b.status] ?? b.status));

function Help({ quota, onClose }: { quota: Quota | null; onClose: () => void }) {
  return (
    <Modal title="Comment se déroule une bataille ?" onClose={onClose} width={520}>
      <p>Défiez un ami. Une fois le défi accepté, chacun choisit <b>{battles.DECK_SIZE} cartes</b> : vos PV de départ sont la somme de leurs <b>DEF</b>.</p>
      <p>À votre tour, attaquez avec une carte qui n’a pas encore servi. Votre adversaire répond à un quiz sur son article Wikipédia : <b>dégâts = ATK × réponses fausses ÷ questions</b>. Toutes justes, aucun dégât.</p>
      <p>Un joueur à 0 PV a perdu. Quand toutes les cartes ont attaqué, le meilleur rapport PV restants / PV max gagne, puis les PV bruts ; en égalité parfaite, le dernier défenseur l’emporte.</p>
      <p className="muted">{`${quota?.limit ?? 3} défis par jour. Un défi sans réponse expire au bout d’une journée ; le joueur qui ne joue plus pendant deux jours perd.`}</p>
      <button className="btn primary" onClick={onClose}>
        Compris
      </button>
    </Modal>
  );
}

// ---------------------------------------------------------------- list

export function BattlesScreen() {
  const me = useSession()?.user.id ?? '';
  const qp = useQuery();
  const now = useNow(60_000);
  const [data, setData] = useKept<{ battles: Battle[]; challenge_quota: Quota } | null>('battles', null);
  const [friends, setFriends] = useKept<{ id: string; username: string; online?: boolean }[] | null>('friends:list', null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const load = useCallback(() => battles.list().then(setData, (e) => setError(e instanceof Error ? e.message : String(e))), []);
  useEffect(() => {
    void load();
    apiGet<{ friends: { id: string; username: string; online?: boolean }[] }>('/friends', { ttl: 60_000 }).then((d) => setFriends(d.friends), () => setFriends([]));
    // No push from wiki-masters: poll.
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  const quota = data?.challenge_quota;
  const full = !!quota && quota.used >= quota.limit;
  const target = qp.get('challenge');

  async function challenge(id: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await battles.challenge(id);
      const bid = r.battle?.id ?? r.id;
      sfx.click();
      if (bid) navigate(`/battle/${bid}`);
      else void load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  }
  const open = (data?.battles ?? []).filter((b) => ['pending', 'deck_selection', 'generating_quizzes', 'active'].includes(b.status));
  const done = (data?.battles ?? []).filter((b) => !open.includes(b));
  const wins = done.filter((b) => b.status === 'completed' && b.winner_id === me).length;
  const Row = ({ b }: { b: Battle }) => {
    const other = b.challenger_id === me ? b.opponent : b.challenger;
    const r = resultOf(b, me);
    const waitingOnMe =
      (b.status === 'pending' && b.opponent_id === me) || (b.status === 'active' && (b.game_state?.pendingAttack ? b.game_state.pendingAttack.defenderId === me : b.game_state?.currentTurnUserId === me));
    return (
      <button className={`trow${waitingOnMe ? ' attn' : ''}`} onClick={() => navigate(`/battle/${b.id}`)}>
        <span className="who2">{`vs ${other?.username ?? '?'}`}</span>
        <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="when">{ago(b.updated_at ?? b.created_at, now)}</span>
          <span className="status" style={{ background: r === 'Victoire' ? 'var(--good)' : r === 'Défaite' ? 'var(--bad)' : waitingOnMe ? 'var(--accent)' : '#a3a3a3' }}>
            {waitingOnMe ? 'À VOUS' : r.toUpperCase()}
          </span>
        </span>
      </button>
    );
  };
  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">Batailles</h1>
            <span className="muted num">{[quota ? `${quota.used} / ${quota.limit} défis aujourd’hui` : null, done.length ? `${wins} victoire${wins > 1 ? 's' : ''} sur ${done.filter((b) => b.status === 'completed').length}` : null].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="tools">
          <button className="btn" onClick={() => setHelp(true)}>
            Comment ça marche ?
          </button>
        </div>
      </section>
      <div className="page cols">
        <div className="col">
          {error && <p className="err">{error}</p>}
          {!data && !error && <Loading />}
          {data && (
            <>
              <div className="sechead" style={{ marginBottom: 0 }}>
                <h2>En cours</h2>
              </div>
              {open.length ? open.map((b) => <Row key={b.id} b={b} />) : <div className="card-box"><p className="muted" style={{ margin: 0 }}>Aucune bataille en cours : défiez un ami.</p></div>}
              {done.length > 0 && (
                <>
                  <div className="sechead" style={{ marginBottom: 0, marginTop: 8 }}>
                    <h2>Terminées</h2>
                  </div>
                  {done.map((b) => (
                    <Row key={b.id} b={b} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
        <div className="col side">
          <div className="card-box">
            <h2>Défier un ami</h2>
            {full && <p className="muted">{`Plus de défi possible aujourd’hui (${quota!.limit} par jour).`}</p>}
            {friends === null && <Loading />}
            {friends?.length === 0 && <p className="muted">Ajoutez des amis pour les défier.</p>}
            {friends?.map((f) => (
              <div className={`row${target === f.id ? ' hl' : ''}`} key={f.id}>
                <PlayerLink name={f.username} online={f.online} />
                <span className="grow" />
                <button className={`btn sm${target === f.id ? ' primary' : ''}`} disabled={busy || full} onClick={() => void challenge(f.id)}>
                  Défier
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {help && <Help quota={quota ?? null} onClose={() => setHelp(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- arena

function Hp({ name, cur, max }: { name: string; cur: number; max: number }) {
  const pct = Math.max(0, Math.min(100, (cur / Math.max(1, max)) * 100));
  return (
    <div className="hp">
      <div className="hplabel">
        <b>{name}</b>
        <span className="num">{`${fmt(cur)} / ${fmt(max)} PV`}</span>
      </div>
      <div className="hptrack">
        <i style={{ width: `${pct}%`, background: pct > 50 ? 'var(--good)' : pct > 20 ? 'var(--accent)' : 'var(--bad)' }} />
      </div>
    </div>
  );
}

export function BattleArena({ id }: { id: string }) {
  const me = useSession()?.user.id ?? '';
  const [d, setD] = useKept<Detail | null>(`battle:${id}`, null);
  const [cards, setCards] = useKept<Map<string, Card>>(`battle:${id}:cards`, NO_CARDS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useToast(3500);
  const [quit, armQuit] = useArmed();
  const [help, setHelp] = useState(false);
  const load = useCallback(async () => {
    const x = await battles.get(id);
    setD(x);
    const ids = x.decks.flatMap((k) => k.card_ids);
    const known = new Map((x.cards ?? []).map((c) => [c.id, c]));
    const missing = ids.filter((c) => !known.has(c));
    if (missing.length) (await getCards(missing)).forEach((c, k) => known.set(k, c));
    setCards(known);
    return x;
  }, [id]);
  useEffect(() => {
    load().catch((e) => setError(e instanceof ApiError && e.status === 404 ? 'Bataille introuvable.' : 'Erreur réseau'));
    // No push from wiki-masters: poll while the battle is open.
    const t = setInterval(() => void load().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [id, load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await battles.act<battles.AnswerResult>(id, body);
      await load();
      return r;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
      return null;
    } finally {
      setBusy(false);
    }
  };

  // The result of each turn, announced once (attacks of the other player arrive by reload).
  const seenTurns = useRef<number | null>(null);
  const gs = d?.battle.game_state ?? null;
  useEffect(() => {
    const n = gs?.turnHistory.length ?? 0;
    if (seenTurns.current == null) return void (seenTurns.current = n);
    if (n > seenTurns.current) {
      const t = gs!.turnHistory[n - 1]!;
      const mine = t.attackerUserId === me;
      setToast(t.allCorrect ? (mine ? 'Défense parfaite de l’adversaire : aucun dégât.' : 'Défense parfaite !') : `${mine ? 'Touché' : 'Aïe'} : ${fmt(t.damageDealt)} dégâts.`);
      sfx.click();
    }
    seenTurns.current = n;
  }, [gs?.turnHistory.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error && !d)
    return (
      <div className="screen">
        <div className="page">
          <button className="btn link" onClick={() => navigate('/battle')}>
            ← Batailles
          </button>
          <p className="err">{error}</p>
        </div>
      </div>
    );
  if (!d) return <Loading />;
  const b = d.battle;
  const isChallenger = b.challenger_id === me;
  const meP = isChallenger ? b.challenger : b.opponent;
  const them = isChallenger ? b.opponent : b.challenger;
  const myDeck = d.decks.find((k) => k.user_id === me);

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{`${meP?.username ?? 'Moi'} contre ${them?.username ?? '?'}`}</h1>
            <span className="status" style={{ background: '#a3a3a3' }}>
              {resultOf(b, me).toUpperCase()}
            </span>
          </div>
          <div className="chips">
            <button className="chip" onClick={() => navigate('/battle')}>
              ← BATAILLES
            </button>
            <button className="chip" onClick={() => setHelp(true)}>
              RÈGLES
            </button>
          </div>
        </div>
        <div className="tools">
          {(b.status === 'active' || b.status === 'deck_selection') && (
            <button className={`btn ${quit ? 'confirm' : 'danger'}`} disabled={busy} onClick={() => (quit ? void act({ action: 'forfeit' }) : armQuit(true))}>
              {quit ? 'Confirmer l’abandon' : 'Abandonner'}
            </button>
          )}
        </div>
      </section>
      {error && (
        <div className="page" style={{ flex: 'none', paddingBottom: 8 }}>
          <p className="err">{error}</p>
        </div>
      )}

      {b.status === 'pending' && (
        <div className="center">
          <div className="card-form" style={{ textAlign: 'center' }}>
            {isChallenger ? (
              <>
                <h2>Défi envoyé</h2>
                <p className="muted">{`En attente de la réponse de ${them.username}…`}</p>
                <button className="btn" disabled={busy} onClick={() => void act({ action: 'withdraw_invite' }).then((r) => r && navigate('/battle'))}>
                  Annuler le défi
                </button>
              </>
            ) : (
              <>
                <h2>{`${them.username} vous défie !`}</h2>
                <p className="muted">Trois cartes chacun, un quiz à chaque attaque.</p>
                <div className="row2">
                  <button className="btn" disabled={busy} onClick={() => void act({ action: 'decline' }).then((r) => r && navigate('/battle'))}>
                    Refuser
                  </button>
                  <button className="btn primary" disabled={busy} onClick={() => void act({ action: 'accept' })}>
                    Accepter
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {b.status === 'cancelled' && (
        <div className="center">
          <p className="muted">Bataille annulée.</p>
        </div>
      )}
      {b.status === 'generating_quizzes' && <Loading>Préparation des quiz…</Loading>}
      {b.status === 'deck_selection' &&
        (myDeck ? (
          <WaitingDeck deck={myDeck.card_ids} cards={cards} them={them.username} />
        ) : (
          <DeckPicker busy={busy} onSubmit={(ids) => void act({ action: 'submit_deck', card_ids: ids })} />
        ))}
      {gs && (b.status === 'active' || b.status === 'completed') && (
        <Board battle={b} gs={gs} me={me} them={them} meName={meP?.username ?? 'Moi'} cards={cards} busy={busy} act={act} />
      )}
      {help && <Help quota={null} onClose={() => setHelp(false)} />}
      {toast}
    </div>
  );
}

function WaitingDeck({ deck, cards, them }: { deck: string[]; cards: Map<string, Card>; them: string }) {
  const items = deck.flatMap((cid) => (cards.get(cid) ? [{ key: `deck-${cid}`, card: cards.get(cid)!, shiny: false }] : []));
  const hp = items.reduce((s, x) => s + x.card.def, 0);
  return (
    <section className="main">
      <div className="board scrollboard">
        <div className="sechead">
          <h2>Votre deck</h2>
          <span className="muted num">{`${fmt(hp)} PV`}</span>
        </div>
        <CardStrip items={items} width={150} label={(x) => x.card.title} />
      </div>
      <PanelPlaceholder>
        <p>{`Deck envoyé. En attente du deck de ${them}…`}</p>
      </PanelPlaceholder>
    </section>
  );
}

type DeckItem = { key: string; card: Card; shiny: boolean };

function DeckPicker({ busy, onSubmit }: { busy: boolean; onSubmit: (ids: string[]) => void }) {
  const [options, setOptions] = useKept<DeckItem[] | null>('battle:deck-options', null);
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [size, setSize] = useState<CardSize>(savedSize);
  useEffect(() => {
    loadCollection(false).then(
      (c) => {
        // One entry per distinct card, strongest first.
        const seen = new Set<string>();
        setOptions(
          c.items
            .filter((i) => !seen.has(i.card_id) && seen.add(i.card_id))
            .map((i) => ({ key: `pick-${i.card_id}`, card: { ...i.card, rarity: i.rarity }, shiny: i.is_shiny }))
            .sort((a, b) => b.card.atk + b.card.def - (a.card.atk + a.card.def)),
        );
      },
      () => setOptions([]),
    );
  }, []);
  const shown = useMemo(() => (options ?? []).filter((o) => !q || norm(o.card.title).includes(norm(q))), [options, q]);
  const chosen = picked.map((cid) => options?.find((o) => o.card.id === cid)).filter(Boolean) as DeckItem[];
  const hp = chosen.reduce((s, x) => s + x.card.def, 0);
  return (
    <section className="main">
      <div className="boardcol">
        <div className="boardtools">
          <SizeButtons size={size} setSize={setSize} />
          <SearchField id="deck-search" value={q} onChange={setQ} />
        </div>
        {options ? (
          <CardGrid
            items={shown}
            resetKey={q}
            size={size}
            label={(o) => `${o.card.title}, ATK ${o.card.atk}, DEF ${o.card.def}${picked.includes(o.card.id) ? ', choisie' : ''}`}
            slotClass={(o) => (picked.includes(o.card.id) ? 'picked' : undefined)}
            onPick={(o) => setPicked((p) => (p.includes(o.card.id) ? p.filter((x) => x !== o.card.id) : p.length < battles.DECK_SIZE ? [...p, o.card.id] : p))}
            caption={(o) => (
              <>
                <b className="num">{`${fmt(o.card.atk)} ATK`}</b>
                <span className="num">{`${fmt(o.card.def)} DEF`}</span>
              </>
            )}
            empty="Aucune carte."
          />
        ) : (
          <div className="board">
            <div className="empty">Chargement de vos cartes…</div>
          </div>
        )}
      </div>
      <Panel onClose={() => setPicked([])} label="Votre deck">
        <h2>{`Votre deck · ${picked.length} / ${battles.DECK_SIZE}`}</h2>
        <p className="muted">Touchez trois cartes. Leur DEF fait vos PV ; leur ATK, vos dégâts.</p>
        <div className="list">
          {chosen.map((c) => (
            <div className="li" key={c.card.id}>
              <span className="dot" style={{ width: 8, height: 8, borderRadius: 2, background: RARITY_STYLE[c.card.rarity].color }} />
              <span className="t">{c.card.title}</span>
              <span className="muted num">{`${fmt(c.card.atk)} / ${fmt(c.card.def)}`}</span>
            </div>
          ))}
        </div>
        <div className="box">
          <span className="lbl muted">PV de départ</span>
          <span className="big">{fmt(hp)}</span>
        </div>
        <div className="spacer" />
        <button className="btn primary big" disabled={busy || picked.length !== battles.DECK_SIZE} onClick={() => onSubmit(picked)}>
          Valider le deck
        </button>
      </Panel>
    </section>
  );
}

function Board({ battle, gs, me, them, meName, cards, busy, act }: { battle: Battle; gs: battles.GameState; me: string; them: { id: string; username: string }; meName: string; cards: Map<string, Card>; busy: boolean; act: (b: Record<string, unknown>) => Promise<battles.AnswerResult | null> }) {
  const mine = gs.players[me];
  const theirs = gs.players[them.id];
  const myTurn = gs.currentTurnUserId === me && gs.phase !== 'quiz';
  const attack = gs.pendingAttack;
  const iDefend = !!attack && (attack.defenderId ? attack.defenderId === me : gs.currentTurnUserId !== me);
  const over = battle.status === 'completed';
  const winner = gs.winnerId ?? battle.winner_id;
  const strip = (p: battles.PlayerState | undefined, who: string) =>
    (p?.cardIds ?? []).flatMap((cid) => (cards.get(cid) ? [{ key: `b-${who}-${cid}`, card: cards.get(cid)!, shiny: false, used: !!p?.usedCardIds?.includes(cid), cid }] : []));
  const myCards = strip(mine, me);
  const theirCards = strip(theirs, them.id);
  // Cards as big as the board's height allows (two rows, HP bars and the turn line).
  const arena = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(128);
  useEffect(() => {
    const el = arena.current;
    if (!el) return;
    const fit = () => setCw(Math.max(72, Math.min(150, Math.floor(((el.clientHeight - 200) / 2 - 40) / 1.4))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const attackKey = attack ? `b-${attack.attackerUserId ?? (iDefend ? them.id : me)}-${attack.attackCardId}` : null;

  return (
    <section className="main">
      <div className="board scrollboard arena" ref={arena}>
        <Hp name={them.username} cur={theirs?.currentHp ?? 0} max={theirs?.maxHp ?? 1} />
        <CardStrip
          items={theirCards}
          faceDown={(c) => c.used}
          width={cw}
          selected={attackKey}
          label={(c) => `${c.card.title}${c.used ? ', a déjà attaqué' : ''}`}
          caption={(c) => (
            <>
              <b className="num">{c.used ? 'Utilisée' : `${fmt(c.card.atk)} ATK`}</b>
              <span className="num">{`${fmt(c.card.def)} DEF`}</span>
            </>
          )}
        />
        <div className="turnline">
          {over ? (
            <b className={winner === me ? 'ok' : 'err'} style={{ fontSize: 22 }}>
              {winner === me ? 'Victoire !' : 'Défaite'}
            </b>
          ) : attack ? (
            <span>{iDefend ? `${them.username} attaque avec « ${attack.attackCardName ?? cards.get(attack.attackCardId)?.title} » : répondez au quiz.` : `${them.username} répond au quiz sur « ${attack.attackCardName ?? cards.get(attack.attackCardId)?.title} »…`}</span>
          ) : myTurn ? (
            <b className="gold">À vous : choisissez une carte pour attaquer.</b>
          ) : (
            <span className="muted">{`Tour de ${them.username}…`}</span>
          )}
        </div>
        <CardStrip
          items={myCards}
          faceDown={(c) => c.used}
          width={cw}
          selected={attackKey}
          label={(c) => `${c.card.title}${c.used ? ', a déjà attaqué' : myTurn ? ', attaquer' : ''}`}
          onPick={myTurn && !busy ? (c) => !c.used && void act({ action: 'submit_attack', attack_card_id: c.cid }) : undefined}
          caption={(c) => (
            <>
              <b className={`num${myTurn && !c.used ? ' gold' : ''}`}>{c.used ? 'Utilisée' : `${fmt(c.card.atk)} ATK`}</b>
              <span className="num">{`${fmt(c.card.def)} DEF`}</span>
            </>
          )}
        />
        <Hp name={meName} cur={mine?.currentHp ?? 0} max={mine?.maxHp ?? 1} />
      </div>
      {attack && !over ? (
        <QuizPanel key={attack.attackCardId + (gs.turnNumber ?? 0)} attack={attack} attackKey={attackKey!} card={cards.get(attack.attackCardId)} iDefend={iDefend} them={them.username} busy={busy} act={act} />
      ) : (
        <PanelPlaceholder>
          <h2 style={{ margin: 0 }}>{over ? 'Bataille terminée' : `Tour ${gs.turnNumber ?? gs.turnHistory.length + 1}`}</h2>
          <div className="list" style={{ width: '100%', textAlign: 'left' }}>
            {gs.turnHistory.length === 0 && <p>Personne n’a encore attaqué.</p>}
            {[...gs.turnHistory].reverse().map((t, i) => (
              <div className="li" key={i}>
                <span className="t">{`${t.attackerUserId === me ? 'Vous' : them.username} · ${cards.get(t.attackCardId ?? '')?.title ?? '?'}`}</span>
                <b className={t.allCorrect ? 'ok' : 'err'}>{t.allCorrect ? 'paré' : `−${fmt(t.damageDealt)}`}</b>
              </div>
            ))}
          </div>
        </PanelPlaceholder>
      )}
    </section>
  );
}

function QuizPanel({ attack, attackKey, card, iDefend, them, busy, act }: { attack: NonNullable<battles.GameState['pendingAttack']>; attackKey: string; card?: Card; iDefend: boolean; them: string; busy: boolean; act: (b: Record<string, unknown>) => Promise<battles.AnswerResult | null> }) {
  const [answered, setAnswered] = useState<Set<string>>(() => new Set(attack.answered ?? []));
  const [feedback, setFeedback] = useState<{ q: string; picked: string; right?: string } | null>(null);
  const next = attack.questions.find((q) => !answered.has(q.id));
  const shown = feedback ? attack.questions.find((q) => q.id === feedback.q) : next;
  async function answer(qid: string, aid: string) {
    setFeedback({ q: qid, picked: aid });
    const r = await act({ action: 'submit_single_answer', questionId: qid, answerId: aid });
    if (!r) return setFeedback(null);
    setFeedback({ q: qid, picked: aid, right: r.correct_answer_id });
    setTimeout(() => {
      setAnswered((s) => new Set(s).add(qid));
      setFeedback(null);
    }, r.correct_answer_id ? 1100 : 0);
  }
  return (
    <Panel label="Quiz">
      <div className="ptop">
        {card && <BigCard card={card} shiny={false} />}
        <div className="ptxt">
          <span className="lbl muted">{iDefend ? 'Défendez-vous' : `${them} se défend`}</span>
          <h2>{attack.attackCardName ?? card?.title}</h2>
          {card && <span className="muted num">{`${fmt(card.atk)} ATK`}</span>}
        </div>
      </div>
      {iDefend && shown ? (
        <div className="quiz">
          <span className="lbl muted">{`Question ${Math.min(answered.size + 1, attack.questions.length)} / ${attack.questions.length}`}</span>
          <p className="qprompt">{shown.prompt}</p>
          <div className="qopts">
            {shown.options.map((o) => {
              const state = feedback && feedback.q === shown.id ? (o.id === feedback.right ? 'right' : o.id === feedback.picked ? (feedback.right ? 'wrong' : 'sent') : '') : '';
              return (
                <button key={o.id} className={`btn qopt ${state}`} disabled={busy || !!feedback} onClick={() => void answer(shown.id, o.id)}>
                  {o.text}
                </button>
              );
            })}
          </div>
        </div>
      ) : iDefend ? (
        <p className="muted">Réponses envoyées…</p>
      ) : (
        <p className="muted">{`${them} répond aux ${attack.questions.length} questions sur cette carte. Chaque erreur lui coûte une part de son ATK.`}</p>
      )}
    </Panel>
  );
}
