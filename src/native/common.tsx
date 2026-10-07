import { useEffect, type ReactNode } from 'react';
import { apiGet } from '../lib/api';
import { subtitle } from '../lib/cardSpec';
import { BASE, linkClick } from '../lib/router';
import { fmt, RARITY_STYLE, views } from '../lib/rarity';
import type { Card } from '../lib/types';
import { imageSources } from '../lib/images';
import { useKept } from '../lib/kept';
import { BigCard, CardSlot, Panel } from './kit';

// Pieces shared by the social and progression screens: avatars, links to players, a strip of
// cards (showcase, latest finds, wishlists), and the panel of a card you don't own.

export function Avatar({ name, url, online, size = 36 }: { name?: string; url?: string | null; online?: boolean; size?: number }) {
  const src = imageSources(url, 330)[0];
  return (
    <span className={`avatar-c${online ? ' online' : ''}`} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : (name?.[0]?.toUpperCase() ?? '?')}
    </span>
  );
}

export const href = (path: string) => BASE + path;

/** A player's name with their avatar letter, linking to their profile. */
export function PlayerLink({ name, online, url }: { name?: string; online?: boolean; url?: string | null }) {
  if (!name) return <span className="muted">?</span>;
  return (
    <a className="player" href={href(`/profile/${encodeURIComponent(name)}`)} onClick={linkClick}>
      <Avatar name={name} url={url} online={online} size={28} />
      <span>{name}</span>
    </a>
  );
}

export type StripItem = { key: string; card: Card; shiny: boolean };

/** A row of cards of a fixed width (wraps); `null` items are empty slots. */
export function CardStrip<T extends StripItem>({ items, width = 120, label, onPick, caption, empty, emptySlot, selected, faceDown }: { items: (T | null)[]; width?: number; label: (it: T) => string; onPick?: (it: T) => void; caption?: (it: T) => ReactNode; empty?: ReactNode; emptySlot?: (i: number) => ReactNode; selected?: string | null; faceDown?: (it: T) => boolean }) {
  return (
    <div className="strip" style={{ ['--cw' as string]: `${width}px` }}>
      {items.map((it, i) =>
        it ? (
          <div className="slotcell" key={it.key}>
            <CardSlot card={it.card} shiny={it.shiny} faceDown={faceDown?.(it)} label={label(it)} className={selected === it.key ? 'on' : undefined} onClick={onPick && (() => onPick(it))} />
            {caption && <div className="caption">{caption(it)}</div>}
          </div>
        ) : (
          <div className="slotcell" key={`empty-${i}`}>
            {emptySlot?.(i)}
          </div>
        ),
      )}
      {!items.length && empty && <p className="muted">{empty}</p>}
    </div>
  );
}

export function Progress({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <i style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Details of any card (catalogue, someone else's collection): read-only. */
export function CardInfoPanel({ k, card, shiny, owned, extra, onClose }: { k: string; card: Card; shiny: boolean; owned?: number; extra?: ReactNode; onClose: () => void }) {
  const s = RARITY_STYLE[card.rarity];
  const [summary, setSummary] = useKept<string | null | undefined>(`summary:${card.id}`, undefined);
  useEffect(() => {
    apiGet<{ summary: string | null }>(`/cards/${card.id}`, { ttl: Infinity })
      .then((d) => setSummary(d.summary ?? null))
      .catch(() => setSummary(null));
  }, [card.id]);
  return (
    <Panel onClose={onClose} label={card.title}>
      <div className="ptop">
        <BigCard card={card} shiny={shiny} />
        <div className="ptxt">
          <span className="rarity-tag" style={{ color: s.color }}>
            {`${s.label}${shiny ? ' · brillante' : ''}`}
          </span>
          <h2>{card.title}</h2>
          <span className="muted">{subtitle(card)}</span>
        </div>
      </div>
      <div className="kv">
        <div>
          <b>{card.atk}</b>
          <span>Attaque</span>
        </div>
        <div>
          <b>{card.def}</b>
          <span>Défense</span>
        </div>
        {card.q_score != null && (
          <div>
            <b>{card.q_score}</b>
            <span>Q-score</span>
          </div>
        )}
      </div>
      <p className="muted" style={{ fontSize: 14 }}>
        {`${views(card.pageviews)} lectures par mois`}
        {owned != null && (owned > 0 ? ` · vous en avez ${fmt(owned)}` : ' · vous ne l’avez pas')}
      </p>
      <p style={{ fontSize: 14, color: 'var(--soft)' }}>{summary === undefined ? 'Chargement du résumé…' : (summary ?? 'Pas de résumé disponible.')}</p>
      <div className="spacer" />
      {extra}
      <a className="btn" href={card.wikipedia_url} target="_blank" rel="noopener noreferrer">
        Wikipédia
      </a>
    </Panel>
  );
}

/** "il y a 5 min", "vu il y a 2 h"… */
export function ago(iso?: string | null, now = Date.now()) {
  if (!iso) return '';
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return `il y a ${d} jour${d > 1 ? 's' : ''}`;
}

export function Loading({ children = 'Chargement…' }: { children?: ReactNode }) {
  return <div className="loading muted">{children}</div>;
}
