import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Card } from '../lib/types';
import { CardSlot, Icon, ICON } from './kit';

// A board of cards, paged to fit: as many columns and rows as the board holds at the chosen card
// size, never a scrollbar. Each card is a CardSlot. Pages turn with the arrows, the wheel or ← →.

export type GridItem = { key: string; card: Card; shiny: boolean };
export type CardSize = 'S' | 'M' | 'L';
export const SIZES: CardSize[] = ['S', 'M', 'L'];
const MIN_W: Record<CardSize, number> = { S: 92, M: 118, L: 156 };
const SIZE_KEY = 'wme-card-size';
export function savedSize(): CardSize {
  try {
    const s = localStorage.getItem(SIZE_KEY) as CardSize | null;
    return s && SIZES.includes(s) ? s : 'M';
  } catch {
    return 'M';
  }
}
export function saveSize(s: CardSize) {
  try {
    localStorage.setItem(SIZE_KEY, s);
  } catch {
    /* private mode */
  }
}

type Props<T extends GridItem> = {
  items: T[];
  /** Changing it goes back to the first page (a new search, filter, tab…). */
  resetKey: string;
  size?: CardSize;
  /** Key of the card open in the panel: its slot keeps an outline where it was. */
  selected?: string | null;
  slotClass?: (it: T) => string | undefined;
  label: (it: T) => string;
  caption?: (it: T) => ReactNode;
  onPick?: (it: T) => void;
  /** More items exist on the server: called when the last loaded page is shown. */
  hasMore?: boolean;
  onMore?: () => void;
  empty?: ReactNode;
  footLeft?: ReactNode;
};

export function CardGrid<T extends GridItem>({ items, resetKey, size = 'M', selected, slotClass, label, caption, onPick, hasMore, onMore, empty, footLeft }: Props<T>) {
  const board = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [boardEl, setBoardEl] = useState<HTMLElement | null>(null);
  const [fit, setFit] = useState({ cols: 0, rows: 0, w: 0, gap: 14 });
  const [page, setPage] = useState(0);

  // Fit the grid to the board.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const W = el.clientWidth;
      const H = el.clientHeight;
      const narrow = W < 560;
      const gap = narrow ? 10 : 14;
      const capH = caption ? 36 : 0;
      const minW = MIN_W[size] * (narrow ? 0.85 : 1);
      const cols = Math.max(2, Math.floor((W + gap) / (minW + gap)));
      let w = (W - gap * (cols - 1)) / cols;
      let rows = Math.max(1, Math.floor((H + gap) / (w * 1.4 + capH + gap)));
      // Lots of height left over: one more row of slightly smaller cards fills the board better.
      const more = (H - capH * (rows + 1) - gap * rows) / (rows + 1) / 1.4;
      if (H - rows * (w * 1.4 + capH + gap) > w * 0.5 && more >= minW * 0.8) {
        rows += 1;
        w = Math.min(w, more);
      }
      // Too tall for even one row: shrink the cards to fit the height.
      if (w * 1.4 + capH > H) {
        w = Math.max(40, (H - capH) / 1.4);
        rows = 1;
      }
      setFit((f) => (f.cols === cols && f.rows === rows && Math.abs(f.w - w) < 0.5 && f.gap === gap ? f : { cols, rows, w: Math.floor(w), gap }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [size, !!caption]); // eslint-disable-line react-hooks/exhaustive-deps

  const per = Math.max(1, fit.cols * fit.rows);
  const pages = Math.max(1, Math.ceil(items.length / per));
  // Keep the first card of the page in view when the page size changes.
  const firstRef = useRef(0);
  useLayoutEffect(() => {
    setPage(Math.floor(firstRef.current / per));
  }, [per]);
  useLayoutEffect(() => {
    firstRef.current = 0;
    setPage(0);
  }, [resetKey]);
  const p = Math.min(page, pages - 1);
  firstRef.current = p * per;
  const go = (to: number) => {
    const n = Math.max(0, Math.min(to, pages - 1));
    if (n === p) return;
    setPage(n);
  };
  const goRef = useRef(go);
  goRef.current = go;
  const pRef = useRef(p);
  pRef.current = p;

  // Asking the server for more before the last page.
  useEffect(() => {
    if (hasMore && onMore && p >= pages - 2) onMore();
  }, [p, pages, hasMore, onMore]);

  // Wheel over the board, ← → anywhere (outside text fields).
  useEffect(() => {
    const el = board.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return;
      e.preventDefault();
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (Math.abs(d) < 4 || performance.now() - last < 350) return;
      last = performance.now();
      goRef.current(pRef.current + Math.sign(d));
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.closest('.wme-over'))) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') goRef.current(pRef.current + 1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goRef.current(pRef.current - 1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const shown = fit.cols && boardEl ? items.slice(p * per, p * per + per) : [];
  return (
    <div
      className="board"
      ref={(el) => {
        board.current = el;
        setBoardEl(el);
      }}
    >
      <div className="gridbox" ref={box}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${fit.cols || 1}, ${fit.w}px)`, gap: fit.gap }}>
          {shown.map((it) => (
            <div className="slotcell" key={it.key}>
              <CardSlot
                card={it.card}
                shiny={it.shiny}
                label={label(it)}
                className={[selected === it.key ? 'on' : '', slotClass?.(it) ?? ''].filter(Boolean).join(' ') || undefined}
                onClick={onPick && (() => onPick(it))}
              />
              {caption && <div className="caption">{caption(it)}</div>}
            </div>
          ))}
        </div>
        {!items.length && empty && <div className="empty">{empty}</div>}
      </div>
      <div className="foot">
        {footLeft}
        <div className="grow" />
        {pages > 1 || hasMore ? (
          <div className="pager">
            <button className="iconbtn" aria-label="Page précédente" disabled={p === 0} onClick={() => go(p - 1)}>
              <Icon d={ICON.prev} size={16} />
            </button>
            <span className="lbl num" aria-live="polite">{`Page ${p + 1} sur ${pages}${hasMore ? '+' : ''}`}</span>
            <button className="iconbtn" aria-label="Page suivante" disabled={p >= pages - 1} onClick={() => go(p + 1)}>
              <Icon d={ICON.next} size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
