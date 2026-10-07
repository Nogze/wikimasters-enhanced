import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from '../lib/types';
import { sfx } from '../lib/sfx';
import { CardFace } from './CardFace';
import gsap from 'gsap';

// The interface kit: icons, dialogs and toasts, card slots and the big card of a panel, panels.
// Styles live in styles/app.css.

export const ICON = {
  booster: 'M6 3.5l1 1 1-1 1 1 1-1 1 1 1-1 1 1 1-1 1 1 1-1 1 1V20l-1 1-1-1-1 1-1-1-1 1-1-1-1 1-1-1-1 1-1-1-1 1-1-1zM12 7.9a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z',
  collection: 'M8 4h10a1.6 1.6 0 0 1 1.6 1.6v12.8A1.6 1.6 0 0 1 18 20H8a1.6 1.6 0 0 1-1.6-1.6V5.6A1.6 1.6 0 0 1 8 4zM3.2 7.5l2-.4v12.5l-1.6.3z',
  market: 'M4 9l1.5-5h13L20 9c0 1.4-1.2 2.5-2.7 2.5S14.7 10.4 14.7 9c0 1.4-1.2 2.5-2.7 2.5S9.3 10.4 9.3 9c0 1.4-1.2 2.5-2.7 2.5S4 10.4 4 9zm1.5 3.5h13V20h-13z',
  trades: 'M4 7h12.5l-3-3 1.4-1.4L20.3 8l-5.4 5.4-1.4-1.4 3-3H4zm16 10H7.5l3 3-1.4 1.4L3.7 16l5.4-5.4 1.4 1.4-3 3H20z',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.2 4.7l1.6 1.3-1.8 3.1-2-.6a7.6 7.6 0 0 1-1.7 1l-.4 2h-3.6l-.4-2a7.6 7.6 0 0 1-1.7-1l-2 .6-1.8-3.1 1.6-1.3a7.8 7.8 0 0 1 0-2l-1.6-1.3 1.8-3.1 2 .6a7.6 7.6 0 0 1 1.7-1l.4-2h3.6l.4 2a7.6 7.6 0 0 1 1.7 1l2-.6 1.8 3.1-1.6 1.3a7.8 7.8 0 0 1 0 2z',
  close: 'M5.6 4.2 12 10.6l6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4z',
  pack: 'M7 2h10a1.5 1.5 0 0 1 1.5 1.5v17A1.5 1.5 0 0 1 17 22H7a1.5 1.5 0 0 1-1.5-1.5v-17A1.5 1.5 0 0 1 7 2z',
  coin: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2.2a6.8 6.8 0 1 1 0 13.6 6.8 6.8 0 0 1 0-13.6z',
  search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  prev: 'M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2z',
  next: 'M8.6 4.6 16 12l-7.4 7.4 1.4 1.4 8.8-8.8L10 3.2z',
  info: 'M11 10h2v8h-2zm0-4h2v2h-2zm1-4a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z',
  sizeS: 'M4 4h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 10h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4zM4 16h4v4H4zm6 0h4v4h-4zm6 0h4v4h-4z',
  sizeM: 'M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z',
  sizeL: 'M5 3h14v18H5z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm7.5 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5zm15.4 0c0-2.2-.8-4.2-2.2-5.7.6-.2 1.2-.3 1.8-.3 3.1 0 5.5 2.7 5.5 6z',
  trophy: 'M7 3h10v2h4v3a5 5 0 0 1-4.6 5 5 5 0 0 1-3.4 2.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 7.6 13 5 5 0 0 1 3 8V5h4zm10 4v4.1A3 3 0 0 0 19 8V7zM5 7v1a3 3 0 0 0 2 2.8V7z',
  bell: 'M12 2.5a6 6 0 0 1 6 6V13l2 3.5v1H4v-1L6 13V8.5a6 6 0 0 1 6-6zM9.5 19h5a2.5 2.5 0 0 1-5 0z',
  star: 'M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.1l-5.7 3.2 1.2-6.4-4.7-4.4 6.4-.8z',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3h1v11H6V10zm2 0h6V7a3 3 0 0 0-6 0z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
};

export function Icon({ d, size = 18, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d={d} />
    </svg>
  );
}

// ---------------------------------------------------------------- overlays (z 3)

let overRoot: HTMLElement | null = null;
const overlayRoot = () => {
  if (!overRoot) {
    overRoot = document.createElement('div');
    overRoot.className = 'wme-over';
    document.body.appendChild(overRoot);
  }
  return overRoot;
};
export const Overlay = ({ children }: { children: ReactNode }) => createPortal(children, overlayRoot());

/** A dialog above everything (cards included), closed by the ×, Escape or a click outside. */
export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children?: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), onClose());
    window.addEventListener('keydown', onKey, true);
    // Focus the first field, else the dialog itself (keyboard users land inside).
    const first = ref.current?.querySelector<HTMLElement>('input, textarea') ?? ref.current;
    first?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <Overlay>
      <div className="scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="dialog" role="dialog" aria-label={title} tabIndex={-1} ref={ref} style={width ? { width } : undefined}>
          <h3>{title}</h3>
          <button className="iconbtn close" aria-label="Fermer" onClick={onClose}>
            <Icon d={ICON.close} size={14} />
          </button>
          {children}
        </div>
      </div>
    </Overlay>
  );
}

/** A short message above the dock; `show` replaces it. */
export function useToast(ms = 3200) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!text) return;
    const t = setTimeout(() => setText(null), ms);
    return () => clearTimeout(t);
  }, [text, ms]);
  const node = text ? (
    <Overlay>
      <div className="toast" role="status">
        {text}
      </div>
    </Overlay>
  ) : null;
  return [node, setText] as const;
}

/** Second press to confirm (spending, discarding…); disarms after a few seconds. */
export function useArmed(ms = 4000): [boolean, (on: boolean) => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(t);
  }, [armed, ms]);
  return [armed, setArmed];
}

function useNarrow() {
  const q = '(max-width: 860px)';
  const [narrow, setNarrow] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const m = matchMedia(q);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

// ---------------------------------------------------------------- cards

/** A card in a grid: a real button the size of the card. */
export function CardSlot({ card, shiny, className, label, onClick, disabled, faceDown }: { card: Card; shiny: boolean; className?: string; label: string; onClick?: () => void; disabled?: boolean; faceDown?: boolean }) {
  return (
    <button type="button" className={`slot${className ? ` ${className}` : ''}`} aria-label={label} disabled={disabled} onClick={() => (sfx.click(), onClick?.())}>
      <CardFace card={card} shiny={shiny} faceDown={faceDown} />
    </button>
  );
}

/** The big card of a detail panel. */
export function BigCard({ card, shiny }: { card: Card; shiny: boolean }) {
  return (
    <div className="bigcard" aria-hidden="true">
      <CardFace card={card} shiny={shiny} big />
    </div>
  );
}

/** Detail panel: beside the board, or a bottom sheet on phones. */
export function Panel({ children, onClose, label }: { children: ReactNode; onClose?: () => void; label: string }) {
  const ref = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  useLayoutEffect(() => {
    if (ref.current) gsap.fromTo(ref.current, narrow ? { y: 40, opacity: 0 } : { x: 30, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
  }, [narrow]);
  return (
    <aside className="panel" ref={ref} aria-label={label}>
      {onClose && (
        <button className="iconbtn close" aria-label="Fermer" onClick={onClose}>
          <Icon d={ICON.close} size={14} />
        </button>
      )}
      {children}
    </aside>
  );
}

export function SearchField({ id, value, onChange, placeholder = 'Rechercher une carte' }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <span style={{ position: 'absolute', left: -9999 }}>{placeholder}</span>
      <Icon d={ICON.search} size={16} />
      <input id={id} className="field" type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/** The panel's place when nothing is open, so opening a card never reflows the board. */
export function PanelPlaceholder({ children }: { children: ReactNode }) {
  return (
    <aside className="panel placeholder" aria-hidden="true">
      {children}
    </aside>
  );
}
