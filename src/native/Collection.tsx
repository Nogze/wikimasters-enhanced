import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { refreshBalance, useAccount } from '../lib/account';
import { ApiError, apiGet, apiSend } from '../lib/api';
import { subtitle } from '../lib/cardSpec';
import { discard, loadCollection, scoreOf, setFlags, type Item } from '../lib/collection';
import { DURATIONS, sell } from '../lib/market';
import { fmt, RARITY_ORDER, RARITY_STYLE, views } from '../lib/rarity';
import { navigate, useQuery } from '../lib/router';
import type { Rarity, Tag } from '../lib/types';
import { useKept } from '../lib/kept';
import { CardGrid, saveSize, savedSize, SIZES, type CardSize } from './CardGrid';
import { BigCard, Icon, ICON, Panel, PanelPlaceholder, SearchField, useArmed, useToast } from './kit';

// The collection: a paged board of cards (filters, tags, search, sorts), a card's panel (details, tags, sell, showcase, trade, lock, discard), and a selection
// mode for bulk actions (lock, tag, discard).

type Sort = 'rarity' | 'recent' | 'atk' | 'def' | 'views' | 'name';
const SORTS: Record<Sort, string> = { rarity: 'Rareté', recent: 'Plus récentes', atk: 'Attaque', def: 'Défense', views: 'Lectures', name: 'Nom' };
const byRarity = (a: Item, b: Item) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity) || Number(b.is_shiny) - Number(a.is_shiny);
const sorter: Record<Sort, (a: Item, b: Item) => number> = {
  rarity: (a, b) => byRarity(a, b) || b.card.pageviews - a.card.pageviews || a.card.title.localeCompare(b.card.title, 'fr'),
  recent: (a, b) => b.obtained_at.localeCompare(a.obtained_at),
  atk: (a, b) => b.card.atk - a.card.atk,
  def: (a, b) => b.card.def - a.card.def,
  views: (a, b) => b.card.pageviews - a.card.pageviews,
  name: (a, b) => a.card.title.localeCompare(b.card.title, 'fr'),
};
const TAG_COLORS = ['#f472b6', '#c084fc', '#a78bfa', '#818cf8', '#60a5fa', '#38bdf8', '#2dd4bf', '#4ade80', '#facc15', '#fb923c', '#fb7185', '#e879f9'];
const UNTAGGED = '__none';

export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
type Filters = { rarities: Set<Rarity>; shiny: boolean; star: boolean; locked: boolean; tag: string; sort: Sort };
type GridItem = Item & { key: string; shiny: boolean };

/** Puts a copy in the first free showcase slot. Returns a status line. */
async function addToShowcase(userCardId: string): Promise<string> {
  const { slots } = await apiGet<{ slots: (string | null)[] }>('/me/showcase', { force: true });
  if (slots.includes(userCardId)) return 'Déjà en vitrine.';
  const free = slots.indexOf(null);
  if (free < 0) return 'Vitrine pleine : retirez une carte depuis votre profil.';
  slots[free] = userCardId;
  await apiSend('PUT', '/me/showcase', { slots }, { invalidates: ['/me/showcase', '/players/'] });
  return 'Ajoutée à la vitrine.';
}

export function SizeButtons({ size, setSize }: { size: CardSize; setSize: (s: CardSize) => void }) {
  const icon = { S: ICON.sizeS, M: ICON.sizeM, L: ICON.sizeL };
  const name = { S: 'Petites cartes', M: 'Cartes moyennes', L: 'Grandes cartes' };
  return (
    <span className="sizes">
      {SIZES.map((s) => (
        <button key={s} className={`iconbtn${size === s ? ' on' : ''}`} aria-label={name[s]} aria-pressed={size === s} onClick={() => (setSize(s), saveSize(s))}>
          <Icon d={icon[s]} size={16} />
        </button>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------- tags

function TagEditor({ item, tags, onTag, onCreate }: { item: Item; tags: Tag[]; onTag: (t: Tag, on: boolean) => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  const q = name.trim().toLowerCase();
  const shown = tags.filter((t) => t.name.toLowerCase().includes(q));
  const exact = tags.some((t) => t.name.toLowerCase() === q);
  const create = () => {
    if (!q) return;
    const existing = tags.find((t) => t.name.toLowerCase() === q);
    if (existing) {
      if (!item.tag_ids.includes(existing.id)) onTag(existing, true);
    } else onCreate(name.trim());
    setName('');
  };
  return (
    <div className="tagedit">
      <span className="lbl muted">Étiquettes</span>
      <div className="chips" style={{ marginTop: 0 }}>
        {shown.map((t) => {
          const on = item.tag_ids.includes(t.id);
          return (
            <button key={t.id} className={`chip tagchip${on ? ' on' : ''}`} style={{ ['--tc' as string]: t.color ?? '#5b616c' }} aria-pressed={on} onClick={() => onTag(t, !on)}>
              {on && <Icon d={ICON.check} size={12} />}
              {t.name}
            </button>
          );
        })}
        {q && !exact && (
          <button className="chip" onClick={create}>
            {`+ Créer « ${name.trim()} »`}
          </button>
        )}
      </div>
      <input className="field" style={{ height: 34 }} aria-label="Filtrer ou créer une étiquette" placeholder={tags.length ? 'Filtrer ou créer une étiquette…' : 'Créer une étiquette…'} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
    </div>
  );
}

// ---------------------------------------------------------------- one card

function CardPanel({ item, tags, onClose, onChanged, onTag, onCreateTag, toast }: { item: Item; tags: Tag[]; onClose: () => void; onChanged: (patch: Partial<Item> | null) => void; onTag: (t: Tag, on: boolean) => void; onCreateTag: (name: string) => void; toast: (s: string) => void }) {
  const [summary, setSummary] = useKept<string | null | undefined>(`summary:${item.card.id}`, undefined);
  const [discardArmed, armDiscard] = useArmed();
  const [sellArmed, armSell] = useArmed();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [selling, setSelling] = useState(false);
  const [base, setBase] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [slots, setSlots] = useState<{ selling: number; maxConcurrentAuctions: number } | null>(null);
  const s = RARITY_STYLE[item.rarity];
  useEffect(() => {
    armDiscard(false);
    armSell(false);
    setSelling(false);
    setNote(null);
    setError(null);
    setBase('');
    apiGet<{ summary: string | null }>(`/cards/${item.card.id}`, { ttl: Infinity })
      .then((d) => setSummary(d.summary ?? null))
      .catch(() => setSummary(null));
  }, [item.card.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!selling) return;
    apiGet<{ selling: number; maxConcurrentAuctions: number }>('/market/summary', { ttl: 30_000 }).then(setSlots).catch(() => {});
  }, [selling, item.card.id]);

  const flag = async (patch: { starred?: boolean; locked?: boolean }) => {
    setError(null);
    onChanged(patch);
    try {
      await setFlags([item.id], patch);
    } catch (e) {
      onChanged({ starred: item.starred, locked: item.locked });
      setError(e instanceof Error ? e.message : 'Erreur');
    }
  };
  const doDiscard = async () => {
    setBusy(true);
    setError(null);
    try {
      const gained = await discard([item.id]);
      onChanged(item.count > 1 ? { count: item.count - 1 } : null);
      armDiscard(false);
      toast(`Défaussée${gained ? ` : +${fmt(gained)} WB` : ''}.`);
      if (item.count <= 1) onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  const full = slots != null && slots.selling >= slots.maxConcurrentAuctions;
  const doSell = async () => {
    const amount = Number(base);
    if (full) return setError(`Vous avez déjà ${slots!.maxConcurrentAuctions} ventes en cours.`);
    if (!Number.isInteger(amount) || amount < 1) return setError('Mise de départ : au moins 1 WB.');
    if (!sellArmed) return armSell(true);
    setBusy(true);
    setError(null);
    try {
      await sell(item.id, amount, minutes);
      // The listed copy leaves the collection until the sale ends.
      onChanged(item.count > 1 ? { count: item.count - 1 } : null);
      const listed = `En vente pour ${fmt(amount)} WB (${DURATIONS.find((d) => d.minutes === minutes)?.label.toLowerCase()}).`;
      setNote(listed);
      toast(listed);
      setSelling(false);
      armSell(false);
      refreshBalance().catch(() => {});
      if (item.count <= 1) setTimeout(onClose, 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel onClose={onClose} label={item.card.title}>
      <div className="ptop">
        <BigCard card={{ ...item.card, rarity: item.rarity }} shiny={item.is_shiny} />
        <div className="ptxt">
          <span className="rarity-tag" style={{ color: s.color }}>
            {`${s.label}${item.is_shiny ? ' · brillante' : ''}`}
          </span>
          <h2>{item.card.title}</h2>
          <span className="muted">{subtitle(item.card)}</span>
          <div className="quick">
            <button className={`iconbtn${item.starred ? ' on' : ''}`} aria-pressed={item.starred} aria-label={item.starred ? 'Retirer des favoris' : 'Ajouter aux favoris'} title="Favori" onClick={() => void flag({ starred: !item.starred })}>
              <Icon d={ICON.star} size={16} />
            </button>
            <button className={`iconbtn${item.locked ? ' on' : ''}`} aria-pressed={item.locked} aria-label={item.locked ? 'Déverrouiller' : 'Verrouiller'} title={item.locked ? 'Verrouillée : ni vente, ni défausse, ni échange' : 'Verrouiller'} onClick={() => void flag({ locked: !item.locked })}>
              <Icon d={ICON.lock} size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="kv">
        <div>
          <b>{item.card.atk}</b>
          <span>Attaque</span>
        </div>
        <div>
          <b>{item.card.def}</b>
          <span>Défense</span>
        </div>
        {item.card.q_score != null && (
          <div>
            <b>{item.card.q_score}</b>
            <span>Q-score</span>
          </div>
        )}
        <div>
          <b>{`×${item.count}`}</b>
          <span>{item.count > 1 ? 'Exemplaires' : 'Exemplaire'}</span>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 14 }}>{`${views(item.card.pageviews)} lectures par mois · obtenue le ${new Date(item.obtained_at).toLocaleDateString('fr')}`}</p>
      {!selling && <p style={{ fontSize: 14, color: 'var(--soft)' }}>{summary === undefined ? 'Chargement du résumé…' : (summary ?? 'Pas de résumé disponible.')}</p>}
      {!selling && <TagEditor item={item} tags={tags} onTag={onTag} onCreate={onCreateTag} />}
      <div className="spacer" />
      {error && <p className="err" role="alert">{error}</p>}
      {note && <p className="ok">{note}</p>}
      {selling ? (
        <>
          <span className="hint">
            {slots ? `Ventes en cours : ${slots.selling} / ${slots.maxConcurrentAuctions}` : ''}
          </span>
          <label className="lbl muted" htmlFor="sell-base">
            Mise de départ (WB) et durée
          </label>
          <input id="sell-base" className="field" inputMode="numeric" placeholder="Mise de départ, ex. 100" autoFocus value={base} onChange={(e) => (setBase(e.target.value.replace(/\D/g, '')), armSell(false))} onKeyDown={(e) => e.key === 'Enter' && void doSell()} />
          <div className="chips" style={{ marginTop: 0 }}>
            {DURATIONS.map((d) => (
              <button key={d.minutes} className={`chip${minutes === d.minutes ? ' on' : ''}`} onClick={() => (setMinutes(d.minutes), armSell(false))}>
                {d.label}
              </button>
            ))}
          </div>
          <div className="row2">
            <button className="btn" onClick={() => (setSelling(false), armSell(false), setError(null))}>
              Retour
            </button>
            <button className={`btn ${sellArmed ? 'confirm' : 'primary'}`} disabled={busy || !base || full} onClick={() => void doSell()}>
              {sellArmed ? `Confirmer ${fmt(Number(base))} WB` : 'Mettre en vente'}
            </button>
          </div>
        </>
      ) : (
        <>
          <button className="btn primary" disabled={item.locked} title={item.locked ? 'Carte verrouillée' : undefined} onClick={() => (setSelling(true), armSell(false), setError(null), setNote(null))}>
            {item.locked ? 'Verrouillée : vente bloquée' : 'Vendre au marché'}
          </button>
          <div className="row2">
            <button className="btn" disabled={item.locked} onClick={() => navigate(`/trades?new=1&give=${item.id}`)}>
              Échanger
            </button>
            {(
              <button className="btn" onClick={() => void addToShowcase(item.id).then(toast, (e) => toast(e instanceof Error ? e.message : 'Erreur'))}>
                En vitrine
              </button>
            )}
            <a className="btn" href={item.card.wikipedia_url} target="_blank" rel="noopener noreferrer">
              Wikipédia
            </a>
            <button className={`btn ${discardArmed ? 'confirm' : 'danger'}`} disabled={item.locked || busy} onClick={() => (discardArmed ? void doDiscard() : armDiscard(true))} style={{ gridColumn: '1 / -1' }}>
              {discardArmed ? 'Confirmer la défausse ?' : 'Défausser · +1 WB'}
            </button>
          </div>
        </>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- selection

function SelectionPanel({ all, shown, selected, setSelected, tags, onLock, onTag, onDiscard, onClose, busy, progress }: {
  all: Item[];
  shown: Item[];
  selected: Set<string>;
  setSelected: (s: Set<string>) => void;
  tags: Tag[];
  onLock: (on: boolean) => void;
  onTag: (t: Tag, on: boolean) => void;
  onDiscard: () => void;
  onClose: () => void;
  busy: boolean;
  progress: string | null;
}) {
  const [armed, arm] = useArmed();
  const picked = all.filter((i) => selected.has(i.id));
  const lockedN = picked.filter((i) => i.locked).length;
  const discardable = picked.filter((i) => !i.locked);
  const add = (ids: string[]) => setSelected(new Set([...selected, ...ids]));
  return (
    <Panel onClose={onClose} label="Sélection">
      <h2>{`${fmt(selected.size)} carte${selected.size > 1 ? 's' : ''} sélectionnée${selected.size > 1 ? 's' : ''}`}</h2>
      <p className="hint">Touchez des cartes pour les ajouter ou les retirer ; Maj + clic sélectionne une plage.</p>
      <div className="chips" style={{ marginTop: 0 }}>
        <button className="chip" onClick={() => add(shown.map((i) => i.id))}>
          {`Toutes les affichées (${fmt(shown.length)})`}
        </button>
        <button className="chip" onClick={() => add(shown.filter((i) => i.count > 1).map((i) => i.id))}>
          Doublons
        </button>
        {RARITY_ORDER.filter((r) => shown.some((i) => i.rarity === r)).map((r) => (
          <button key={r} className="chip" onClick={() => add(shown.filter((i) => i.rarity === r).map((i) => i.id))}>
            <span className="dot" style={{ background: RARITY_STYLE[r].color }} />
            {`+ ${r}`}
          </button>
        ))}
        <button className="chip" onClick={() => setSelected(new Set(shown.filter((i) => !selected.has(i.id)).map((i) => i.id)))}>
          Inverser
        </button>
        <button className="chip" disabled={!selected.size} onClick={() => setSelected(new Set())}>
          Aucune
        </button>
      </div>
      <div className="spacer" />
      {progress && <p>{progress}</p>}
      <div className="row2">
        <button className="btn" disabled={!selected.size || busy} onClick={() => onLock(true)}>
          Verrouiller
        </button>
        <button className="btn" disabled={!lockedN || busy} onClick={() => onLock(false)}>
          {`Déverrouiller${lockedN ? ` (${lockedN})` : ''}`}
        </button>
      </div>
      {tags.length > 0 && (
        <div className="tagedit">
          <span className="lbl muted">Étiqueter la sélection</span>
          <div className="chips" style={{ marginTop: 0 }}>
            {tags.map((t) => {
              const n = picked.filter((i) => i.tag_ids.includes(t.id)).length;
              const on = !!picked.length && n === picked.length;
              return (
                <button key={t.id} className={`chip tagchip${on ? ' on' : ''}`} style={{ ['--tc' as string]: t.color ?? '#5b616c' }} disabled={!selected.size || busy} onClick={() => onTag(t, !on)}>
                  {on ? <Icon d={ICON.check} size={12} /> : n ? '–' : null}
                  {t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button className={`btn ${armed ? 'confirm' : 'danger'}`} disabled={!discardable.length || busy} onClick={() => (armed ? (arm(false), onDiscard()) : arm(true))}>
        {armed ? `Confirmer : défausser ${fmt(discardable.length)} carte${discardable.length > 1 ? 's' : ''} (+${fmt(discardable.length)} WB)` : `Défausser${discardable.length ? ` (${fmt(discardable.length)})` : ''}`}
      </button>
      {lockedN > 0 && <span className="hint">{`${lockedN} verrouillée${lockedN > 1 ? 's' : ''} : jamais défaussée${lockedN > 1 ? 's' : ''}.`}</span>}
      <button className="btn" onClick={onClose}>
        Terminer la sélection
      </button>
    </Panel>
  );
}

// ---------------------------------------------------------------- screen

export function CollectionScreen() {
  const { profile } = useAccount();
  const qp = useQuery();
  const [all, setAll] = useKept<Item[] | null>('collection', null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => ({ rarities: new Set(), shiny: false, star: false, locked: false, tag: '', sort: (qp.get('sort') as Sort) in SORTS ? (qp.get('sort') as Sort) : 'rarity' }));
  const [openId, setOpenId] = useState<string | null>(() => qp.get('card'));
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<CardSize>(savedSize);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const anchor = useRef<string | null>(null);

  useEffect(() => {
    loadCollection(true)
      .then((c) => (setAll(c.items), setTags(c.tags.filter((t) => !t.name.startsWith('[')))))
      .catch((e) => setError(e instanceof Error ? e.message : 'Erreur'));
  }, []);
  // A link to one card (home, notifications, palette) opens it.
  const linked = qp.get('card');
  useEffect(() => {
    if (linked) setOpenId(linked);
  }, [linked]);

  const items = useMemo((): GridItem[] => {
    if (!all) return [];
    const q = norm(query.trim());
    const tagName = new Map(tags.map((t) => [t.id, norm(t.name)]));
    return all
      .filter((i) => (!filters.rarities.size || filters.rarities.has(i.rarity)) && (!filters.shiny || i.is_shiny) && (!filters.star || i.starred) && (!filters.locked || i.locked))
      .filter((i) => (filters.tag === UNTAGGED ? !i.tag_ids.length : !filters.tag || i.tag_ids.includes(filters.tag)))
      .filter((i) => !q || norm(i.card.title).includes(q) || norm(subtitle(i.card)).includes(q) || i.tag_ids.some((t) => tagName.get(t)?.includes(q)))
      .sort(sorter[filters.sort])
      .map((i) => ({ ...i, key: i.id, shiny: i.is_shiny, card: { ...i.card, rarity: i.rarity } }));
  }, [all, filters, query, tags]);

  const open = openId ? (all?.find((i) => i.id === openId) ?? null) : null;
  const patch = useCallback((id: string, p: Partial<Item> | null) => {
    setAll((list) => (list ? (p ? list.map((i) => (i.id === id ? { ...i, ...p } : i)) : list.filter((i) => i.id !== id)) : list));
  }, []);
  const patchMany = (ids: Set<string>, f: (i: Item) => Item) => setAll((list) => list?.map((i) => (ids.has(i.id) ? f(i) : i)) ?? list);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (setOpenId(null), setSelecting(false));
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (openId && all && !open) setOpenId(null);
  }, [openId, all, open]);

  // ---- tags
  const tagCards = async (t: Tag, ids: string[], on: boolean) => {
    const set = new Set(ids);
    patchMany(set, (i) => ({ ...i, tag_ids: on ? [...new Set([...i.tag_ids, t.id])] : i.tag_ids.filter((x) => x !== t.id) }));
    try {
      await apiSend('POST', `/collection/tags/${t.id}/cards`, { userCardIds: ids, on }, { invalidates: ['/collection'] });
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Erreur');
    }
  };
  const createTag = async (name: string, ids: string[]) => {
    try {
      const t = await apiSend<Tag>('POST', '/collection/tags', { name, color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] }, { invalidates: ['/collection'] });
      setTags((ts) => [...ts, t].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
      await tagCards(t, ids, true);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Erreur');
    }
  };

  // ---- selection
  const pickInSelection = (it: GridItem, shift: boolean) => {
    const next = new Set(selected);
    if (shift && anchor.current) {
      const a = items.findIndex((x) => x.id === anchor.current);
      const b = items.findIndex((x) => x.id === it.id);
      if (a >= 0 && b >= 0) for (let k = Math.min(a, b); k <= Math.max(a, b); k++) next.add(items[k]!.id);
    } else next.has(it.id) ? next.delete(it.id) : next.add(it.id);
    anchor.current = it.id;
    setSelected(next);
  };
  const shift = useRef(false);
  useEffect(() => {
    const on = (e: KeyboardEvent) => (shift.current = e.shiftKey);
    window.addEventListener('keydown', on);
    window.addEventListener('keyup', on);
    return () => (window.removeEventListener('keydown', on), window.removeEventListener('keyup', on));
  }, []);
  const lockSelection = async (on: boolean) => {
    const ids = [...selected].filter((id) => all?.find((i) => i.id === id)?.locked !== on);
    if (!ids.length) return;
    setBusy(true);
    patchMany(new Set(ids), (i) => ({ ...i, locked: on }));
    try {
      for (let k = 0; k < ids.length; k += 500) await setFlags(ids.slice(k, k + 500), { locked: on });
      setToast(`${fmt(ids.length)} carte${ids.length > 1 ? 's' : ''} ${on ? 'verrouillée' : 'déverrouillée'}${ids.length > 1 ? 's' : ''}.`);
    } catch (e) {
      patchMany(new Set(ids), (i) => ({ ...i, locked: !on }));
      setToast(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setBusy(false);
    }
  };
  const discardSelection = async () => {
    const ids = (all ?? []).filter((i) => selected.has(i.id) && !i.locked).map((i) => i.id);
    if (!ids.length) return;
    setBusy(true);
    let gained = 0;
    try {
      for (let k = 0; k < ids.length; k += 200) {
        setProgress(`Défausse… ${fmt(k)} / ${fmt(ids.length)}`);
        gained += await discard(ids.slice(k, k + 200));
      }
      // One copy of each: rows with copies left stay, with one fewer.
      const set = new Set(ids);
      setAll((list) => list?.flatMap((i) => (set.has(i.id) ? (i.count > 1 ? [{ ...i, count: i.count - 1 }] : []) : [i])) ?? list);
      setSelected(new Set());
      setToast(`${fmt(ids.length)} carte${ids.length > 1 ? 's' : ''} défaussée${ids.length > 1 ? 's' : ''} · +${fmt(gained)} WB`);
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Erreur pendant la défausse');
      loadCollection(true).then((c) => setAll(c.items), () => {});
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const counts = useMemo(() => Object.fromEntries(RARITY_ORDER.map((r) => [r, (all ?? []).filter((i) => i.rarity === r).length])) as Record<Rarity, number>, [all]);
  const copies = (all ?? []).reduce((s, i) => s + i.count, 0);
  const toggle = (r: Rarity) => {
    const next = new Set(filters.rarities);
    next.has(r) ? next.delete(r) : next.add(r);
    setFilters({ ...filters, rarities: next });
  };
  const resetKey = `${[...filters.rarities].join()}|${filters.shiny}|${filters.star}|${filters.locked}|${filters.tag}|${filters.sort}|${query.trim()}`;
  const lockedCount = (all ?? []).filter((i) => i.locked).length;

  return (
    <div className="screen">
      <section className="head">
        <div className="headmain">
          <div className="titleline">
            <h1 className="h1">{`Collection de ${profile?.username ?? '…'}`}</h1>
            {all && <span className="muted num">{`${fmt(all.length)} cartes · ${fmt(copies)} exemplaires · ${fmt(scoreOf(all))} points${items.length !== all.length ? ` · ${fmt(items.length)} affichées` : ''}`}</span>}
          </div>
          <div className="chips">
            {RARITY_ORDER.filter((r) => counts[r]).map((r) => (
              <button key={r} className={`chip${filters.rarities.has(r) ? ' on' : ''}`} aria-pressed={filters.rarities.has(r)} onClick={() => toggle(r)} title={RARITY_STYLE[r].label}>
                <span className="dot" style={{ background: RARITY_STYLE[r].color }} />
                {r}
                <span className="n">{fmt(counts[r])}</span>
              </button>
            ))}
            <button className={`chip${filters.shiny ? ' on' : ''}`} aria-pressed={filters.shiny} onClick={() => setFilters({ ...filters, shiny: !filters.shiny })}>
              Brillantes
            </button>
            <button className={`chip${filters.star ? ' on' : ''}`} aria-pressed={filters.star} onClick={() => setFilters({ ...filters, star: !filters.star })}>
              Favorites
            </button>
            {lockedCount > 0 && (
              <button className={`chip${filters.locked ? ' on' : ''}`} aria-pressed={filters.locked} onClick={() => setFilters({ ...filters, locked: !filters.locked })}>
                Verrouillées
                <span className="n">{fmt(lockedCount)}</span>
              </button>
            )}
            {tags.length > 0 && (
              <select className="chip select" aria-label="Étiquette" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })}>
                <option value="">Toutes étiquettes</option>
                <option value={UNTAGGED}>Sans étiquette</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <select className="chip select" aria-label="Tri" value={filters.sort} onChange={(e) => setFilters({ ...filters, sort: e.target.value as Sort })}>
              {(Object.keys(SORTS) as Sort[]).map((s) => (
                <option key={s} value={s}>
                  {`Tri : ${SORTS[s].toLowerCase()}`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="tools">
          <button className={`btn sm${selecting ? ' on' : ''}`} aria-pressed={selecting} onClick={() => (setSelecting((v) => !v), setOpenId(null), setSelected(new Set()))}>
            {selecting ? 'Sélection…' : 'Sélectionner'}
          </button>
          <SizeButtons size={size} setSize={setSize} />
          <SearchField id="collection-search" value={query} onChange={setQuery} />
        </div>
      </section>
      <section className="main">
        {all ? (
          <CardGrid
            items={items}
            resetKey={resetKey}
            size={size}
            selected={selecting ? null : openId}
            slotClass={(i) => [selecting && selected.has(i.id) ? 'picked' : '', i.locked ? 'locked' : ''].filter(Boolean).join(' ') || undefined}
            label={(i) => `${i.card.title}, ${RARITY_STYLE[i.rarity].label}${i.count > 1 ? `, ${i.count} exemplaires` : ''}${i.locked ? ', verrouillée' : ''}${selecting && selected.has(i.id) ? ', sélectionnée' : ''}`}
            onPick={(i) => (selecting ? pickInSelection(i, shift.current) : setOpenId(i.id))}
            empty={all.length ? (query ? `Aucune carte pour « ${query} ».` : 'Aucune carte avec ces filtres.') : 'Aucune carte pour l’instant : ouvrez un paquet !'}
          />
        ) : (
          <div className="board">
            <div className="empty">{error ?? 'Chargement de la collection…'}</div>
          </div>
        )}
        {selecting && all ? (
          <SelectionPanel
            all={all}
            shown={items}
            selected={selected}
            setSelected={setSelected}
            tags={tags}
            busy={busy}
            progress={progress}
            onLock={(on) => void lockSelection(on)}
            onTag={(t, on) => void tagCards(t, [...selected], on)}
            onDiscard={() => void discardSelection()}
            onClose={() => (setSelecting(false), setSelected(new Set()))}
          />
        ) : open ? (
          <CardPanel
            key="panel"
            item={open}
            tags={tags}
            onClose={() => setOpenId(null)}
            onChanged={(p) => patch(open.id, p)}
            onTag={(t, on) => void tagCards(t, [open.id], on)}
            onCreateTag={(name) => void createTag(name, [open.id])}
            toast={setToast}
          />
        ) : (
          <PanelPlaceholder>
            <div className="ghost" />
            <p>Choisissez une carte pour la voir en grand, la vendre ou la ranger.</p>
          </PanelPlaceholder>
        )}
      </section>
      {toast}
    </div>
  );
}
