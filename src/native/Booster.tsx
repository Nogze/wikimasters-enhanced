import gsap from 'gsap';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { setPacks } from '../lib/account';
import { rememberCards } from '../lib/cardCache';
import { RARITY_ORDER, RARITY_STYLE } from '../lib/rarity';
import { navigate } from '../lib/router';
import { mmss, useNow, usePacks } from '../lib/time';
import type { Card, Rarity } from '../lib/types';
import { openOriginal } from '../ext/bridge';
import { verifyHuman } from '../ext/humanCheck';
import { PullScene, type Phase, type PhaseState, type Pull, type PullStageHandle } from '../three/PullScene';
import type { StageFx } from '../three/Summon';
import { Icon, ICON, Modal, Overlay } from './kit';
import { World } from './tunnel';

// The booster screen of the native client: the 3D opening (three/PullScene.tsx) and its whole
// interface in the HUD layer (banner, hints, cut-ins, tags, buttons, odds sheet).

type OpenResult = { packs: Pull[][]; state: { packs: number; cap: number; nextAt: string | null } };
type History = { id: string; created_at: string; pulls: { card?: Card; is_shiny: boolean }[] }[];
type Callout = { text: string; rarity: Rarity; shiny: boolean; tags: string[]; key: number };

const ODDS: Record<Rarity, number> = { C: 55, PC: 25, R: 12, SR: 5.5, UR: 2, L: 0.5 };
export function BoosterScreen({ stage }: { stage: StageFx }) {
  const { packs, cap, nextAt, regenMs } = usePacks();
  const scene = useRef<PullStageHandle>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState<PhaseState>({ index: 0, faceUp: false, total: 5 });
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [humanCheck, setHumanCheck] = useState(false);
  const [callout, setCallout] = useState<Callout | null>(null);
  const [info, setInfo] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const flash = useRef<HTMLDivElement>(null);
  const now = useNow();
  const canOpen = !!packs;

  // wiki-masters asked for its anti-bot check: the player does it right here, then the pack opens.
  const [verifying, setVerifying] = useState(false);
  /** Open again as soon as the refused pack is back at rest (phase idle). */
  const retry = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => {
    if (!humanCheck || verifying) return;
    setVerifying(true);
    setError('Vérification rapide…');
    verifyHuman()
      .then(() => {
        setHumanCheck(false);
        setError(null);
        if (phaseRef.current === 'idle') setTimeout(() => scene.current?.autoTear(), 300);
        else retry.current = true;
      })
      .catch((e: Error & { code?: string }) => setError(e.code === 'CANCELLED' ? 'Vérification annulée : le paquet n’a pas été ouvert.' : e.message))
      .finally(() => setVerifying(false));
  }, [humanCheck]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = useCallback(() => {
    apiGet<History>('/packs/history', { force: true })
      .then((h) => setHistory(h))
      .catch(() => setHistory([]));
  }, []);
  useEffect(loadHistory, [loadHistory]);

  const requestPulls = useCallback(async (): Promise<Pull[]> => {
    setError(null);
    setHumanCheck(false);
    setCallout(null);
    try {
      const r = await apiSend<OpenResult>('POST', '/packs/open', { count: 1 }, { invalidates: ['/collection', '/packs'] });
      const next = r.packs[0] ?? [];
      rememberCards(next.map((p) => p.card));
      setPacks(r.state);
      setPulls(next);
      return next;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WM_HUMAN_CHECK') setHumanCheck(true);
      setError(e instanceof ApiError ? (e.code === 'NO_PACKS' ? 'Plus de paquets disponibles.' : e.code === 'BUSY' ? 'Un instant…' : e.message) : 'Erreur réseau, réessayez.');
      throw e;
    }
  }, []);

  const onPhase = useCallback(
    (p: Phase, s: PhaseState) => {
      phaseRef.current = p;
      setPhase(p);
      if (p === 'idle' && retry.current) {
        retry.current = false;
        setTimeout(() => scene.current?.autoTear(), 300);
      }
      setProgress(s);
      if (p === 'done') loadHistory();
      if (p === 'idle') setPulls(null);
      if (p !== 'reveal' || !s.faceUp) setCallout(null);
    },
    [loadHistory],
  );
  const onReveal = useCallback((_: number, p: Pull) => {
    const s = RARITY_STYLE[p.card.rarity];
    const tags = [p.is_new && 'NOUVELLE !', p.is_shiny && 'BRILLANTE', !p.is_new && p.owned_copies > 1 && `DOUBLON ×${p.owned_copies}`].filter(Boolean) as string[];
    const text = p.is_shiny && !s.callout ? 'BRILLANTE !' : s.callout;
    setCallout({ text: text ?? '', rarity: p.card.rarity, shiny: p.is_shiny, tags, key: Date.now() });
  }, []);
  const onFlash = useCallback((strength: number) => void (flash.current && gsap.fromTo(flash.current, { opacity: strength }, { opacity: 0, duration: 0.5, ease: "power2.out" })), []);

  const again = useCallback(() => {
    setCallout(null);
    void scene.current?.reset();
  }, []);
  const primary = useCallback(() => {
    if (phase === 'idle') scene.current?.autoTear();
    else if (phase === 'reveal' || phase === 'opening') scene.current?.next();
    else if (phase === 'done' && canOpen) again();
  }, [phase, canOpen, again]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.code !== 'Enter') return;
      e.preventDefault();
      primary();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [primary]);

  const best = pulls ? pulls.reduce<Pull | null>((a, b) => (!a || RARITY_ORDER.indexOf(b.card.rarity) < RARITY_ORDER.indexOf(a.card.rarity) ? b : a), null) : null;

  const prompt =
    phase === 'idle'
      ? canOpen
        ? 'GLISSEZ LE LONG DU POINTILLÉ POUR OUVRIR'
        : `PROCHAIN PAQUET DANS ${nextAt ? mmss(nextAt - now) : '--:--'}`
      : phase === 'reveal'
        ? `${progress.faceUp ? 'TOUCHEZ POUR LA SUIVANTE' : 'TOUCHEZ POUR RETOURNER'} · ${Math.min(progress.index + 1, progress.total)}/${progress.total}`
        : phase === 'done' && best
          ? `MEILLEURE CARTE : ${RARITY_STYLE[best.card.rarity].label.toUpperCase()}`
          : '';

  return (
    <>
      <World.In>
        <PullScene ref={scene} stage={stage} requestPulls={requestPulls} canOpen={canOpen} onPhase={onPhase} onReveal={onReveal} onFlash={onFlash} />
      </World.In>
      {/* The interface over the opening: everything else lets the pointer through to the pack. */}
      <div className="stagehud">
        <div className="banner">
          <span className="lbl">Booster</span>
          <h1>Édition Encyclopédie</h1>
          <p>5 cartes · 1 brillante sur 100</p>
        </div>
        {phase === 'idle' && <ExtraPacks />}
        <div className="corner">
          {phase === 'reveal' && (
            <button className="btn sm" onClick={() => scene.current?.skip()}>
              Tout retourner
            </button>
          )}
          <button className="iconbtn" aria-label="Probabilités et derniers paquets" onClick={() => setInfo(true)}>
            <Icon d={ICON.info} size={18} />
          </button>
        </div>
        {callout && phase === 'reveal' && callout.text && <CutIn key={callout.key} c={callout} />}
        {callout && phase === 'reveal' && callout.tags.length > 0 && (
          <div className="tags" key={`t${callout.key}`}>
            {callout.tags.map((t) => (
              <span key={t} className={t.startsWith('NOUV') ? 'new' : t.startsWith('BRILL') ? 'shiny' : undefined}>
                {t}
              </span>
            ))}
          </div>
        )}
        {prompt && (
          <div className={`prompt${phase === 'reveal' && Math.floor(now / 800) % 2 ? ' dim' : ''}${phase === 'idle' || phase === 'done' ? ' above' : ''}`}>
            {phase === 'idle' && canOpen && (
              <div className="swipe">
                <i />
              </div>
            )}
            {prompt}
          </div>
        )}
        {(phase === 'idle' || phase === 'done') && (
          <div className="actions">
            {phase === 'done' && (
              <button className="btn big" onClick={() => navigate('/collection')}>
                <span>
                  Collection
                  <span className="sub">Voir mes cartes</span>
                </span>
              </button>
            )}
            <button className="btn primary big" disabled={!canOpen} onClick={() => (phase === 'idle' ? scene.current?.autoTear() : again())}>
              <span>
                {phase === 'idle' ? 'Ouvrir' : 'Encore'}
                <span className="sub">{`${packs ?? 0} en réserve`}</span>
              </span>
            </button>
          </div>
        )}
        {error && (
          <div className="notice" role="alert">
            {error}
            {humanCheck && (
              <button className="btn sm primary" onClick={() => openOriginal('/pulls')}>
                Vérifier sur wiki-masters
              </button>
            )}
          </div>
        )}
      </div>
      {info && <OddsSheet onClose={() => setInfo(false)} history={history} cap={cap} regenMs={regenMs} />}
      <Overlay>
        <div className="flash" ref={flash} />
      </Overlay>
    </>
  );
}

/** Diagonal band slamming across with the rarity name. */
function CutIn({ c }: { c: Callout }) {
  const s = RARITY_STYLE[c.rarity];
  const rainbow = c.rarity === 'L' || c.shiny;
  const small = c.rarity === 'R' && !c.shiny;
  const hold = c.rarity === 'L' ? 2.4 : small ? 1.4 : 1.9;
  return (
    <div
      className={`cutin${small ? ' small' : ''}`}
      style={{ background: rainbow ? 'linear-gradient(90deg, #ff6fb3, #6a2cff)' : `linear-gradient(90deg, ${s.color}, ${s.deep})`, ['--hold' as string]: `${hold}s` }}
    >
      <b>{c.text}</b>
    </div>
  );
}

const VIEWS: Record<Rarity, string> = { L: '250 000 et plus', UR: '80 000 – 250 000', SR: '20 000 – 80 000', R: '3 000 – 20 000', PC: '300 – 3 000', C: 'moins de 300' };

function OddsSheet({ onClose, history, cap, regenMs }: { onClose: () => void; history: History | null; cap: number; regenMs: number }) {
  return (
    <Modal title="Probabilités" onClose={onClose} width={560}>
      <p className="muted">{`Chaque carte est tirée d’un article de Wikipédia. Plus l’article est lu, plus la carte est rare. Une carte sur cent est brillante. Un paquet se recharge toutes les ${Math.round(regenMs / 60_000)} minutes, jusqu’à ${cap} en réserve.`}</p>
      <table className="odds">
        <tbody>
          {RARITY_ORDER.map((r) => (
            <tr key={r}>
              <td>
                <span className="dot" style={{ background: RARITY_STYLE[r].color }} />
                {RARITY_STYLE[r].label}
              </td>
              <td>{`${ODDS[r].toLocaleString('fr')} %`}</td>
              <td>{`${VIEWS[r]} lectures / mois`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="lbl muted">Derniers paquets</span>
      <div className="list">
        {(history ?? []).slice(0, 8).map((p) => (
          <div className="li" key={p.id}>
            <span className="muted num" style={{ flex: 'none' }}>
              {new Date(p.created_at).toLocaleString('fr', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
            <span className="t">
              {p.pulls
                .map((x) => (x.card ? `${x.card.title}${x.is_shiny ? ' ✦' : ''}` : ''))
                .filter(Boolean)
                .join(', ')}
            </span>
          </div>
        ))}
        {!history?.length && <span className="muted">{history ? 'Aucun paquet ouvert pour l’instant.' : 'Chargement…'}</span>}
      </div>
    </Modal>
  );
}

type SpecialPack = { id: string; name?: string; title?: string; description?: string };

/**
 * Bonus packs next to the regular one: the Pro / VIP daily pack (both servers) and wiki-masters'
 * special packs (extension only). Their cards go straight to the collection.
 */
function ExtraPacks() {
  const [pro, setPro] = useState<{ eligible: boolean; claimed_today: boolean; size?: number } | null>(null);
  const [special, setSpecial] = useState<{ packs: SpecialPack[]; available: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    apiGet<{ eligible: boolean; claimed_today: boolean; size?: number }>('/packs/pro-daily', { ttl: 60_000 }).then(setPro, () => {});
    apiGet<{ packs: SpecialPack[]; available: boolean }>('/packs/special', { ttl: 60_000 }).then(setSpecial, () => {});
  }, []);
  const claim = async (f: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await f();
      setMsg(done);
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  };
  const specials = special?.available ? special.packs : [];
  if (!pro?.eligible && !specials.length) return null;
  return (
    <div className="extras">
      {pro?.eligible && (
        <div className="extra">
          <span className="lbl">Paquet Pro du jour</span>
          <span className="muted">{`${pro.size ?? 15} cartes, aucune commune`}</span>
          {pro.claimed_today ? (
            <span className="muted">Déjà récupéré aujourd’hui.</span>
          ) : (
            <button className="btn sm primary" disabled={busy} onClick={() => void claim(() => apiSend('POST', '/packs/pro-daily', undefined, { invalidates: ['/packs', '/collection'] }).then(() => setPro({ ...pro, claimed_today: true })), 'Paquet Pro ajouté à votre collection.')}>
              Récupérer
            </button>
          )}
        </div>
      )}
      {specials.map((p) => (
        <div className="extra" key={p.id}>
          <span className="lbl">{p.name ?? p.title ?? 'Paquet spécial'}</span>
          {p.description && <span className="muted">{p.description}</span>}
          <button className="btn sm primary" disabled={busy} onClick={() => void claim(() => apiSend('POST', '/packs/special', { packId: p.id }, { invalidates: ['/collection'] }), 'Paquet spécial ouvert : les cartes sont dans votre collection.')}>
            Ouvrir
          </button>
        </div>
      ))}
      {msg && (
        <div className="extra">
          <span>{msg}</span>
          <button className="btn sm" onClick={() => navigate('/collection?sort=recent')}>
            Voir les cartes
          </button>
        </div>
      )}
    </div>
  );
}
