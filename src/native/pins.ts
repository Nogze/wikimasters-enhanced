import gsap from 'gsap';
import type { Card } from '../lib/types';
import { reducedMotion } from '../lib/motion';

// Where each 3D card is. The interface is HTML; a card is an element of it (an "anchor": a grid
// slot, the big card of a detail panel) and the card layer (CardLayer.tsx) draws a 3D card exactly
// over it every frame. Clicks always land on the HTML element, so hit areas are exact.
//
// Cards are keyed (a collection item id, a lot id…). Several anchors may share a key: the card sits
// on the one with the highest priority (the panel beats the grid). When that changes, the card
// flies from where it was to the new anchor; when a key gets its first anchor the card is dealt in,
// when it loses its last one it is dealt out. Screens never animate cards themselves.

export type Rect = { x: number; y: number; w: number; h: number };
export type Anchor = { el: HTMLElement; priority: number; clip: HTMLElement | null; card: Card; shiny: boolean; seq: number };
export type Pin = {
  key: string;
  card: Card;
  shiny: boolean;
  anchor: Anchor | null;
  /** The element that clips the card (its board), kept while it leaves. */
  clip: HTMLElement | null;
  /** Rect drawn last frame (where a flight or an exit starts from). */
  last: Rect | null;
  /** p: 0 → 1; the card turns `turn` on the way and leaves behind any turn it had (spin0). */
  flight: { from: Rect; p: number; turn: number; spin0: number } | null;
  /** 0 → 1 dealt in; back to 0 when leaving. */
  enter: number;
  /** Side the card enters from / leaves to (−1 left, 1 right). */
  dir: number;
  leaving: boolean;
  ready: boolean;
  hover: number;
  hoverT: number;
  tilt: [number, number];
  tiltT: [number, number];
  /** Extra turn around Y (the big card turned over by dragging). */
  spin: number;
};

const anchors = new Map<string, Set<Anchor>>();
const pins = new Map<string, Pin>();
const occluders = new Set<HTMLElement>();
const subs = new Set<() => void>();
let list: Pin[] = [];
let seq = 0;
let dealDir = 1;
let dealIndex = 0;
let dealReset = 0;
const T = () => (reducedMotion() ? 0.3 : 1);

const emit = () => {
  list = [...pins.values()];
  subs.forEach((f) => f());
};
export const subscribePins = (f: () => void) => (subs.add(f), () => void subs.delete(f));
export const pinList = () => list;
export const getPin = (key: string) => pins.get(key);
export const occluderList = () => occluders;

/** Next cards dealt in come from this side (and the ones leaving go the other way). */
export function setDealDirection(d: number) {
  dealDir = d >= 0 ? 1 : -1;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

function best(key: string): Anchor | null {
  let b: Anchor | null = null;
  for (const a of anchors.get(key) ?? []) if (!b || a.priority > b.priority || (a.priority === b.priority && a.seq > b.seq)) b = a;
  return b;
}

/** Called by the card mesh once its face is drawn: the deal starts then (never a blank card). */
export function pinReady(p: Pin) {
  if (p.ready) return;
  p.ready = true;
  if (p.leaving) return;
  // Cards dealt in the same frame follow each other.
  if (!dealReset) dealReset = requestAnimationFrame(() => ((dealIndex = 0), (dealReset = 0)));
  gsap.to(p, { enter: 1, duration: 0.45 * T(), delay: Math.min(dealIndex++ * 0.025, 0.5) * T(), ease: 'power3.out' });
}

function reconcile(key: string) {
  const a = best(key);
  let p = pins.get(key);
  if (!a) {
    if (p && !p.leaving) {
      const pin = p;
      pin.leaving = true;
      pin.anchor = null;
      pin.hoverT = 0;
      pin.dir = -dealDir;
      gsap.killTweensOf(pin);
      if (pin.flight) gsap.killTweensOf(pin.flight), (pin.flight = null);
      gsap.to(pin, {
        enter: 0,
        duration: 0.28 * T(),
        ease: 'power2.in',
        onComplete: () => {
          if (pins.get(key) === pin && pin.leaving) pins.delete(key), emit();
        },
      });
    }
    return;
  }
  if (!p) {
    p = { key, card: a.card, shiny: a.shiny, anchor: a, clip: a.clip, last: null, flight: null, enter: 0, dir: dealDir, leaving: false, ready: false, hover: 0, hoverT: 0, tilt: [0, 0], tiltT: [0, 0], spin: 0 };
    pins.set(key, p);
    emit();
    return;
  }
  p.card = a.card;
  p.shiny = a.shiny;
  if (p.leaving) {
    // Came back before it was gone (a filter toggled twice): deal it in again where it is now.
    p.leaving = false;
    gsap.killTweensOf(p);
    p.dir = dealDir;
    if (p.ready) gsap.to(p, { enter: 1, duration: 0.35 * T(), ease: 'power3.out' });
  }
  if (p.anchor === a) return;
  const from = p.last;
  p.anchor = a;
  p.clip = a.clip;
  if (!from || p.enter < 0.5) return;
  // A remount in the same place (React replaced the element) is not a move.
  const to = rectOf(a.el);
  if (Math.abs(to.x - from.x) < 3 && Math.abs(to.y - from.y) < 3 && Math.abs(to.w - from.w) < 3) return;
  if (p.flight) gsap.killTweensOf(p.flight);
  const pin = p;
  pin.hoverT = 0;
  pin.tiltT = [0, 0];
  pin.flight = { from, p: 0, turn: Math.PI * 2 * (to.x >= from.x ? 1 : -1), spin0: pin.spin };
  pin.spin = 0;
  gsap.to(pin.flight, { p: 1, duration: 0.7 * T(), ease: 'power3.inOut', onComplete: () => void (pin.flight = null) });
}

export function addAnchor(key: string, init: Omit<Anchor, 'seq'>): Anchor {
  const a: Anchor = { ...init, seq: ++seq };
  let set = anchors.get(key);
  if (!set) anchors.set(key, (set = new Set()));
  set.add(a);
  reconcile(key);
  return a;
}

export function removeAnchor(key: string, a: Anchor) {
  const set = anchors.get(key);
  if (!set) return;
  set.delete(a);
  if (!set.size) anchors.delete(key);
  reconcile(key);
}

/** The pointer over an anchor: lift and tilt its card (u, v in −1…1 across the element). */
export function hoverAnchor(key: string, el: HTMLElement, u: number, v: number, amount = 1) {
  const p = pins.get(key);
  if (!p || p.anchor?.el !== el || p.flight) return;
  p.hoverT = amount;
  p.tiltT = [u, v];
}
export function leaveAnchor(key: string, el: HTMLElement) {
  const p = pins.get(key);
  if (!p || p.anchor?.el !== el) return;
  p.hoverT = 0;
  p.tiltT = [0, 0];
}

/** Elements drawn above the board (a bottom sheet on phones): cards are cut at their top edge. */
export function addOccluder(el: HTMLElement) {
  occluders.add(el);
  return () => void occluders.delete(el);
}
